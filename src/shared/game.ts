// ─── Stone faces ─────────────────────────────────────────────────────────────

export type Shape = "triangle" | "square" | "pentagon" | "hexagon" | "octagon";
export type Num = 3 | 4 | 5 | 6 | 8;

export const SHAPES: Shape[] = ["triangle", "square", "pentagon", "hexagon", "octagon"];
export const NUMS: Num[] = [3, 4, 5, 6, 8];
export const SHAPE_SIDES: Record<Shape, number> = {
    triangle: 3,
    square: 4,
    pentagon: 5,
    hexagon: 6,
    octagon: 8,
};

// Each stone face is either a shape or a number
export type StoneFace = { kind: "shape"; value: Shape } | { kind: "number"; value: Num };

// A cast result for 5 stones
export type Hand = StoneFace[]; // length 5

// ─── Cast classifications ─────────────────────────────────────────────────────

export type CastType = "spell" | "regular_potion" | "full_potion" | "regular_charm" | "full_charm" | "bungle";

export interface CastResult {
    type: CastType;
    hand: Hand;
    // For spells: sum of the 2 visible numbers
    spellValue?: number;
    // For potions: highest visible number (regular) or undefined (full)
    potionValue?: Num;
    // For charms: shape with most sides (regular) or undefined (full)
    charmValue?: Shape;
}

export function rollStone(): StoneFace {
    if (Math.random() < 0.5) {
        return { kind: "shape", value: SHAPES[Math.floor(Math.random() * SHAPES.length)] };
    } else {
        return { kind: "number", value: NUMS[Math.floor(Math.random() * NUMS.length)] };
    }
}

export function rollHand(): Hand {
    return Array.from({ length: 5 }, () => rollStone());
}

export function rollSelectedStones(hand: Hand, indices: number[]): Hand {
    return hand.map((stone, i) => (indices.includes(i) ? rollStone() : stone));
}

export function classifyCast(hand: Hand): CastResult {
    const shapes = hand.filter((f) => f.kind === "shape") as { kind: "shape"; value: Shape }[];
    const numbers = hand.filter((f) => f.kind === "number") as { kind: "number"; value: Num }[];

    const sc = shapes.length;
    const nc = numbers.length;

    if (sc === 5) {
        return { type: "full_potion", hand };
    }
    if (sc === 4) {
        const potionValue = numbers[0].value;
        return { type: "regular_potion", hand, potionValue };
    }
    if (nc === 5) {
        return { type: "full_charm", hand };
    }
    if (nc === 4) {
        const charmValue = shapes[0].value;
        return { type: "regular_charm", hand, charmValue };
    }
    if (sc === 3 && nc === 2) {
        const spellValue = numbers.reduce((s, f) => s + f.value, 0);
        return { type: "spell", hand, spellValue };
    }
    // sc === 2 && nc === 3
    return { type: "bungle", hand };
}

// ─── Turn resolution ──────────────────────────────────────────────────────────

export type TurnOutcome = { winner: 0 | 1 | "draw"; reason: string };

/**
 * Returns winner index (0 or 1) or 'draw'.
 * Assumes both casts are finalised.
 */
export function resolveTurn(a: CastResult, b: CastResult): TurnOutcome {
    const ta = normalisedType(a.type);
    const tb = normalisedType(b.type);

    // Bungle loses to everything
    if (ta === "bungle" && tb === "bungle") return { winner: "draw", reason: "Both bungled" };
    if (ta === "bungle") return { winner: 1, reason: "Player 1 bungled" };
    if (tb === "bungle") return { winner: 0, reason: "Player 2 bungled" };

    // Rock-paper-scissors: spell > potion > charm > spell
    if (ta !== tb) {
        if (beats(ta, tb)) return { winner: 0, reason: `${ta} beats ${tb}` };
        return { winner: 1, reason: `${tb} beats ${ta}` };
    }

    // Same category — tiebreak
    if (ta === "spell") {
        const av = a.spellValue ?? 0;
        const bv = b.spellValue ?? 0;
        if (av > bv) return { winner: 0, reason: `Spell ${av} vs ${bv}` };
        if (bv > av) return { winner: 1, reason: `Spell ${bv} vs ${av}` };
        return { winner: "draw", reason: `Spell tie ${av}` };
    }

    if (ta === "potion") {
        // full beats regular
        const aFull = a.type === "full_potion";
        const bFull = b.type === "full_potion";
        if (aFull && !bFull) return { winner: 0, reason: "Full Potion beats regular" };
        if (bFull && !aFull) return { winner: 1, reason: "Full Potion beats regular" };
        if (aFull && bFull) return { winner: "draw", reason: "Both Full Potions" };
        // both regular — compare number
        const av = a.potionValue ?? 0;
        const bv = b.potionValue ?? 0;
        if (av > bv) return { winner: 0, reason: `Potion ${av} vs ${bv}` };
        if (bv > av) return { winner: 1, reason: `Potion ${bv} vs ${av}` };
        return { winner: "draw", reason: `Potion tie` };
    }

    if (ta === "charm") {
        const aFull = a.type === "full_charm";
        const bFull = b.type === "full_charm";
        if (aFull && !bFull) return { winner: 0, reason: "Full Charm beats regular" };
        if (bFull && !aFull) return { winner: 1, reason: "Full Charm beats regular" };
        if (aFull && bFull) return { winner: "draw", reason: "Both Full Charms" };
        const av = SHAPE_SIDES[a.charmValue ?? "triangle"];
        const bv = SHAPE_SIDES[b.charmValue ?? "triangle"];
        if (av > bv) return { winner: 0, reason: `Charm ${a.charmValue} vs ${b.charmValue}` };
        if (bv > av) return { winner: 1, reason: `Charm ${b.charmValue} vs ${a.charmValue}` };
        return { winner: "draw", reason: `Charm tie` };
    }

    return { winner: "draw", reason: "Unknown" };
}

