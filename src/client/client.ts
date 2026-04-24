import { GameState, Hand, StoneFace, CastResult, CastType, Shape, SHAPE_SIDES, ServerMessage, ClientMessage, classifyCast } from "../shared/game.js";

// ─── Connection ───────────────────────────────────────────────────────────────

const protocol = location.protocol === "https:" ? "wss" : "ws";
const ws = new WebSocket(`${protocol}://${location.host}`);

let playerIndex: 0 | 1 | null = null;
let gameState: GameState | null = null;
let roomCode: string | null = null;

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const mainMenu = document.getElementById("main-menu")!;
const matchSection = document.getElementById("match")!;
const btnCreate = document.getElementById("btn-create") as HTMLButtonElement;
const btnJoin = document.getElementById("btn-join") as HTMLButtonElement;
const joinInput = document.getElementById("join-input") as HTMLInputElement;
const codeDisplayWrap = document.getElementById("code-display-wrap")!;
const codeDisplay = document.getElementById("code-display")!;
const btnBackRoom = document.getElementById("btn-back-room") as HTMLButtonElement;
const statusBar = document.getElementById("status-bar")!;
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const comboOverlayWrap = document.getElementById("combo-overlay-wrap") as HTMLDivElement | null;
const comboOverlay = document.getElementById("combo-overlay") as HTMLCanvasElement | null;
const comboCtx = comboOverlay?.getContext("2d") ?? null;
const comboClose = document.getElementById("combo-close") as HTMLButtonElement | null;
const comboOpen = document.getElementById("combo-open") as HTMLButtonElement | null;
const btnLeaveMatch = document.getElementById("btn-leave-match") as HTMLButtonElement | null;
const uiPanel = document.getElementById("ui-panel")!;
const outcomeBanner = document.getElementById("outcome-banner")!;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function send(msg: ClientMessage) {
    ws.send(JSON.stringify(msg));
}

function setStatus(t: string) {
    statusBar.textContent = t;
}

function styleActionButton(btn: HTMLButtonElement) {
    btn.className =
        "rounded-xl border border-arcane-gold/70 bg-arcane-panel/80 px-5 py-2 font-medium tracking-[0.08em] text-arcane-gold transition hover:bg-arcane-panelLight hover:border-arcane-gold disabled:cursor-default disabled:opacity-40";
}

// ─── Lobby wiring ─────────────────────────────────────────────────────────────

btnCreate.addEventListener("click", () => send({ type: "create_room" }));
btnJoin.addEventListener("click", () => {
    const code = joinInput.value.trim().toUpperCase();
    if (code.length < 2) return;
    send({ type: "join_room", code });
});

codeDisplay.addEventListener("click", () => {
    const code = codeDisplay.textContent?.trim();
    if (code) {
        navigator.clipboard.writeText(code).then(() => {
            setStatus("Code copied to clipboard!");
            setTimeout(() => setStatus("Waiting for opponent… share this code!"), 2000);
        });
    }
});

btnBackRoom.addEventListener("click", () => {
    location.reload();
});

