// Regression: the hold-to-commit gate must complete in the time it promises.
export default async ({ page, shot, report }) => {
  const log = (m) => report.notes.push(m);

  // run time until a decision opens
  await page.keyboard.press('Space');
  for (let i = 0; i < 40 && !(await page.$('.dec')); i++) {
    await page.evaluate(() => window.__advance?.(60));
    await page.waitForTimeout(150);
  }
  if (!(await page.$('.dec'))) { log('GATE TEST: no decision appeared'); return; }
  await page.waitForTimeout(1200);
  await shot('decision');

  const before = await page.evaluate(() => window.__S.stats.decisionsMade);
  log(`decisionsMade before = ${before}`);

  // pick an option that opens a gate; prefer an irreversible one
  const opts = await page.$$('.dec .opt:not(.disabled), .dec .copt:not(.disabled)');
  log(`options found = ${opts.length}`);
  if (!opts.length) { log('GATE TEST: no clickable options'); return; }
  const irrev = await page.$('.dec .opt.irrev:not(.disabled)');
  await (irrev || opts[opts.length - 1]).click();
  await page.waitForTimeout(900);

  const gate = await page.$('.gate .holdbtn');
  if (!gate) {
    const after = await page.evaluate(() => window.__S.stats.decisionsMade);
    log(`no gate shown; committed directly? decisionsMade after = ${after}`);
    await shot('after-click');
    return;
  }
  await shot('gate');
  const label = (await gate.textContent()) || '';
  const secs = parseFloat((label.match(/([\d.]+)\s*sn/) || [])[1] || '3');
  log(`gate label = "${label.trim()}" -> holding ${secs}s + 2s slack`);

  const box = await gate.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // sample the fill bar mid-hold to prove the timer is actually advancing
  await page.waitForTimeout(secs * 500);
  const mid = await page.evaluate(() => document.querySelector('.gate .holdbtn i')?.style.width || '?');
  log(`fill at halfway = ${mid}`);
  await page.waitForTimeout(secs * 500 + 2000);
  await page.mouse.up();
  await page.waitForTimeout(1200);

  const after = await page.evaluate(() => window.__S.stats.decisionsMade);
  const stillGated = await page.evaluate(() => !!document.querySelector('.gate'));
  log(`decisionsMade after = ${after}; gate still open = ${stillGated}`);
  log(after > before ? 'GATE TEST: PASS - hold committed the decision'
                     : 'GATE TEST: FAIL - hold did not commit');
  await shot('after-hold');
};