type BaseType = "spell" | "potion" | "charm" | "bungle";

function normalisedType(t: CastType): BaseType {
    if (t === "spell") return "spell";
    if (t === "regular_potion" || t === "full_potion") return "potion";
    if (t === "regular_charm" || t === "full_charm") return "charm";
    return "bungle";
}

function beats(a: BaseType, b: BaseType): boolean {
    return (a === "spell" && b === "potion") || (a === "potion" && b === "charm") || (a === "charm" && b === "spell");
}

// ─── Board / Game state ───────────────────────────────────────────────────────

// 8 turrets around the tower, indexed 0-7 clockwise
export type TurretOwner = 0 | 1 | null;
export type Board = TurretOwner[]; // length 8

export type PhaseKind =
    | "waiting" // waiting for second player
    | "casting" // players rolling their stones
    | "recast" // optional second cast phase
    | "reveal" // showing both results + resolve
    | "action" // winner choosing board action
    | "gameover";

export interface GameState {
    phase: PhaseKind;
    board: Board; // 8 turrets
    gemsLine: [number, number]; // gems remaining in each player's line (max 6 each, tracks how many on board)
    // Whose turn it is to go first (casts first) — just cosmetic info for the client
    activePlayer: 0 | 1;
    // Per-player hands (null = not yet cast)
    hands: [Hand | null, Hand | null];
    casts: [CastResult | null, CastResult | null];
    // Which players have submitted their cast this phase
    castReady: [boolean, boolean];
    // Which players have submitted their recast decision
    recastReady: [boolean, boolean];
    // Which stones each player wants to recast (indices)
    recastIndices: [number[], number[]];
    // Has each player decided to stay or recast?
    recastDecision: [boolean | null, boolean | null]; // true = recast, false = stay
    winner: 0 | 1 | null;
    lastOutcome: TurnOutcome | null;
    // Action phase: which action the winner chose (if waiting)
    pendingAction: "spell" | "potion" | "charm" | null;
    // For potion swap: winner picks their gem turret index, then opponent's adjacent turret
    actionStep: number;
    actionData: number[];
    // Rematch: which players have requested a rematch
    rematchReady: [boolean, boolean];
}

export function initialBoard(): Board {
    return Array(8).fill(null);
}

export function checkWin(board: Board): 0 | 1 | null {
    for (let p = 0; p <= 1; p++) {
        const owner = p as 0 | 1;
        for (let start = 0; start < 8; start++) {
            let win = true;
            for (let k = 0; k < 4; k++) {
                if (board[(start + k) % 8] !== owner) {
                    win = false;
                    break;
                }
            }
            if (win) return owner;
        }
    }
    return null;
}

// Are turrets i and j adjacent on the ring of 8?
export function areAdjacent(i: number, j: number): boolean {
    return Math.abs(i - j) === 1 || Math.abs(i - j) === 7;
}

// ─── WebSocket message protocol ───────────────────────────────────────────────

export type ClientMessage =
    | { type: "create_room" }
    | { type: "join_room"; code: string }
    | { type: "submit_cast"; hand: Hand }
    | { type: "submit_recast_decision"; recast: boolean; indices: number[] }
    | { type: "action_spell"; turretIndex: number }
    | { type: "action_potion"; myTurret: number; opponentTurret: number }
    | { type: "action_charm"; opponentTurret: number }
    | { type: "action_skip" }
    | { type: "rematch_request" };

export type ServerMessage =
    | { type: "room_created"; code: string; playerIndex: 0 | 1 }
    | { type: "room_joined"; code: string; playerIndex: 0 | 1 }
    | { type: "error"; message: string }
    | { type: "state_update"; state: GameState };
