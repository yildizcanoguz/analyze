// Headless screenshot + diagnostics harness.
//   node tools/shot.mjs <url> <out.png> [--wait 4000] [--w 1600] [--h 900]
//                       [--script "await window.__game..."] [--frames 60] [--quiet]
//
// Prints a JSON diagnostics blob (console errors, missing/failed systems, perf) to stdout.
import { chromium } from 'playwright';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : def;
}
const has = (name) => process.argv.includes(`--${name}`);

const url = process.argv[2];
const out = process.argv[3];
if (!url || !out) { console.error('usage: shot.mjs <url> <out.png> [opts]'); process.exit(2); }

const W = Number(arg('w', 1600));
const H = Number(arg('h', 900));
const WAIT = Number(arg('wait', 4000));
const FRAMES = Number(arg('frames', 60));
const SCRIPT = arg('script', null);
const QUIET = has('quiet');

const browser = await chromium.launch({
  executablePath: CHROME,
  args: [
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist', '--enable-webgl',
    '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars',
    '--disable-features=CalculateNativeWinOcclusion',
    '--js-flags=--max-old-space-size=4096',
  ],
});

const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });

const logs = [];
page.on('console', (m) => {
  const t = m.type();
  if (t === 'error' || t === 'warning') logs.push({ type: t, text: m.text() });
  if (!QUIET) console.error(`[${t}] ${m.text()}`);
});
page.on('pageerror', (e) => {
  logs.push({ type: 'pageerror', text: e.message, stack: (e.stack || '').slice(0, 800) });
  if (!QUIET) console.error('[pageerror]', e.message);
});

const diag = { url, ok: false };
try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__ready === true || window.__crashed === true,
    null, { timeout: 180000 });

  diag.crashed = await page.evaluate(() => !!window.__crashed);
  if (diag.crashed) {
    diag.crashText = await page.evaluate(
      () => document.getElementById('crash')?.textContent?.slice(0, 4000));
  }

  // Let the scene settle (TAA convergence, animation warmup, particle spin-up).
  await page.waitForTimeout(WAIT);

  if (SCRIPT) {
    try {
      diag.scriptResult = await page.evaluate(`(async () => { ${SCRIPT} })()`);
    } catch (e) {
      diag.scriptError = e.message;
      if (!QUIET) console.error('[script error]', e.message);
    }
    await page.waitForTimeout(Number(arg('postwait', 1200)));
  }

  diag.perf = await page.evaluate(async (frames) => {
    const t0 = performance.now();
    let n = 0;
    await new Promise((res) => {
      const tick = () => { if (++n >= frames) return res(); requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    const ms = (performance.now() - t0) / n;
    const info = window.__game?.renderer?.info;
    return {
      msPerFrame: +ms.toFixed(2),
      fps: +(1000 / ms).toFixed(1),
      drawCalls: info?.render?.calls ?? null,
      triangles: info?.render?.triangles ?? null,
      programs: info?.programs?.length ?? null,
      textures: info?.memory?.textures ?? null,
      geometries: info?.memory?.geometries ?? null,
    };
  }, FRAMES).catch(() => null);

  diag.missing = await page.evaluate(() => window.__missing || []);
  diag.failed = await page.evaluate(() => window.__failed || []);

  await page.screenshot({ path: out });
  diag.ok = !diag.crashed;
  diag.screenshot = out;
} catch (err) {
  diag.error = err.message;
  try { await page.screenshot({ path: out }); } catch {}
}

diag.logs = logs.slice(0, 40);
await browser.close();
console.log(JSON.stringify(diag, null, 2));
process.exit(diag.ok ? 0 : 1);
