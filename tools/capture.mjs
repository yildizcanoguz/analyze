// Scenario capture harness — drives the running game into specific states and shoots them.
//
//   node tools/capture.mjs                 # every preset
//   node tools/capture.mjs hipfire ads     # named presets
//   node tools/capture.mjs --list
//   node tools/capture.mjs --out game/shots/round3 --w 1920 --h 1080
//
// Presets place the camera/player, force game state, and wait for the scene to settle, so the
// critic agents grade the same framings every round and can diff them across iterations.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://localhost:8099/index.html?nolock&quality=ultra';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i > -1 ? argv[i + 1] : d; };
const hasFlag = (n) => argv.includes(`--${n}`);
const OUT = flag('out', 'game/shots/latest');
const W = Number(flag('w', 1920));
const H = Number(flag('h', 1080));

// A preset is { name, desc, hud, setup } where setup runs in the page with `g = window.__game`.
// Setup helpers are injected as window.__cap before setup runs.
const PRESETS = [
  {
    name: 'street-wide',
    desc: 'Wide establishing shot down the main street — reads scale, lighting, grade, fog.',
    hud: false,
    setup: `__cap.view([0, 1.68, 26], [0, 1.5, -10]);`,
  },
  {
    name: 'street-sun',
    desc: 'Looking toward the sun — tests aerial perspective, bloom, god rays, lens behaviour.',
    hud: false,
    setup: `__cap.lookAtSun([0, 1.68, 10]);`,
  },
  {
    name: 'interior-shaft',
    desc: 'Interior with a window — the volumetric shaft and interior/exterior contrast shot.',
    hud: false,
    setup: `__cap.interior();`,
  },
  {
    name: 'material-closeup',
    desc: 'Close on a wall/floor junction — texel density, normal detail, AO, edge wear.',
    hud: false,
    setup: `__cap.closeup();`,
  },
  {
    name: 'hipfire',
    desc: 'Standard gameplay framing, HUD on, weapon at hip.',
    hud: true,
    setup: `__cap.gameplay();`,
  },
  {
    name: 'ads',
    desc: 'Aiming down sights — viewmodel detail, sight alignment, DOF, FOV transition.',
    hud: true,
    setup: `__cap.gameplay(); await __cap.hold('ads', 500);`,
  },
  {
    name: 'firing',
    desc: 'Mid burst — muzzle flash, flash lighting on geometry, recoil, shells, HUD spread.',
    hud: true,
    setup: `__cap.gameplay(); await __cap.hold('ads', 350); __cap.press('fire'); await __cap.wait(90);`,
  },
  {
    name: 'impact',
    desc: 'Bullet impacts and decals on a nearby surface.',
    hud: false,
    setup: `__cap.gameplay(); await __cap.burst(10); await __cap.wait(300);`,
  },
  {
    name: 'explosion',
    desc: 'Explosion at peak — fireball, shockwave, debris, transient lighting.',
    hud: false,
    setup: `__cap.explosionAhead(); await __cap.wait(260);`,
  },
  {
    name: 'enemies',
    desc: 'Enemy soldiers in frame — character models, materials, animation pose.',
    hud: true,
    setup: `await __cap.faceNearestEnemy();`,
  },
  {
    name: 'reload',
    desc: 'Mid-reload — viewmodel animation quality, hands, magazine detail.',
    hud: true,
    setup: `__cap.gameplay(); __cap.press('reload'); await __cap.wait(700);`,
  },
  {
    name: 'silhouette',
    desc: 'Backlit / contre-jour framing — rim light, atmosphere, tonemap rolloff.',
    hud: false,
    setup: `__cap.backlit();`,
  },
];

if (hasFlag('list')) {
  for (const p of PRESETS) console.log(`${p.name.padEnd(18)} ${p.desc}`);
  process.exit(0);
}

const wanted = argv.filter(a => !a.startsWith('--') && !PRESETS.every(p => p.name !== a));
const selected = wanted.length ? PRESETS.filter(p => wanted.includes(p.name)) : PRESETS;

