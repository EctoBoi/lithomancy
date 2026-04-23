import { GameState, Hand, StoneFace, CastResult, CastType, Shape, SHAPE_SIDES, ServerMessage, ClientMessage, classifyCast } from "../shared/game.js";

// ─── Connection ───────────────────────────────────────────────────────────────

const protocol = location.protocol === "https:" ? "wss" : "ws";
const ws = new WebSocket(`${protocol}://${location.host}`);

let playerIndex: 0 | 1 | null = null;
let gameState: GameState | null = null;
let roomCode: string | null = null;

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const lobby = document.getElementById("lobby")!;
const btnCreate = document.getElementById("btn-create") as HTMLButtonElement;
const btnJoin = document.getElementById("btn-join") as HTMLButtonElement;
const joinInput = document.getElementById("join-input") as HTMLInputElement;
const codeDisplay = document.getElementById("code-display")!;
const statusBar = document.getElementById("status-bar")!;
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const uiPanel = document.getElementById("ui-panel")!;
const outcomeBanner = document.getElementById("outcome-banner")!;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function send(msg: ClientMessage) {
    ws.send(JSON.stringify(msg));
}

function setStatus(t: string) {
    statusBar.textContent = t;
}

// ─── Lobby wiring ─────────────────────────────────────────────────────────────

btnCreate.addEventListener("click", () => send({ type: "create_room" }));
btnJoin.addEventListener("click", () => {
    const code = joinInput.value.trim().toUpperCase();
    if (code.length < 2) return;
    send({ type: "join_room", code });
});

ws.addEventListener("open", () => setStatus("Connected. Create or join a room."));
ws.addEventListener("close", () => setStatus("Disconnected."));

ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data as string) as ServerMessage;
    handleServer(msg);
});

function handleServer(msg: ServerMessage) {
    switch (msg.type) {
        case "room_created":
            playerIndex = msg.playerIndex;
            roomCode = msg.code;
            lobby.style.display = "none";
            codeDisplay.textContent = msg.code;
            setStatus("Waiting for opponent… share this code!");
            break;

        case "room_joined":
            playerIndex = msg.playerIndex;
            roomCode = msg.code;
            lobby.style.display = "none";
            codeDisplay.textContent = "";
            setStatus("Joined! Game starting…");
            break;

        case "error":
            setStatus(`Error: ${msg.message}`);
            break;

        case "state_update":
            gameState = msg.state;
            codeDisplay.textContent = "";
            canvas.style.display = "block";
            render();
            // Clear any transient status text when a new round starts (casting phase)
            if (gameState && gameState.phase === "casting") {
                setStatus("");
            }
            // Reset local action flag when it's no longer this player's action phase
            if (!gameState || gameState.phase !== "action" || gameState.activePlayer !== playerIndex) {
                actionTakenLocal = false;
            }
            updateUI();
            break;
    }
}

// ─── Render ───────────────────────────────────────────────────────────────────

const W = canvas.width;
const H = canvas.height;
const CX = W / 2;
const CY = H / 2;
const TOWER_R = 180;
const TURRET_R = 24;
const STONE_R = 26;

// Turret positions: 8 around a circle, 0 at top, clockwise
function turretPos(i: number): [number, number] {
    const angle = (i / 8) * Math.PI * 2 - Math.PI / 2;
    return [CX + (TOWER_R + TURRET_R + 10) * Math.cos(angle), CY + (TOWER_R + TURRET_R + 10) * Math.sin(angle)];
}

