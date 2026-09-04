// P04 — Yankı. The ledger of things the world will not let you forget.
import { S } from '../core/state.js';
export function recall(pred) { return S.memories.filter(pred); }
export function tickEchoes(day) { /* P04 fills this in */ }
