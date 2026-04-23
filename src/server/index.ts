import express from "express";
import http from "http";
import path from "path";
import { WebSocketServer, WebSocket } from "ws";
import { v4 as uuidv4 } from "uuid";
import {
    GameState,
    Board,
    Hand,
    CastResult,
    ClientMessage,
    ServerMessage,
    rollHand,
    rollSelectedStones,
    classifyCast,
    resolveTurn,
    checkWin,
    initialBoard,
    TurretOwner,
} from "../shared/game";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Player {
    ws: WebSocket;
    index: 0 | 1;
}

interface Room {
    code: string;
    players: Player[];
    state: GameState;
}

// ─── State ────────────────────────────────────────────────────────────────────

const rooms = new Map<string, Room>();

function makeCode(): string {
    // 6-char uppercase alphanumeric
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function freshState(): GameState {
    return {
        phase: "waiting",
        board: initialBoard(),
        gemsLine: [6, 6],
        activePlayer: 0,
        hands: [null, null],
        casts: [null, null],
        castReady: [false, false],
        recastReady: [false, false],
        recastIndices: [[], []],
        recastDecision: [null, null],
        winner: null,
        lastOutcome: null,
        pendingAction: null,
        actionStep: 0,
        actionData: [],
        rematchReady: [false, false],
    };
}

function send(ws: WebSocket, msg: ServerMessage) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
    }
}

function broadcast(room: Room, msg: ServerMessage) {
    for (const p of room.players) send(p.ws, msg);
}

function broadcastState(room: Room) {
    broadcast(room, { type: "state_update", state: room.state });
}

// ─── Game logic ───────────────────────────────────────────────────────────────

function startCastingPhase(room: Room) {
    const s = room.state;
    s.phase = "casting";
    s.hands = [rollHand(), rollHand()];
    s.casts = [null, null];
    s.castReady = [false, false];
    s.recastReady = [false, false];
    s.recastIndices = [[], []];
    s.recastDecision = [null, null];
    s.lastOutcome = null;
    s.pendingAction = null;
    s.actionStep = 0;
    s.actionData = [];
    broadcastState(room);
}

function tryAdvanceFromCasting(room: Room) {
    const s = room.state;
    if (!s.castReady[0] || !s.castReady[1]) return;

    // Both players have cast — move to recast phase
    s.phase = "recast";
    broadcastState(room);
}

function tryAdvanceFromRecast(room: Room) {
    const s = room.state;
    if (s.recastDecision[0] === null || s.recastDecision[1] === null) return;

    // Apply recasts
    for (const idx of [0, 1] as const) {
        if (s.recastDecision[idx] && s.recastIndices[idx].length > 0) {
            s.hands[idx] = rollSelectedStones(s.hands[idx]!, s.recastIndices[idx]);
        }
        // Classify final hand
        s.casts[idx] = classifyCast(s.hands[idx]!);
    }

    // Reveal: broadcast the outcome first so clients can show the reason,
    // then transition after a short delay to either restart (draw) or
    // move to the action phase for the winner.
    s.phase = "reveal";
    const outcome = resolveTurn(s.casts[0]!, s.casts[1]!);
    s.lastOutcome = outcome;

    // Broadcast the reveal immediately so clients can display `lastOutcome.reason`.
    broadcastState(room);

    if (outcome.winner === "draw") {
        // Restart after a short pause (same active player)
        setTimeout(() => startCastingPhase(room), 2500);
        return;
    }

    // Non-draw: after a short pause, set up the action phase and broadcast again.
    const winner = outcome.winner as 0 | 1;
    setTimeout(() => {
        s.activePlayer = winner;
        const winnerCast = s.casts[winner]!;
        const baseType = winnerCast.type === "spell" ? "spell" : winnerCast.type === "regular_potion" || winnerCast.type === "full_potion" ? "potion" : "charm";
        s.pendingAction = baseType;
        s.phase = "action";
        broadcastState(room);
    }, 500);
}

function handleAction(room: Room, playerIndex: 0 | 1, msg: ClientMessage) {
    const s = room.state;
    if (s.phase !== "action") return;
    if (s.activePlayer !== playerIndex) return; // only winner acts

    if (msg.type === "action_skip") {
        // Player chooses to do nothing — finish the action step
        finishAction(room);
        return;
    }

    if (msg.type === "action_spell") {
        const ti = msg.turretIndex;
        if (ti < 0 || ti > 7) return;
        if (s.board[ti] !== null) return; // occupied
        if (s.gemsLine[playerIndex] <= 0) return; // no gems left

        s.board[ti] = playerIndex;
        s.gemsLine[playerIndex]--;

        finishAction(room);
    } else if (msg.type === "action_potion") {
        const { myTurret, opponentTurret } = msg;
        const opponent = playerIndex === 0 ? 1 : 0;

        if (s.board[myTurret] !== playerIndex) return;
        if (s.board[opponentTurret] !== opponent) return;

        // Swap
        s.board[myTurret] = opponent;
        s.board[opponentTurret] = playerIndex;

        finishAction(room);
    } else if (msg.type === "action_charm") {
        const { opponentTurret } = msg;
        const opponent = playerIndex === 0 ? 1 : 0;

        if (s.board[opponentTurret] !== opponent) return;

        // Knock gem back to opponent's gem line
        s.board[opponentTurret] = null;
        s.gemsLine[opponent]++;

        finishAction(room);
    }
}