// Stone positions in hand: two rows inside the tower (one row of 3, one of 2)
function getHandPositions(isBottomPlayerView: boolean): [number, number][] {
    // rows relative to center
    const topRowOffset = isBottomPlayerView ? 60 : -60; // row of 3
    const bottomRowOffset = isBottomPlayerView ? 116 : -116; // row of 2

    const positions: [number, number][] = [];

    // Row of 3 (indices 0,1,2)
    const spacing3 = 64;
    const startX3 = CX - spacing3;
    const y3 = CY + topRowOffset;
    positions.push([startX3, y3]);
    positions.push([startX3 + spacing3, y3]);
    positions.push([startX3 + spacing3 * 2, y3]);

    // Row of 2 (indices 3,4)
    const spacing2 = 64;
    const startX2 = CX - spacing2 / 2;
    const y2 = CY + bottomRowOffset;
    positions.push([startX2, y2]);
    positions.push([startX2 + spacing2, y2]);

    return positions;
}

function drawPolygon(x: number, y: number, sides: number, r: number) {
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2 - Math.PI / 2;
        const px = x + r * Math.cos(a);
        const py = y + r * Math.sin(a);
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
}

function drawStone(x: number, y: number, face: StoneFace, selected: boolean, dim: boolean) {
    ctx.save();
    ctx.globalAlpha = dim ? 0.3 : 1;

    // Background
    ctx.beginPath();
    ctx.arc(x, y, STONE_R, 0, Math.PI * 2);
    ctx.fillStyle = selected ? "#3d2f60" : "#1c1530";
    ctx.fill();
    ctx.strokeStyle = selected ? "#c8a96e" : "#6050a0";
    ctx.lineWidth = selected ? 2.5 : 1.5;
    ctx.stroke();

    if (face.kind === "shape") {
        const sides = SHAPE_SIDES[face.value];
        drawPolygon(x, y, sides, 14);
        ctx.fillStyle = "#a0c8ff";
        ctx.fill();
        ctx.strokeStyle = "#6090d0";
        ctx.lineWidth = 1.5;
        ctx.stroke();
    } else {
        ctx.fillStyle = "#ffe080";
        ctx.font = "bold 16px Georgia";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(face.value), x, y);
    }
    ctx.restore();
}

function drawTurret(i: number, owner: 0 | 1 | null) {
    const [x, y] = turretPos(i);

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, TURRET_R, 0, Math.PI * 2);

    if (owner === null) {
        ctx.fillStyle = "#1a1530";
        ctx.strokeStyle = "#504070";
    } else {
        ctx.fillStyle = owner === 0 ? "#1a2840" : "#2a1520";
        ctx.strokeStyle = owner === 0 ? "#70a0ff" : "#ff7070";
    }
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();

    // Label
    ctx.fillStyle = owner === null ? "#504070" : owner === 0 ? "#90c0ff" : "#ff9090";
    ctx.font = "11px Georgia";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(owner === null ? String(i + 1) : owner === 0 ? "P1" : "P2", x, y);
    ctx.restore();
}

function drawTower() {
    // Outer ring
    ctx.save();
    ctx.beginPath();
    ctx.arc(CX, CY, TOWER_R + TURRET_R + 22, 0, Math.PI * 2);
    ctx.strokeStyle = "#302050";
    ctx.lineWidth = 3;
    ctx.stroke();

    // Tower circle
    ctx.beginPath();
    ctx.arc(CX, CY, TOWER_R, 0, Math.PI * 2);
    ctx.fillStyle = "#100e1c";
    ctx.fill();
    ctx.strokeStyle = "#403060";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Center rune
    ctx.fillStyle = "#302050";
    ctx.font = "42px Georgia";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("✦", CX, CY);
    ctx.restore();
}

function castSymbol(t: CastType): string {
    switch (t) {
        case "spell":
            return "✨";
        case "full_potion":
        case "regular_potion":
            return "⚗️";
        case "full_charm":
        case "regular_charm":
            return "🔮";
        case "bungle":
            return "💨";
    }
}

function castName(t: CastType): string {
    switch (t) {
        case "spell":
            return "SPELL";
        case "full_potion":
            return "FULL POTION";
        case "regular_potion":
            return "POTION";
        case "full_charm":
            return "FULL CHARM";
        case "regular_charm":
            return "CHARM";
        case "bungle":
            return "BUNGLE";
    }
}

