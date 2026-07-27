// Batch fx shots: open the bench once, fire N frozen effects, screenshot each.
// usage: node fxshots.mjs <quality> <outPrefix> <name:delay:cam> ...
import { chromium } from 'playwright';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = '/home/user/analyze';
const quality = process.argv[2] || 'high';
const prefix = process.argv[3] || 'fx';
const jobs = process.argv.slice(4).map((s) => {
  const [name, delay, cam, extra] = s.split(':');
  return { name, delay: parseFloat(delay || '0.02'), cam: cam || '', extra: extra || '' };
});

const W = Number(process.env.W || 1280), H = Number(process.env.H || 720);

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox', '--disable-dev-shm-usage',
    '--hide-scrollbars', '--js-flags=--max-old-space-size=4096'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.text()); });
page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message + '\n' + (e.stack || '').slice(0, 600)));

const url = `http://localhost:8099/dev/fx.html?quality=${quality}&mode=manual&hud=${process.env.HUD || '1'}`;
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__ready === true || window.__crashed === true, null, { timeout: 300000 });
if (await page.evaluate(() => !!window.__crashed)) {
  console.log('CRASH:', await page.evaluate(() => document.getElementById('err')?.textContent?.slice(0, 3000)));
  await browser.close(); process.exit(1);
}
if (process.env.HUD === '0') await page.evaluate(() => { document.getElementById('hud').style.display = 'none'; });

for (const j of jobs) {
  await page.evaluate(([n, d, c]) => window.__shot(n, d, c || undefined), [j.name, j.delay, j.cam]);
  // let the frozen frame render a few times
  await page.waitForFunction(() => window.__frozenReady === true, null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(Number(process.env.SETTLE || 2500));
  const out = `${ROOT}/game/shots/${prefix}-${j.name}-${String(j.delay).replace(".","p")}.png`;
  await page.screenshot({ path: out });
  const dbg = await page.evaluate(() => {
    const f = window.__game.fx;
    return {
      p: f.particles.count, ic: f.particles.geometry.instanceCount,
      vis: f.particles.mesh.visible, soft: f.particles.softCount,
      dec: f.decals.decals.length, drawRange: f.decals.geometry.drawRange.count,
      shells: f.shells.shells.length, t: f.particles._time,
      b0: Array.from(f.particles.data.slice(0, 8)),
    };
  });
  console.log('shot', out, JSON.stringify(dbg));
}

const info = await page.evaluate(() => {
  const i = window.__game.renderer.info;
  return { calls: i.render.calls, tris: i.render.triangles, programs: i.programs?.length, textures: i.memory.textures };
});
console.log(JSON.stringify(info));
if (logs.length) console.log('LOGS:', JSON.stringify(logs.slice(0, 20), null, 1));
await browser.close();
