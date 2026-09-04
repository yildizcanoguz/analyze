#!/usr/bin/env node
// The inspection harness. Every critic uses THIS to look at the game — never a
// builder's description of it.
//
//   node game/tools/inspect.mjs --out <dir> [--script <js file>] [--seed N] [--port N]
//
// It boots the game in a real browser, runs an optional interaction script, and
// writes screenshots + a JSON report (console errors, WebGL info, timings, the
// game's own state snapshot). Exit code is non-zero if the game failed to boot.

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer as netServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => {
  if (v.startsWith('--')) a.push([v.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1]]);
  return a;
}, []));

const OUT = resolve(args.out || './inspect-out');
// Parallel agents each need their own server; grab a free port unless told otherwise.
async function freePort() {
  return new Promise((res, rej) => {
    const s = netServer();
    s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); });
    s.on('error', rej);
  });
}
const PORT = Number(args.port || await freePort());
const SEED = args.seed || 1066;
const W = Number(args.w || 1600), H = Number(args.h || 900);
mkdirSync(OUT, { recursive: true });

// start a server if one isn't already up
async function ensureServer() {
  try { const r = await fetch(`http://localhost:${PORT}/`); if (r.ok) return null; } catch {}
  const p = spawn(process.execPath, [join(HERE, 'serve.mjs'), String(PORT)], { stdio: 'ignore', detached: false });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://localhost:${PORT}/`); if (r.ok) return p; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('server would not start');
}

const report = { ok: false, url: '', console: [], pageErrors: [], shots: [], timings: {}, state: null, webgl: null, notes: [] };

const srv = await ensureServer();
const CHROME = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium';
const browser = await chromium.launch({
  executablePath: existsSync(CHROME) ? CHROME : undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--disable-dev-shm-usage', '--no-sandbox', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('console', (m) => report.console.push({ type: m.type(), text: m.text().slice(0, 500) }));
page.on('pageerror', (e) => report.pageErrors.push(String(e).slice(0, 800)));

const url = `http://localhost:${PORT}/?seed=${SEED}`;
report.url = url;
const t0 = Date.now();
await page.goto(url, { waitUntil: 'load', timeout: 60000 });

// wait for the game to declare itself ready
try {
  await page.waitForFunction(() => !document.getElementById('boot') || document.getElementById('boot').classList.contains('gone'), { timeout: 60000 });
  report.ok = true;
} catch (e) { report.notes.push('boot did not complete within 60s'); }
report.timings.bootMs = Date.now() - t0;

report.webgl = await page.evaluate(() => {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  if (!gl) return { ok: false };
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return { ok: true, vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : '?', renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '?' };
});

// expose helpers the interaction scripts use
await page.addScriptTag({ content: `
window.__snap = async (name) => { window.__lastShot = name; };
window.__state = () => {
  const S = window.__S; if (!S) return null;
  return { day:S.day, paused:S.paused, speed:S.speed, playerId:S.playerId,
    chars:Object.keys(S.chars).length, titles:Object.keys(S.titles).length,
    provinces:Object.keys(S.provinces).length,
    openDecisions:S.decisions.filter(d=>d.state==='open').length,
    pendingDecisions:S.decisions.filter(d=>d.state==='pending').length,
    memories:S.memories.length, chronicle:S.chronicle.length, stats:S.stats };
};
`});

let shotN = 0;
async function shot(name) {
  const f = join(OUT, `${String(++shotN).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: f });
  report.shots.push(f);
  return f;
}

// --- default pass: look at the world -----------------------------------------
await page.waitForTimeout(3800);   // let the opening camera move settle
await shot('opening');

if (args.script && existsSync(resolve(args.script))) {
  const mod = await import('file://' + resolve(args.script));
  await mod.default({ page, shot, report, W, H });
} else {
  // built-in default tour
  await page.keyboard.press('Space');                // start time
  await page.waitForTimeout(2500);
  await shot('running');
  for (const [k, n] of [['3', 'culture'], ['4', 'faith'], ['5', 'terrain'], ['7', 'opinion'], ['1', 'realm']]) {
    await page.keyboard.press(k); await page.waitForTimeout(700); await shot('mode-' + n);
  }
  // zoom out to the parchment map
  await page.mouse.move(W / 2, H / 2);
  for (let i = 0; i < 16; i++) { await page.mouse.wheel(0, 240); await page.waitForTimeout(60); }
  await page.waitForTimeout(1200); await shot('parchment');
  for (let i = 0; i < 26; i++) { await page.mouse.wheel(0, -240); await page.waitForTimeout(60); }
  await page.waitForTimeout(1200); await shot('close');
  // click a province
  await page.mouse.click(W * 0.5, H * 0.55); await page.waitForTimeout(600); await shot('province');
  // fast-forward until the world puts a decision in front of us
  for (let i = 0; i < 30 && !(await page.evaluate(() => !!document.querySelector('.dec'))); i++) {
    await page.evaluate(() => window.__advance?.(120));
    await page.waitForTimeout(220);
  }
  if (await page.evaluate(() => !!document.querySelector('.dec'))) {
    await page.waitForTimeout(1400);
    await shot('decision');
    // open the hold-to-commit gate on the heaviest option, if there is one
    const irrev = await page.$('.opt.irrev');
    if (irrev) { await irrev.click(); await page.waitForTimeout(900); await shot('gate'); }
  } else report.notes.push('no decision appeared after 3600 simulated days');
}

report.state = await page.evaluate(() => window.__state?.());
report.timings.totalMs = Date.now() - t0;
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));

// a human-readable summary so a critic sees the important bits immediately
const sum = [
  `boot: ${report.ok ? 'OK' : 'FAILED'} in ${report.timings.bootMs}ms`,
  `webgl: ${report.webgl?.ok ? report.webgl.renderer : 'NONE'}`,
  `page errors: ${report.pageErrors.length}`,
  ...report.pageErrors.slice(0, 6).map((e) => '  ! ' + e.split('\n')[0]),
  `console errors: ${report.console.filter((c) => c.type === 'error').length}`,
  ...report.console.filter((c) => c.type === 'error').slice(0, 8).map((c) => '  ! ' + c.text.slice(0, 200)),
  `state: ${JSON.stringify(report.state)}`,
  `shots: ${report.shots.length} -> ${OUT}`,
].join('\n');
writeFileSync(join(OUT, 'summary.txt'), sum);
console.log(sum);

await browser.close();
srv?.kill();
process.exit(report.ok && report.pageErrors.length === 0 ? 0 : 1);
