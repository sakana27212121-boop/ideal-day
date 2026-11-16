// 回復の時間の記録の検証（架空の時間割）。実行：node tests/recover.js
const { chromium, devices } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const PORT = 8775, BASE = `http://localhost:${PORT}/?local=1`;
let failures = 0, passes = 0;
const ok = (c, m) => { if (c) { passes++; console.log('  ✓ ' + m); } else { failures++; console.log('  ✗ ' + m); } };
(async () => {
  const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const b = await chromium.launch();
  try {
    for (const [name, opts] of [['iphone', devices['iPhone 15']], ['pc', { viewport: { width: 1440, height: 900 } }]]) {
      console.log(`\n■ ${name}`);
      const c = await b.newContext({ ...opts, timezoneId: 'Asia/Tokyo', deviceScaleFactor: 1 }); const p = await c.newPage();
      const errs = []; p.on('pageerror', (e) => errs.push(e.message));
      await p.clock.install({ time: new Date('2026-11-16T20:00:00+09:00') });
      await p.goto(BASE); await p.waitForTimeout(300); await p.click('[data-act="saveIdeal"]'); await p.waitForTimeout(100);
      await p.evaluate(() => { const { db, D } = window.__app; const id = () => crypto.randomUUID();
        [['夕食', 'meal', 1110, 45], ['回復の時間', 'recover', 1155, 30], ['自由時間（作業してもよい）', 'free', 1185, 105]].forEach(([title, kind, s, d]) => { const e = db.put('recurring_events', { id: id(), title, kind, weekdays: [1], start_min: s, dur: d, active: true }, { batch: true }); db.data.recurring_events[e.id].updated_at = '2026-11-15T12:00:00Z'; });
        db.commit(); window.__app.db.data.schedule_blocks = {}; D.ensureDay(); window.__app.render(); });
      ok((await p.locator('.route').innerText()).includes('回復の時間') && (await p.locator('.route').innerText()).includes('自由時間（作業してもよい）'), '時間割に「回復の時間」と「自由時間（作業してもよい）」が出る');
      await p.locator('.route .lbl', { hasText: '回復の時間' }).click(); await p.click('.overlay [data-act="sheet"][data-v="recover"]');
      const t = await p.locator('.overlay').innerText();
      ok(t.includes('散歩（外を歩く）') && t.includes('横になって目を閉じる') && t.includes('すっきり度'), '回復の時間を押すと、候補とすっきり度の記録画面が出る');
      await p.click('[data-act="saveRecovery"]');
      ok((await p.locator('#r-err').innerText()).includes('何をしたか'), '何をしたかが空なら記録しない');
      await p.locator('input[name="r-act"][value="散歩（外を歩く）"]').check({ force: true }); await p.click('[data-act="saveRecovery"]');
      ok((await p.locator('#r-err').innerText()).includes('すっきり度'), 'すっきり度が空なら記録しない');
      await p.locator('input[name="r-score"][value="4"]').check({ force: true }); await p.click('[data-act="saveRecovery"]'); await p.waitForTimeout(150);
      ok((await p.locator('.stat [data-v="recover"]').innerText()).includes('（1）'), '記録すると、ホームの「回復を記録」に回数が出る');
      await p.click('.stat [data-v="recover"]'); await p.fill('#r-other', '川沿いを自転車で走った'); await p.locator('input[name="r-score"][value="5"]').check({ force: true }); await p.click('[data-act="saveRecovery"]'); await p.waitForTimeout(150);
      const rs = await p.evaluate(() => window.__app.D.recoveries());
      ok(rs.length === 2 && rs[1].activity === '川沿いを自転車で走った' && rs[1].score === 5, '候補にないことも自由に書いて記録できる（1日に複数回）');
      await p.locator('[data-act="tab"][data-v="growth"]:visible').first().click();
      const g = await p.locator('#app').innerText();
      ok(g.includes('回復の時間') && g.includes('散歩（外を歩く）') && g.includes('平均4') && g.includes('3日以上たまると比べられます'), '分析画面に、試したこととすっきり度が出る（日数が少ないうちは比べない）');
      await p.locator('[data-act="tab"][data-v="ai"]:visible').first().click();
      ok((await p.inputValue('#c-text')).includes('## 回復の時間') && (await p.inputValue('#c-text')).includes('川沿いを自転車で走った：5'), '相談用の書き出しに回復の時間が出る');
      await p.reload(); await p.waitForTimeout(400);
      ok((await p.evaluate(() => window.__app.D.recoveries().length)) === 2, '再読み込みしても残る');
      ok((await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0, '横にはみ出さない');
      ok(errs.length === 0, 'ブラウザのエラーなし' + (errs.length ? '：' + errs.join(' / ') : ''));
      await c.close();
    }
  } catch (e) { failures++; console.error(e); }
  await b.close(); server.kill();
  console.log(`\n結果：成功 ${passes} ／ 失敗 ${failures}`);
  process.exit(failures ? 1 : 0);
})();