function drawRefArrow(x1: number, y1: number, x2: number, y2: number) {
    const dx = x2 - x1,
        dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    const ux = dx / len,
        uy = dy / len;
    const pad = 14;
    const sx = x1 + ux * pad,
        sy = y1 + uy * pad;
    const ex = x2 - ux * pad,
        ey = y2 - uy * pad;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.strokeStyle = "#5a4080";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Arrowhead
    const angle = Math.atan2(ey - sy, ex - sx);
    const hl = 7;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - hl * Math.cos(angle - 0.42), ey - hl * Math.sin(angle - 0.42));
    ctx.lineTo(ex - hl * Math.cos(angle + 0.42), ey - hl * Math.sin(angle + 0.42));
    ctx.closePath();
    ctx.fillStyle = "#5a4080";
    ctx.fill();
}

// Win condition reference triangle drawn in the top-right corner of the canvas
function drawWinReference() {
    const ox = 570,
        oy = 70; // center of the reference panel (top-right, clear of turrets)
    ctx.save();

    // Panel background
    ctx.fillStyle = "rgba(8, 6, 18, 0.90)";
    ctx.fillRect(ox - 62, oy - 62, 124, 124);
    ctx.strokeStyle = "#38285a";
    ctx.lineWidth = 1;
    ctx.strokeRect(ox - 62, oy - 62, 124, 124);

    // Title
    ctx.font = "bold 8px Georgia";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#504070";
    ctx.fillText("▼ BEATS ▼", ox, oy - 50);

    // Triangle node positions
    const spell: [number, number] = [ox, oy - 26];
    const potion: [number, number] = [ox - 38, oy + 38];
    const charm: [number, number] = [ox + 38, oy + 38];

    // Arrows: spell→potion, potion→charm, charm→spell
    drawRefArrow(spell[0], spell[1], potion[0], potion[1]);
    drawRefArrow(potion[0], potion[1], charm[0], charm[1]);
    drawRefArrow(charm[0], charm[1], spell[0], spell[1]);

    // Node labels (symbol + name)
    const nodes = [
        { pos: spell, sym: "✨", name: "Spell" },
        { pos: potion, sym: "⚗️", name: "Potion" },
        { pos: charm, sym: "🔮", name: "Charm" },
    ];
    for (const { pos, sym, name } of nodes) {
        ctx.font = "13px Georgia";
        ctx.fillStyle = "#ffe080";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(sym, pos[0], pos[1] - 5);
        ctx.font = "9px Georgia";
        ctx.fillStyle = "#a090c0";
        ctx.fillText(name, pos[0], pos[1] + 7);
    }

    ctx.restore();
}

// Show what a hand classifies as, drawn near the hand stones
function drawHandLabel(hand: Hand, isMyHand: boolean) {
    const cast = classifyCast(hand);
    // Below my stones (bottom row centres at CY+116, radius 26, bottom edge CY+142)
    // Above opponent stones (top row centres at CY-116, radius 26, top edge CY-142)
    const mainY = isMyHand ? CY + 152 : CY - 152;
    const detailY = isMyHand ? CY + 168 : CY - 168;

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Symbol + name
    ctx.font = "bold 13px Georgia";
    ctx.fillStyle = isMyHand ? "#c8a96e" : "#9080b0";
    ctx.fillText(`${castSymbol(cast.type)} ${castName(cast.type)}`, CX, mainY);

    // Value / detail
    let detail = "";
    if (cast.type === "spell") detail = `Sum: ${cast.spellValue}`;
    else if (cast.type === "regular_potion") detail = `Value: ${cast.potionValue}`;
    else if (cast.type === "full_potion") detail = "All Shapes";
    else if (cast.type === "regular_charm") detail = `${cast.charmValue} · ${SHAPE_SIDES[cast.charmValue!]} sides`;
    else if (cast.type === "full_charm") detail = "All Numbers";
    else if (cast.type === "bungle") detail = "Loses to all";

    if (detail) {
        ctx.font = "11px Georgia";
        ctx.fillStyle = "#705880";
        ctx.fillText(detail, CX, detailY);
    }

    ctx.restore();
}