// Injected into the page. Kept tolerant: presets must degrade rather than throw when a
// system (level, weapons, ai) is not built yet.
const HELPERS = `
window.__cap = (() => {
  const g = window.__game, T = g.THREE;
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const V = (a) => new T.Vector3(a[0], a[1], a[2]);
  function place(pos) {
    const p = V(pos);
    if (g.player) {
      g.player.position.set(p.x, p.y - 1.68, p.z);
      if (g.player.velocity) g.player.velocity.set(0, 0, 0);
    }
    g.camera.position.copy(p);
    g.viewCamera.position.copy(p);
  }
  function aim(from, to) {
    const d = V(to).sub(V(from)).normalize();
    const yaw = Math.atan2(-d.x, -d.z);
    const pitch = Math.asin(Math.max(-1, Math.min(1, d.y)));
    if (g.player) { g.player.yaw = yaw; g.player.pitch = pitch; }
    g.camera.rotation.set(pitch, yaw, 0, 'YXZ');
    g.viewCamera.rotation.set(pitch, yaw, 0, 'YXZ');
  }
  const api = {
    wait,
    view(from, to) { place(from); aim(from, to); },
    press(a) { g.input.press(a); setTimeout(() => g.input.release(a), 60); },
    async hold(a, ms) { g.input.press(a); await wait(ms); },
    async burst(n) {
      for (let i = 0; i < n; i++) { g.input.press('fire'); await wait(45); g.input.release('fire'); await wait(45); }
    },
    gameplay() {
      const s = api.spawn();
      api.view(s.from, s.to);
    },
    spawn() {
      const l = g.level;
      if (l?.captureSpots?.gameplay) return l.captureSpots.gameplay;
      if (l?.spawnPoints?.length) {
        const p = l.spawnPoints[0];
        const from = [p.x ?? p[0], (p.y ?? p[1]) + 1.68, p.z ?? p[2]];
        return { from, to: [from[0], from[1] - 0.1, from[2] - 12] };
      }
      return { from: [0, 1.68, 14], to: [0, 1.55, -6] };
    },
    lookAtSun(from) {
      const d = g.sky?.sunDirection ? g.sky.sunDirection.clone().negate() : new T.Vector3(-0.5, 0.37, -0.78);
      const f = V(from);
      api.view(from, [f.x + d.x * 40, f.y + d.y * 40, f.z + d.z * 40]);
    },
    interior() {
      const s = g.level?.captureSpots?.interior;
      if (s) return api.view(s.from, s.to);
      api.view([-6, 1.68, -4], [4, 1.2, -10]);
    },
    closeup() {
      const s = g.level?.captureSpots?.closeup;
      if (s) return api.view(s.from, s.to);
      const from = [0, 1.2, 12];
      api.view(from, [0, 0.4, 10.6]);
    },
    backlit() {
      const s = g.level?.captureSpots?.backlit;
      if (s) return api.view(s.from, s.to);
      const d = g.sky?.sunDirection ? g.sky.sunDirection.clone().negate() : new T.Vector3(-0.5, 0.37, -0.78);
      api.view([d.x * 22, 1.68, d.z * 22], [0, 1.4, 0]);
    },
    explosionAhead() {
      api.gameplay();
      const p = g.camera.position.clone().add(g.camera.getWorldDirection(new T.Vector3()).multiplyScalar(9));
      p.y = Math.max(0.4, p.y - 1.2);
      if (g.fx?.explosion) g.fx.explosion(p, { radius: 5 });
      else g.events.emit('explosion', { point: p, radius: 5, damage: 100, source: null });
    },
    async faceNearestEnemy() {
      api.gameplay();
      for (let i = 0; i < 40; i++) {
        const list = g.ai?.agents || g.ai?.entities || [];
        const alive = [...list].filter(e => e && e.alive !== false && (e.object3D || e.root));
        if (alive.length) {
          const cam = g.camera.position;
          alive.sort((a, b) => {
            const pa = (a.object3D || a.root).position, pb = (b.object3D || b.root).position;
            return pa.distanceTo(cam) - pb.distanceTo(cam);
          });
          const t = (alive[0].object3D || alive[0].root).position;
          const from = [t.x + 7, 1.68, t.z + 9];
          api.view(from, [t.x, t.y + 1.3, t.z]);
          return alive.length;
        }
        await wait(120);
      }
      return 0;
    },
  };
  return api;
})();
`;

fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox', '--disable-dev-shm-usage',
    '--hide-scrollbars', '--js-flags=--max-old-space-size=4096'],
});

const results = [];
for (const preset of selected) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  const url = BASE + (preset.hud ? '' : '&nohud');
  const file = path.join(OUT, `${preset.name}.png`);
  const rec = { name: preset.name, desc: preset.desc, file, errors: [] };
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.__ready === true || window.__crashed === true,
      null, { timeout: 180000 });
    await page.waitForTimeout(2500);
    await page.evaluate(HELPERS);
    await page.evaluate(`(async () => { ${preset.setup} })()`);
    await page.waitForTimeout(1600);   // settle: TAA convergence, animation, particles
    await page.screenshot({ path: file });
    rec.ok = true;
  } catch (e) {
    rec.ok = false;
    rec.error = e.message;
    try { await page.screenshot({ path: file }); } catch {}
  }
  rec.errors = [...new Set(errs)].slice(0, 8);
  results.push(rec);
  console.error(`  ${rec.ok ? 'ok ' : 'FAIL'} ${preset.name} -> ${file}${rec.error ? ' :: ' + rec.error : ''}`);
  await page.close();
}

await browser.close();
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
