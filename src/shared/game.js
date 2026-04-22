// ─── Stone faces ─────────────────────────────────────────────────────────────
export const SHAPES = ['triangle', 'square', 'pentagon', 'hexagon', 'octagon'];
export const NUMS = [3, 4, 5, 6, 8];
export const SHAPE_SIDES = {
    triangle: 3,
    square: 4,
    pentagon: 5,
    hexagon: 6,
    octagon: 8,
};
export function rollStone() {
    if (Math.random() < 0.5) {
        return { kind: 'shape', value: SHAPES[Math.floor(Math.random() * SHAPES.length)] };
    }
    else {
        return { kind: 'number', value: NUMS[Math.floor(Math.random() * NUMS.length)] };
    }
}
export function rollHand() {
    return Array.from({ length: 5 }, () => rollStone());
}
export function rollSelectedStones(hand, indices) {
    return hand.map((stone, i) => (indices.includes(i) ? rollStone() : stone));
}
export function classifyCast(hand) {
    const shapes = hand.filter(f => f.kind === 'shape');
    const numbers = hand.filter(f => f.kind === 'number');
    const sc = shapes.length;
    const nc = numbers.length;
    if (sc === 5) {
        return { type: 'full_potion', hand };
    }
    if (sc === 4) {
        const potionValue = numbers[0].value;
        return { type: 'regular_potion', hand, potionValue };
    }
    if (nc === 5) {
        return { type: 'full_charm', hand };
    }
    if (nc === 4) {
        const charmValue = shapes[0].value;
        return { type: 'regular_charm', hand, charmValue };
    }
    if (sc === 3 && nc === 2) {
        const spellValue = numbers.reduce((s, f) => s + f.value, 0);
        return { type: 'spell', hand, spellValue };
    }
    // sc === 2 && nc === 3
    return { type: 'bungle', hand };
}
/**
 * Returns winner index (0 or 1) or 'draw'.
 * Assumes both casts are finalised.
 */
export function resolveTurn(a, b) {
    const ta = normalisedType(a.type);
    const tb = normalisedType(b.type);
    // Bungle loses to everything
    if (ta === 'bungle' && tb === 'bungle')
        return { winner: 'draw', reason: 'Both bungled' };
    if (ta === 'bungle')
        return { winner: 1, reason: 'Player 1 bungled' };
    if (tb === 'bungle')
        return { winner: 0, reason: 'Player 2 bungled' };
    // Rock-paper-scissors: spell > potion > charm > spell
    if (ta !== tb) {
        if (beats(ta, tb))
            return { winner: 0, reason: `${ta} beats ${tb}` };
        return { winner: 1, reason: `${tb} beats ${ta}` };
    }
    // Same category — tiebreak
    if (ta === 'spell') {
        const av = a.spellValue ?? 0;
        const bv = b.spellValue ?? 0;
        if (av > bv)
            return { winner: 0, reason: `Spell ${av} vs ${bv}` };
        if (bv > av)
            return { winner: 1, reason: `Spell ${bv} vs ${av}` };
        return { winner: 'draw', reason: `Spell tie ${av}` };
    }
    if (ta === 'potion') {
        // full beats regular
        const aFull = a.type === 'full_potion';
        const bFull = b.type === 'full_potion';
        if (aFull && !bFull)
            return { winner: 0, reason: 'Full Potion beats regular' };
        if (bFull && !aFull)
            return { winner: 1, reason: 'Full Potion beats regular' };
        if (aFull && bFull)
            return { winner: 'draw', reason: 'Both Full Potions' };
        // both regular — compare number
        const av = a.potionValue ?? 0;
        const bv = b.potionValue ?? 0;
        if (av > bv)
            return { winner: 0, reason: `Potion ${av} vs ${bv}` };
        if (bv > av)
            return { winner: 1, reason: `Potion ${bv} vs ${av}` };
        return { winner: 'draw', reason: `Potion tie` };
    }
    if (ta === 'charm') {
        const aFull = a.type === 'full_charm';
        const bFull = b.type === 'full_charm';
        if (aFull && !bFull)
            return { winner: 0, reason: 'Full Charm beats regular' };
        if (bFull && !aFull)
            return { winner: 1, reason: 'Full Charm beats regular' };
        if (aFull && bFull)
            return { winner: 'draw', reason: 'Both Full Charms' };
        const av = SHAPE_SIDES[a.charmValue ?? 'triangle'];
        const bv = SHAPE_SIDES[b.charmValue ?? 'triangle'];
        if (av > bv)
            return { winner: 0, reason: `Charm ${a.charmValue} vs ${b.charmValue}` };
        if (bv > av)
            return { winner: 1, reason: `Charm ${b.charmValue} vs ${a.charmValue}` };
        return { winner: 'draw', reason: `Charm tie` };
    }
    return { winner: 'draw', reason: 'Unknown' };
}
function normalisedType(t) {
    if (t === 'spell')
        return 'spell';
    if (t === 'regular_potion' || t === 'full_potion')
        return 'potion';
    if (t === 'regular_charm' || t === 'full_charm')
        return 'charm';
    return 'bungle';
}
function beats(a, b) {
    return ((a === 'spell' && b === 'potion') ||
        (a === 'potion' && b === 'charm') ||
        (a === 'charm' && b === 'spell'));
}
export function initialBoard() {
    return Array(8).fill(null);
}
export function checkWin(board) {
    for (let p = 0; p <= 1; p++) {
        const owner = p;
        for (let start = 0; start < 8; start++) {
            let win = true;
            for (let k = 0; k < 4; k++) {
                if (board[(start + k) % 8] !== owner) {
                    win = false;
                    break;
                }
            }
            if (win)
                return owner;
        }
    }
    return null;
}
// Are turrets i and j adjacent on the ring of 8?
export function areAdjacent(i, j) {
    return Math.abs(i - j) === 1 || Math.abs(i - j) === 7;
}
