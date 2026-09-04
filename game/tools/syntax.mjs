// Fast parse check for every game module. Distinguishes a real syntax error
// (fatal) from a browser-only runtime reference (expected under node).
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
const ROOT = new URL('../src/', import.meta.url).pathname;
function walk(d, out = []) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (f.endsWith('.js')) out.push(p);
  }
  return out;
}
let bad = 0;
for (const f of walk(ROOT)) {
  try { await import(pathToFileURL(f).href); }
  catch (e) {
    const syntax = e instanceof SyntaxError || /SyntaxError|Unexpected|has already been declared|does not provide an export|Cannot find module/.test(String(e));
    if (syntax) { console.log(`FAIL ${relative(ROOT, f)}: ${String(e).split('\n')[0]}`); bad++; }
  }
}
console.log(bad ? `${bad} module(s) failed to parse/link` : 'all modules parse and link');
process.exit(bad ? 1 : 0);