// Stone selection state for recast
let selectedStones = new Set<number>();
let myHandForRecast: Hand | null = null;

function render() {
    ctx.clearRect(0, 0, W, H);
    if (!gameState || playerIndex === null) return;

    const s = gameState;

    // Background gradient
    const grad = ctx.createRadialGradient(CX, CY, 60, CX, CY, W * 0.7);
    grad.addColorStop(0, "#13102a");
    grad.addColorStop(1, "#0a0812");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    drawTower();
    drawWinReference();

    // Turrets
    for (let i = 0; i < 8; i++) drawTurret(i, s.board[i]);

    // Gem line counts — always show the local player at the bottom
    const gemLineColors = ["#90c0ff", "#ff9090"];
    for (const pi of [0, 1] as const) {
        const y = pi === playerIndex ? H - 40 : 40;
        ctx.save();
        ctx.font = "13px Georgia";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = gemLineColors[pi];
        ctx.fillText(`Player ${pi + 1}${pi === playerIndex ? " (you)" : ""}  — Gems: ${s.gemsLine[pi]}`, CX, y);
        ctx.restore();
    }

    // Hands
    const myHand = s.hands[playerIndex];
    const opponentIndex = playerIndex === 0 ? 1 : 0;
    const opHand = s.hands[opponentIndex];

    // Hands: position stones inside the tower in two rows (3 + 2), mirrored for opponent
    const myPositions = getHandPositions(true);
    const opPositions = getHandPositions(false);

    if (myHand) {
        // Show own hand face-down until the player has confirmed their cast
        const myHasCast = s.phase !== "casting" || s.castReady[playerIndex];
        if (myHasCast) {
            for (let i = 0; i < 5; i++) {
                const [x, y] = myPositions[i];
                const face = myHand[i];
                const isSelected = selectedStones.has(i);
                const isDim = s.phase === "casting" && s.castReady[playerIndex];
                drawStone(x, y, face, isSelected, isDim);
            }
            drawHandLabel(myHand, true);
        } else {
            // Draw face-down stones to indicate the hand is not yet confirmed
            for (let i = 0; i < 5; i++) {
                const [x, y] = myPositions[i];
                ctx.save();
                ctx.beginPath();
                ctx.arc(x, y, STONE_R, 0, Math.PI * 2);
                ctx.fillStyle = "#1c1530";
                ctx.fill();
                ctx.strokeStyle = "#6050a0";
                ctx.lineWidth = 1.5;
                ctx.stroke();
                ctx.fillStyle = "#504070";
                ctx.font = "14px Georgia";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText("✦", x, y);
                ctx.restore();
            }
        }
    }

    if (opHand) {
        // Show opponent hand face-down until casts are resolved
        const reveal = s.phase === "reveal" || s.phase === "action" || s.phase === "gameover" || s.phase === "recast";
        const showOpponentCastLabel = s.phase === "recast" || reveal;
        for (let i = 0; i < 5; i++) {
            const [x, y] = opPositions[i];
            if (reveal) {
                drawStone(x, y, opHand[i], false, false);
            } else {
                // Face-down: just draw blank stone
                ctx.save();
                ctx.beginPath();
                ctx.arc(x, y, STONE_R, 0, Math.PI * 2);
                ctx.fillStyle = "#1c1530";
                ctx.fill();
                ctx.strokeStyle = "#6050a0";
                ctx.lineWidth = 1.5;
                ctx.stroke();
                ctx.fillStyle = "#504070";
                ctx.font = "14px Georgia";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText("✦", x, y);
                ctx.restore();
            }
        }
        if (showOpponentCastLabel) drawHandLabel(opHand, false);
    }

    // Phase overlay text
    let phaseText = "";
    switch (s.phase) {
        case "waiting":
            phaseText = "Waiting for opponent…";
            break;
        case "casting":
            phaseText = s.castReady[playerIndex] ? "Waiting for opponent to cast…" : "Cast your stones!";
            break;
        case "recast":
            phaseText = s.recastDecision[playerIndex] !== null ? "Waiting for opponent…" : "Recast? Select stones to reroll, then decide.";
            break;
        case "reveal":
            phaseText = s.lastOutcome?.reason ?? "";
            break;
        case "action":
            phaseText =
                s.activePlayer === playerIndex
                    ? `You won! Execute your ${s.pendingAction?.toUpperCase()}.`
                    : `Opponent won. They're executing their ${s.pendingAction?.toUpperCase()}.`;
            break;
        case "gameover":
            phaseText = s.winner === playerIndex ? "🏆 You win!" : "💀 You lose.";
            break;
    }

    if (phaseText) {
        ctx.save();
        ctx.font = "15px Georgia";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#b090e0";
        ctx.fillText(phaseText, CX, CY);
        ctx.restore();
    }

    // Last outcome banner
    if (s.lastOutcome && (s.phase === "reveal" || s.phase === "action" || s.phase === "gameover")) {
        outcomeBanner.textContent =
            s.lastOutcome.winner === "draw"
                ? "Draw — replaying!"
                : s.lastOutcome.winner === playerIndex
                  ? `You win this turn! (${s.lastOutcome.reason})`
                  : `Opponent wins this turn. (${s.lastOutcome.reason})`;
    } else if (s.phase === "gameover") {
        outcomeBanner.textContent = s.winner === playerIndex ? "✦ Victory! ✦" : "✦ Defeat ✦";
    } else {
        outcomeBanner.textContent = "";
    }
}