btnLeaveMatch?.addEventListener("click", () => {
    location.reload();
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
            mainMenu.classList.add("hidden");
            codeDisplayWrap.classList.remove("hidden");
            codeDisplay.textContent = msg.code;
            setStatus("Waiting for opponent… share this code!");
            break;

        case "room_joined":
            playerIndex = msg.playerIndex;
            roomCode = msg.code;
            mainMenu.classList.add("hidden");
            codeDisplayWrap.classList.add("hidden");
            codeDisplay.textContent = "";
            setStatus("Joined! Game starting…");
            break;

        case "error":
            setStatus(`Error: ${msg.message}`);
            break;

        case "state_update":
            gameState = msg.state;
            matchSection.classList.remove("hidden");
            codeDisplayWrap.classList.add("hidden");
            codeDisplay.textContent = "";
            canvas.classList.remove("hidden");
            btnLeaveMatch?.classList.remove("hidden");
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
const TURRET_RUNES = ["ᚠ", "ᚱ", "ᚧ", "ᚩ", "ᚥ", "ᚬ", "ᚸ", "ᚻ"] as const;

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

function drawStarCycles(x: number, y: number, points: number, step: number, r: number, rotation: number) {
    const visited = new Array(points).fill(false);
    for (let start = 0; start < points; start++) {
        if (visited[start]) continue;

        let i = start;
        let first = true;
        ctx.beginPath();
        do {
            visited[i] = true;
            const a = rotation + (i / points) * Math.PI * 2;
            const px = x + r * Math.cos(a);
            const py = y + r * Math.sin(a);
            if (first) {
                ctx.moveTo(px, py);
                first = false;
            } else {
                ctx.lineTo(px, py);
            }
            i = (i + step) % points;
        } while (i !== start);
        ctx.closePath();
        ctx.stroke();
    }
}

function drawStarFace(x: number, y: number, value: 4 | 5 | 8 | 9 | 10, r: number) {
    ctx.save();
    ctx.strokeStyle = "#ffe080";
    ctx.lineWidth = 1.8;

    if (value === 4) {
        // Four-point star as a vertical diamond with indented sides (✧-like).
        const oy = r;
        const ox = r * 0.96;
        const ix = r * 0.34;
        const iy = r * 0.34;

        ctx.beginPath();
        ctx.moveTo(x, y - oy);
        ctx.lineTo(x + ix, y - iy);
        ctx.lineTo(x + ox, y);
        ctx.lineTo(x + ix, y + iy);
        ctx.lineTo(x, y + oy);
        ctx.lineTo(x - ix, y + iy);
        ctx.lineTo(x - ox, y);
        ctx.lineTo(x - ix, y - iy);
        ctx.closePath();
        ctx.stroke();
    } else if (value === 5) {
        drawStarCycles(x, y, 5, 2, r, -Math.PI / 2);
    } else if (value === 8) {
        // Vertical stellated octagon {8,2} = two crossing squares.
        drawStarCycles(x, y, 8, 2, r, -Math.PI / 2);
    } else if (value === 9) {
        // Fissal enneagram {9,3} = three crossing triangles.
        drawStarCycles(x, y, 9, 3, r, -Math.PI / 2);
    } else {
        // Vertical stellated decagram {10,4} = two crossing pentagrams.
        drawStarCycles(x, y, 10, 4, r, -Math.PI / 2);
    }

    ctx.restore();
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
        drawStarFace(x, y, face.value, 14);
    }
    ctx.restore();
}

function drawTurret(i: number, owner: 0 | 1 | null, highlighted = false) {
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

    if (highlighted) {
        ctx.beginPath();
        ctx.arc(x, y, TURRET_R + 4, 0, Math.PI * 2);
        ctx.strokeStyle = "#ffd84d";
        ctx.lineWidth = 3;
        ctx.stroke();
    }

    // Label
    ctx.fillStyle = owner === null ? "#504070" : owner === 0 ? "#90c0ff" : "#ff9090";
    ctx.font = owner === null ? "18px Georgia" : owner === 0 ? "25px Georgia" : "20px Georgia";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(owner === null ? TURRET_RUNES[i] : owner === 0 ? "⍺" : "Ω", x, y);
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

    // Tower circle with subtle centered radial gradient
    ctx.beginPath();
    ctx.arc(CX, CY, TOWER_R, 0, Math.PI * 2);
    const towerGrad = ctx.createRadialGradient(CX, CY, TOWER_R * 0.25, CX, CY, TOWER_R);
    towerGrad.addColorStop(0, "rgba(24, 20, 45, 0.12)");
    towerGrad.addColorStop(0.6, "rgba(16,14,28,0.94)");
    towerGrad.addColorStop(1, "#100e1c");
    ctx.fillStyle = towerGrad;
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

function drawOverlayRefArrow(c: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
    const dx = x2 - x1,
        dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    const ux = dx / len,
        uy = dy / len;
    const pad = 24;
    const sx = x1 + ux * pad,
        sy = y1 + uy * pad;
    const ex = x2 - ux * pad,
        ey = y2 - uy * pad;

    c.beginPath();
    c.moveTo(sx, sy);
    c.lineTo(ex, ey);
    c.strokeStyle = "#7a5aa8";
    c.lineWidth = 2;
    c.stroke();

    const angle = Math.atan2(ey - sy, ex - sx);
    const hl = 16;
    c.beginPath();
    c.moveTo(ex, ey);
    c.lineTo(ex - hl * Math.cos(angle - 0.42), ey - hl * Math.sin(angle - 0.42));
    c.lineTo(ex - hl * Math.cos(angle + 0.42), ey - hl * Math.sin(angle + 0.42));
    c.closePath();
    c.fillStyle = "#7a5aa8";
    c.fill();
}

function drawComboOverlay() {
    if (!comboOverlay || !comboCtx) return;
    const c = comboCtx;
    const ow = comboOverlay.width; // 280
    const oh = comboOverlay.height; // 390
    const cx = ow / 2;

    c.clearRect(0, 0, ow, oh);

    const bg = c.createLinearGradient(0, 0, 0, oh);
    bg.addColorStop(0, "#0c0920");
    bg.addColorStop(1, "#080614");
    c.fillStyle = bg;
    c.fillRect(0, 0, ow, oh);

    c.strokeStyle = "#3a2a5a";
    c.lineWidth = 1;
    c.strokeRect(0.5, 0.5, ow - 1, oh - 1);

    // ── Section 1: Victory Effects ──────────────────────────────
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.font = "bold 10px Georgia";
    c.fillStyle = "#7f6aa5";
    c.fillText("VICTORY EFFECTS", cx, 20);

    const effects = [
        { sym: "✨", label: "Spell", effect: "Place gem on empty turret" },
        { sym: "⚗️", label: "Potion", effect: "Swap gem with any foe gem" },
        { sym: "🔮", label: "Charm", effect: "Knock foe's gem off the tower" },
    ];
    const effectStartY = 56;
    const effectRowH = 36;
    for (let i = 0; i < effects.length; i++) {
        const ey = effectStartY + i * effectRowH;
        const { sym, label, effect } = effects[i];
        c.textAlign = "left";
        c.font = "18px Georgia";
        c.fillStyle = "#ffe080";
        c.fillText(sym, 14, ey);
        c.font = "bold 11px Georgia";
        c.fillStyle = "#c8b7e2";
        c.fillText(label, 44, ey - 7);
        c.font = "14px Georgia";
        c.fillStyle = "#9f8cbc";
        c.fillText(effect, 44, ey + 10);
    }

    // Divider
    const divY = effectStartY + effects.length * effectRowH + 6;
    c.beginPath();
    c.moveTo(14, divY);
    c.lineTo(ow - 14, divY);
    c.strokeStyle = "#3a2a5a";
    c.lineWidth = 1;
    c.stroke();

    // ── Section 2: Combo Cycle ───────────────────────────────────
    const comboTitleY = divY + 28;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.font = "bold 10px Georgia";
    c.fillStyle = "#7f6aa5";
    c.fillText("COMBO CYCLE", cx, comboTitleY - 8);

    const triCY = comboTitleY + 100;
    const triR = 72;
    const spell: [number, number] = [cx, triCY - triR];
    const potion: [number, number] = [cx + triR * Math.cos(Math.PI / 2 + (2 * Math.PI) / 3), triCY - triR * Math.sin(Math.PI / 2 + (2 * Math.PI) / 3)];
    const charm: [number, number] = [cx + triR * Math.cos(Math.PI / 2 - (2 * Math.PI) / 3), triCY - triR * Math.sin(Math.PI / 2 - (2 * Math.PI) / 3)];

    drawOverlayRefArrow(c, spell[0], spell[1], potion[0], potion[1]);
    drawOverlayRefArrow(c, potion[0], potion[1], charm[0], charm[1]);
    drawOverlayRefArrow(c, charm[0], charm[1], spell[0], spell[1]);

    const comboNodes = [
        { pos: spell, sym: "✨", name: "Spell", rule: "3 ⬢ + 2 ★" },
        { pos: potion, sym: "⚗️", name: "Potion", rule: "4 ⬢ + 1 ★" },
        { pos: charm, sym: "🔮", name: "Charm", rule: "4 ★ + 1 ⬢" },
    ];

    for (const { pos, sym, name, rule } of comboNodes) {
        c.textAlign = "center";
        c.font = "19px Georgia";
        c.fillStyle = "#ffe080";
        c.fillText(sym, pos[0], pos[1] - 12);

        c.font = "12px Georgia";
        c.fillStyle = "#c8b7e2";
        c.fillText(name, pos[0], pos[1] + 8);

        c.font = "16px Georgia";
        c.fillStyle = "#9f8cbc";
        c.fillText(rule, pos[0] + (sym === "✨" ? 55 : 0), pos[1] + (sym === "✨" ? 0 : 28));
    }
}

function setupMobileComboToggle() {
    if (!comboOverlayWrap || !comboClose || !comboOpen) return;

    comboOpen.addEventListener("click", () => {
        comboOverlayWrap.classList.remove("hidden");
        comboOpen.classList.add("hidden");
    });

    comboClose.addEventListener("click", () => {
        comboOverlayWrap.classList.add("hidden");
        comboOpen.classList.remove("hidden");
    });

    // Initially show open button, hide overlay wrap
    comboOverlayWrap.classList.add("hidden");
    comboOpen.classList.remove("hidden");
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
    else if (cast.type === "full_charm") detail = "All Stars";
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

    // Turrets
    for (let i = 0; i < 8; i++) {
        const highlightSwapSelection =
            s.phase === "action" && s.activePlayer === playerIndex && !actionTakenLocal && actionMode.mode === "potion_my" && actionMode.myTurret === i;
        drawTurret(i, s.board[i], highlightSwapSelection);
    }

    // Gem line counts — always show the local player at the bottom
    const gemLineColors = ["#90c0ff", "#ff9090"];
    for (const pi of [0, 1] as const) {
        const y = pi === playerIndex ? H - 16 : 16;
        ctx.save();
        ctx.font = "16px Georgia";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = gemLineColors[pi];
        ctx.fillText(`${pi === 0 ? "⍺" : "Ω"}${pi === playerIndex ? " (you)" : ""} — Gems: ${s.gemsLine[pi]}`, CX, y);
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
            if (s.activePlayer === playerIndex) {
                // Show action instructions in phase text for the winner
                if (actionTakenLocal) {
                    phaseText = "";
                } else {
                    const actionName = s.pendingAction?.toUpperCase();
                    if (s.pendingAction === "spell") {
                        phaseText = `${actionName} — Click an empty turret`;
                    } else if (s.pendingAction === "potion") {
                        if (actionMode.mode === "potion_my" && actionMode.myTurret !== null) {
                            phaseText = `${actionName} — Click any opponent gem`;
                        } else {
                            phaseText = `${actionName} — Click your gem first`;
                        }
                    } else if (s.pendingAction === "charm") {
                        phaseText = `${actionName} — Click opponent's gem to knock off`;
                    }
                }
            } else {
                phaseText = `Opponent is executing their ${s.pendingAction?.toUpperCase()}.`;
            }
            break;
        case "gameover":
            phaseText = s.winner === playerIndex ? "🏆 You won the match!" : "💀 You lost the match.";
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
                  ? `Won! (${s.lastOutcome.reason})`
                  : `Lost. (${s.lastOutcome.reason})`;
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
            // Already have a gem selected; check if clicking another of our own gems to switch
            if (s.board[i] === playerIndex) {
                actionMode = { mode: "potion_my", myTurret: i };
                setStatus("Now click any opponent turret gem.");
                return;
            }
            // pick opponent gem
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

    if (s.phase === "casting") {
        // Auto-roll is handled server-side; client just needs to confirm
        const hand = s.hands[playerIndex];
        if (hand) {
            const row = document.createElement("div");
            row.className = "flex items-center gap-3";

            const btn = document.createElement("button");
            styleActionButton(btn);
            if (s.castReady[playerIndex]) {
                btn.textContent = "Cast Confirmed";
                btn.disabled = true;
            } else {
                btn.textContent = "Confirm Cast";
                btn.addEventListener("click", () => {
                    send({ type: "submit_cast", hand: hand });
                });
            }

            const ready = document.createElement("span");
            const readyCount = Number(s.castReady[0]) + Number(s.castReady[1]);
            ready.textContent = `${readyCount}/2`;
            ready.className = "text-sm text-arcane-purpleLight";

            row.appendChild(btn);
            row.appendChild(ready);
            uiPanel.appendChild(row);
        }
    }

    if (s.phase === "recast") {
        const row = document.createElement("div");
        row.className = "flex items-center gap-3";

        if (s.recastDecision[playerIndex] === null) {
            const btnStay = document.createElement("button");
            btnStay.textContent = "Stay";
            styleActionButton(btnStay);
            btnStay.addEventListener("click", () => {
                selectedStones.clear();
                send({ type: "submit_recast_decision", recast: false, indices: [] });
            });

            const btnRecast = document.createElement("button");
            btnRecast.textContent = `Recast (${selectedStones.size} selected)`;
            styleActionButton(btnRecast);
            btnRecast.addEventListener("click", () => {
                const indices = Array.from(selectedStones);
                selectedStones.clear();
                send({ type: "submit_recast_decision", recast: true, indices });
            });

            row.appendChild(btnStay);
            row.appendChild(btnRecast);
        } else {
            const btn = document.createElement("button");
            btn.textContent = "Recast Locked";
            styleActionButton(btn);
            btn.disabled = true;
            row.appendChild(btn);
        }

        const ready = document.createElement("span");
        const readyCount = Number(s.recastDecision[0] !== null) + Number(s.recastDecision[1] !== null);
        ready.textContent = `${readyCount}/2`;
        ready.className = "text-sm text-arcane-purpleLight";

        row.appendChild(ready);
        uiPanel.appendChild(row);
    }

    if (s.phase === "action" && s.activePlayer === playerIndex) {
        if (actionTakenLocal) {
            const info = document.createElement("div");
            info.textContent = "Waiting for opponent…";
            info.className = "text-sm text-arcane-purpleLight";
            uiPanel.appendChild(info);
            return;
        }

        // Automatically activate action mode for direct turret clicking
        const action = s.pendingAction;
        if (actionMode.mode === "none" && action) {
            if (action === "spell") {
                actionMode = { mode: "spell" };
            } else if (action === "potion") {
                actionMode = { mode: "potion_my", myTurret: null };
            } else if (action === "charm") {
                actionMode = { mode: "charm" };
            }
        }

        // Only show Skip button
        const btnSkip = document.createElement("button");
        btnSkip.textContent = "Skip";
        styleActionButton(btnSkip);
        btnSkip.addEventListener("click", () => {
            actionMode = { mode: "none" };
            actionTakenLocal = true;
            send({ type: "action_skip" });
            updateUI();
        });
        uiPanel.appendChild(btnSkip);
    }

    if (s.phase === "gameover") {
        const myReady = s.rematchReady[playerIndex];
        const opReady = s.rematchReady[playerIndex === 0 ? 1 : 0];
        if (!myReady) {
            const btn = document.createElement("button");
            btn.textContent = "Rematch";
            styleActionButton(btn);
            btn.addEventListener("click", () => {
                send({ type: "rematch_request" });
            });
            uiPanel.appendChild(btn);
        } else {
            const info = document.createElement("div");
            info.textContent = opReady ? "Starting rematch…" : "Waiting for opponent to accept rematch…";
            info.className = "text-sm text-arcane-purpleLight";
            uiPanel.appendChild(info);
        }
    }
}

// ─── Render loop ──────────────────────────────────────────────────────────────

function loop() {
    render();
    requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

drawComboOverlay();
setupMobileComboToggle();