function finishAction(room: Room) {
    const s = room.state;
    const w = checkWin(s.board);
    if (w !== null) {
        s.winner = w;
        s.phase = "gameover";
        broadcastState(room);
        return;
    }
    broadcastState(room);
    setTimeout(() => startCastingPhase(room), 2000);
}

// ─── Connection handling ──────────────────────────────────────────────────────

function handleMessage(ws: WebSocket, playerIndex: 0 | 1, room: Room, raw: string) {
    let msg: ClientMessage;
    try {
        msg = JSON.parse(raw) as ClientMessage;
    } catch {
        return;
    }

    const s = room.state;

    switch (msg.type) {
        case "submit_cast": {
            if (s.phase !== "casting") return;
            if (s.castReady[playerIndex]) return;
            // Validate hand length
            if (!Array.isArray(msg.hand) || msg.hand.length !== 5) return;
            s.hands[playerIndex] = msg.hand;
            s.castReady[playerIndex] = true;
            broadcastState(room);
            tryAdvanceFromCasting(room);
            break;
        }

        case "submit_recast_decision": {
            if (s.phase !== "recast") return;
            if (s.recastDecision[playerIndex] !== null) return;
            s.recastDecision[playerIndex] = msg.recast;
            s.recastIndices[playerIndex] = msg.indices ?? [];
            broadcastState(room);
            tryAdvanceFromRecast(room);
            break;
        }

        case "action_spell":
        case "action_potion":
        case "action_charm": {
            handleAction(room, playerIndex, msg);
            break;
        }
        case "action_skip": {
            handleAction(room, playerIndex, msg);
            break;
        }
        case "rematch_request": {
            if (s.phase !== "gameover") return;
            if (s.rematchReady[playerIndex]) return; // already requested
            s.rematchReady[playerIndex] = true;
            broadcastState(room);
            if (s.rematchReady[0] && s.rematchReady[1]) {
                const newState = freshState();
                room.state = newState;
                startCastingPhase(room);
            }
            break;
        }
    }
}

// ─── Server setup ─────────────────────────────────────────────────────────────

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const publicDir = path.join(__dirname, "../../public");
app.use(express.static(publicDir));

// Catch-all: serve index.html for any non-asset route
app.get("*", (_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
});

wss.on("connection", (ws) => {
    let assignedRoom: Room | null = null;
    let assignedIndex: 0 | 1 = 0;

    ws.on("message", (data) => {
        const raw = data.toString();
        let msg: ClientMessage;
        try {
            msg = JSON.parse(raw) as ClientMessage;
        } catch {
            return;
        }

        if (msg.type === "create_room") {
            let code = makeCode();
            while (rooms.has(code)) code = makeCode();
            const room: Room = {
                code,
                players: [],
                state: freshState(),
            };
            rooms.set(code, room);
            assignedRoom = room;
            assignedIndex = 0;
            room.players.push({ ws, index: 0 });
            send(ws, { type: "room_created", code, playerIndex: 0 });
            return;
        }

        if (msg.type === "join_room") {
            const code = msg.code.toUpperCase();
            const room = rooms.get(code);
            if (!room) {
                send(ws, { type: "error", message: "Room not found" });
                return;
            }
            if (room.players.length >= 2) {
                send(ws, { type: "error", message: "Room is full" });
                return;
            }
            assignedRoom = room;
            assignedIndex = 1;
            room.players.push({ ws, index: 1 });
            send(ws, { type: "room_joined", code, playerIndex: 1 });
            // Both players connected — start game
            startCastingPhase(room);
            return;
        }

        if (assignedRoom) {
            handleMessage(ws, assignedIndex, assignedRoom, raw);
        }
    });

    ws.on("close", () => {
        if (assignedRoom) {
            assignedRoom.players = assignedRoom.players.filter((p) => p.ws !== ws);
            if (assignedRoom.players.length === 0) {
                rooms.delete(assignedRoom.code);
            } else {
                // Notify remaining player
                broadcast(assignedRoom, { type: "error", message: "Opponent disconnected" });
            }
        }
    });
});

const PORT = process.env.PORT ?? 3000;
server.listen(PORT, () => {
    console.log(`Lithomancy server listening on port ${PORT}`);
});
