// P02 — the signals that arrive while you wait. They must be honest enough to
// read and unreliable enough to misread.
export function tellsFor(decision) { return decision?.options?.find?.((o) => o.key === decision.chosen)?.tells || []; }