// ─── UI Panel (action buttons) ────────────────────────────────────────────────

// Action state for turret clicking
type ActionMode = { mode: "none" } | { mode: "spell" } | { mode: "charm" } | { mode: "potion_my"; myTurret: number | null };

let actionMode: ActionMode = { mode: "none" };
let actionTakenLocal = false; // set when the local player submits an action or skips

// Turret click detection
canvas.addEventListener("click", (e) => {
    if (!gameState || playerIndex === null) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (W / rect.width);
    const my = (e.clientY - rect.top) * (H / rect.height);

    const s = gameState;

    // Stone selection (recast phase)
    if (s.phase === "recast" && s.recastDecision[playerIndex] === null) {
        const myHand = s.hands[playerIndex];
        if (myHand) {
            const myPositions = getHandPositions(true);
            for (let i = 0; i < 5; i++) {
                const [x, y] = myPositions[i];
                if (Math.hypot(mx - x, my - y) < STONE_R + 4) {
                    if (selectedStones.has(i)) selectedStones.delete(i);
                    else selectedStones.add(i);
                    render();
                    updateUI();
                    return;
                }
            }
        }
    }

    // Turret clicks during action phase
    if (s.phase === "action" && s.activePlayer === playerIndex) {
        // If we've already submitted or skipped the action locally, ignore turret clicks
        if (actionTakenLocal) return;
        for (let i = 0; i < 8; i++) {
            const [tx, ty] = turretPos(i);
            if (Math.hypot(mx - tx, my - ty) < TURRET_R + 6) {
                handleTurretClick(i);
                return;
            }
        }
    }
});

