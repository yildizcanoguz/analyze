// Each UI piece injects its own stylesheet under a stable key, so 21 parallel
// authors never fight over one style.css.
const tags = new Map();
export function css(key, text) {
  let el = tags.get(key);
  if (!el) { el = document.createElement('style'); el.dataset.piece = key; document.head.appendChild(el); tags.set(key, el); }
  el.textContent = text;
}
