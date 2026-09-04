// P02 — catch a sign landing mid-wait, with nothing else on screen.
export default async ({ page, shot, report, W, H }) => {
  const log = (m) => report.notes.push('P02 ' + m);
  const safeShot = async (n) => { for (let i = 0; i < 3; i++) { try { await shot(n); return; } catch (e) { await page.waitForTimeout(1200); } } };
  const settle = async () => { for (let i = 0; i < 8; i++) { if (!(await page.$('#revealRoot .ok'))) return; await page.waitForTimeout(2200); await page.evaluate(() => document.querySelector('#revealRoot .ok')?.click()); await page.waitForTimeout(400); } };
  const commitOpen = async (prefer) => {
    for (let k = 0; k < 3; k++) {
      if (!(await page.$('.dec .opt'))) return;
      const i = await page.evaluate((pf) => {
        const all = [...document.querySelectorAll('.dec .opt')];
        const ok = all.filter((o) => !o.classList.contains('disabled'));
        if (!ok.length) return -1;
        const days = (o) => { const m = (o.querySelector('.wait')?.textContent || '').match(/([\d.]+)\s*(gün|ay|yıl)/); return m ? +m[1] * (m[2] === 'gün' ? 1 : m[2] === 'ay' ? 30 : 365) : 0; };
        const s = ok.map((o) => ({ o, d: days(o) })).sort((a, b) => pf === 'long' ? b.d - a.d : a.d - b.d);
        return all.indexOf(s[0].o);
      }, prefer);
      if (i < 0) return;
      await page.evaluate((j) => document.querySelectorAll('.dec .opt')[j].click(), i);
      await page.waitForTimeout(400);
      if (await page.$('.gate .holdbtn')) {
        const b = await (await page.$('.gate .holdbtn')).boundingBox();
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
        await page.mouse.down();
        for (let z = 0; z < 30; z++) { await page.waitForTimeout(400); if (!(await page.$('.gate'))) break; }
        await page.mouse.up();
      }
      await page.waitForTimeout(800); await settle();
    }
  };
  const adv = async (n) => { await page.evaluate((k) => window.__advance?.(k), n); await page.waitForTimeout(120); await settle(); };

  try {
    await page.keyboard.press('Space');
    await page.waitForTimeout(400);
    for (let i = 0; i < 80 && !(await page.evaluate(() => !!document.querySelector('.dec'))); i++) await adv(40);
    await settle();
    await commitOpen('long');
    await page.waitForTimeout(800);

    // walk to the day before the next sealed sign, then take one step
    for (let round = 0; round < 6; round++) {
      await commitOpen('short');
      const nxt = await page.evaluate(() => {
        const S = window.__S;
        let best = null;
        for (const d of S.decisions) {
          if (d.state !== 'pending' || !d.autoTells) continue;
          for (const t of d.autoTells) if (!t.fired && t.day > S.day && (!best || t.day < best)) best = t.day;
        }
        return best == null ? null : best - S.day;
      });
      if (nxt == null) { log('no sealed sign ahead'); break; }
      if (nxt > 1) await adv(nxt - 1);
      await commitOpen('short');
      await page.waitForTimeout(400);
      await adv(1);
      await page.waitForTimeout(900);
      const st = await page.evaluate(() => {
        const e = document.getElementById('p02news');
        return { has: !!e && !e.hidden, staged: document.body.classList.contains('staged'), txt: e ? e.textContent.slice(0, 70) : '' };
      });
      log('round ' + round + ' ' + JSON.stringify(st));
      if (st.has && !st.staged) { await safeShot('sign-lands'); break; }
    }
    // and the clock's nerves: run it fast at the end and see if it slows itself
    await page.evaluate(() => { const S = window.__S; const d = S.decisions.find((x) => x.state === 'pending'); if (d) window.__advance(Math.max(0, d.resolveDay - S.day - 4)); });
    await page.waitForTimeout(400);
    await commitOpen('short');
    await page.evaluate(() => { document.querySelector('.speeds button[data-sp="5"]')?.click(); });
    await page.waitForTimeout(600);
    const before = await page.evaluate(() => window.__S.speed);
    // the sim's own "it is nearly here" signal, delivered on the documented bus
    const after = await page.evaluate(async () => {
      const bus = await import('/src/core/bus.js');
      const d = window.__S.decisions.find((x) => x.state === 'pending');
      if (!d) return 'no pending';
      bus.emit('decision:closing', d);
      return window.__S.speed;
    });
    log(`closing slowdown: speed ${before} -> ${after}`);
    await safeShot('final-days');
  } catch (e) { log('THREW ' + String(e).slice(0, 200)); }
};
