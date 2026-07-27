// Tiny synchronous event bus. Owned by integration — do not edit.

export default class EventBus {
  constructor() {
    this._map = new Map();
    this._depth = 0;
  }

  on(name, fn) {
    let set = this._map.get(name);
    if (!set) this._map.set(name, (set = new Set()));
    set.add(fn);
    return () => this.off(name, fn);
  }

  once(name, fn) {
    const un = this.on(name, (p) => { un(); fn(p); });
    return un;
  }

  off(name, fn) {
    this._map.get(name)?.delete(fn);
  }

  emit(name, payload) {
    const set = this._map.get(name);
    if (!set || set.size === 0) return;
    // Copy so handlers can subscribe/unsubscribe during dispatch.
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[events] handler for "${name}" threw:`, err);
      }
    }
  }

  clear(name) {
    if (name) this._map.delete(name);
    else this._map.clear();
  }
}