function handleTurretClick(i: number) {
    if (!gameState || playerIndex === null) return;
    const s = gameState;
    const opponent = playerIndex === 0 ? 1 : 0;

    if (actionMode.mode === "spell") {
        if (s.board[i] !== null) {
            setStatus("That turret is occupied.");
            return;
        }
        send({ type: "action_spell", turretIndex: i });
        actionMode = { mode: "none" };
        actionTakenLocal = true;
        updateUI();
    } else if (actionMode.mode === "charm") {
        if (s.board[i] !== opponent) {
            setStatus("Pick an opponent's turret gem.");
            return;
        }
        send({ type: "action_charm", opponentTurret: i });
        actionMode = { mode: "none" };
        actionTakenLocal = true;
        updateUI();
    } else if (actionMode.mode === "potion_my") {
        if (actionMode.myTurret === null) {
            // pick own gem
            if (s.board[i] !== playerIndex) {
                setStatus("Pick one of your turret gems first.");
                return;
            }
            actionMode = { mode: "potion_my", myTurret: i };
            setStatus("Now click an adjacent opponent turret gem.");
        } else {
            // pick opponent adjacent gem
            if (s.board[i] !== opponent) {
                setStatus("Pick an opponent's gem.");
                return;
            }
            send({ type: "action_potion", myTurret: actionMode.myTurret, opponentTurret: i });
            actionMode = { mode: "none" };
            actionTakenLocal = true;
            updateUI();
        }
    }
}

function updateUI() {
    uiPanel.innerHTML = "";
    if (!gameState || playerIndex === null) return;
    const s = gameState;

    if (s.phase === "casting" && !s.castReady[playerIndex]) {
        // Auto-roll is handled server-side; client just needs to confirm
        const hand = s.hands[playerIndex];
        if (hand) {
            const btn = document.createElement("button");
            btn.textContent = "Confirm Cast";
            btn.addEventListener("click", () => {
                send({ type: "submit_cast", hand: hand });
            });
            uiPanel.appendChild(btn);
        }
    }

    if (s.phase === "recast" && s.recastDecision[playerIndex] === null) {
        const row = document.createElement("div");
        row.className = "row";

        const btnStay = document.createElement("button");
        btnStay.textContent = "Stay";
        btnStay.addEventListener("click", () => {
            selectedStones.clear();
            send({ type: "submit_recast_decision", recast: false, indices: [] });
        });

        const btnRecast = document.createElement("button");
        btnRecast.textContent = `Recast (${selectedStones.size} selected)`;
        btnRecast.addEventListener("click", () => {
            const indices = Array.from(selectedStones);
            selectedStones.clear();
            send({ type: "submit_recast_decision", recast: true, indices });
        });

        row.appendChild(btnStay);
        row.appendChild(btnRecast);
        uiPanel.appendChild(row);
    }

    if (s.phase === "action" && s.activePlayer === playerIndex) {
        if (actionTakenLocal) {
            const info = document.createElement("div");
            info.textContent = "Action submitted — waiting for resolution...";
            uiPanel.appendChild(info);
            return;
        }

        const action = s.pendingAction;
        if (action === "spell") {
            const btn = document.createElement("button");
            btn.textContent = "Place Gem on a Turret (click turret on board)";
            btn.addEventListener("click", () => {
                actionMode = { mode: "spell" };
                setStatus("Click an empty turret to place your gem.");
            });
            uiPanel.appendChild(btn);
        } else if (action === "potion") {
            const btn = document.createElement("button");
            btn.textContent = "Swap Gems (click your gem, then adjacent opponent gem)";
            btn.addEventListener("click", () => {
                actionMode = { mode: "potion_my", myTurret: null };
                setStatus("Click one of your turret gems.");
            });
            uiPanel.appendChild(btn);
        } else if (action === "charm") {
            const btn = document.createElement("button");
            btn.textContent = "Knock Opponent Gem (click opponent turret gem)";
            btn.addEventListener("click", () => {
                actionMode = { mode: "charm" };
                setStatus("Click an opponent's turret gem to knock it off.");
            });
            uiPanel.appendChild(btn);
        }
        // Allow the winner to skip doing anything for this action
        const btnSkip = document.createElement("button");
        btnSkip.textContent = "Skip (do nothing)";
        btnSkip.addEventListener("click", () => {
            actionMode = { mode: "none" };
            setStatus("Skipped action.");
            actionTakenLocal = true;
            send({ type: "action_skip" });
        });
        uiPanel.appendChild(btnSkip);
    }
}

// ─── Render loop ──────────────────────────────────────────────────────────────

function loop() {
    render();
    requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
