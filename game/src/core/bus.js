// Pub/sub. The only sanctioned way for modules to talk to each other.
// Sim modules emit; render and ui listen. Never the reverse (ui calls sim APIs
// directly, but sim must never import ui).

const handlers = new Map();
let depth = 0;
const queue = [];

export function on(evt, fn) {
  if (!handlers.has(evt)) handlers.set(evt, new Set());
  handlers.get(evt).add(fn);
  return () => off(evt, fn);
}
export function once(evt, fn) {
  const un = on(evt, (p) => { un(); fn(p); });
  return un;
}
export function off(evt, fn) { handlers.get(evt)?.delete(fn); }

export function emit(evt, payload) {
  queue.push([evt, payload]);
  if (depth > 0) return;
  depth++;
  try {
    while (queue.length) {
      const [e, p] = queue.shift();
      const hs = handlers.get(e);
      if (hs) for (const fn of Array.from(hs)) {
        try { fn(p, e); } catch (err) { console.error(`[bus] handler for "${e}" threw`, err); }
      }
      const stars = handlers.get('*');
      if (stars) for (const fn of Array.from(stars)) { try { fn(p, e); } catch (err) { console.error(err); } }
    }
  } finally { depth--; }
}
export function clearAll() { handlers.clear(); queue.length = 0; }
