// 予定の中止・あとから記録・サウンドの検証（架空の時間割）。実行：node tests/today.js
const { chromium, devices } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const PORT = 8774, BASE = `http://localhost:${PORT}/?local=1`;
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
      await p.clock.install({ time: new Date('2026-11-15T21:00:00+09:00') });
      await p.goto(BASE); await p.waitForTimeout(300); await p.click('[data-act="saveIdeal"]'); await p.waitForTimeout(100);
      await p.evaluate(() => { const { db } = window.__app; const id = () => crypto.randomUUID(); const t = id();
        db.put('tasks', { id: t, title: '定例：深い作業', recurring: true, status: 'open', priority: 2, estimate_min: 60, sort: 0 }, { batch: true });
        [['深い作業', 'task', 600, 60, t], ['昼食', 'meal', 720, 40], ['移動', 'fixed', 780, 120], ['大学（架空）', 'fixed', 900, 240], ['移動', 'fixed', 1140, 120], ['夕食', 'meal', 1260, 30], ['打合せ（架空）', 'fixed', 1290, 30]]
          .forEach(([title, kind, s, d, task]) => { const e = db.put('recurring_events', { id: id(), title, kind, weekdays: [1], start_min: s, dur: d, active: true, task_id: task || null }, { batch: true }); db.data.recurring_events[e.id].updated_at = '2026-11-15T12:00:00Z'; });
        db.commit(); });
      await p.clock.fastForward('12:00:00'); await p.reload(); await p.waitForTimeout(400); // 月曜 9:00
      // 1) 10:00〜11:40 を開始→終了で記録（サウンド：開始・記録）
      await p.clock.fastForward('01:00:00');
      await p.locator('.quest [data-act="open-start"]').click(); await p.click('[data-act="start"]');
      ok((await p.evaluate(() => window.__lastSound)) === 'start', 'サウンド：開始で鳴る');
      await p.clock.fastForward('01:01:00'); await p.waitForTimeout(1500);
      ok((await p.evaluate(() => window.__lastSound)) === 'timeup' && (await p.locator('#toast').innerText()).includes('予定の60分になりました'), 'サウンド：予定の時間（60分）に達すると1回知らせる');
      await p.clock.fastForward('39:00');
      await p.click('[data-act="open-end"][data-status="継続"]'); await p.click('[data-act="end"]');
      ok((await p.evaluate(() => window.__lastSound)) === 'save', 'サウンド：記録で鳴る');
      // 2) 大学がなくなった：大学の予定から「この日は中止」→前後の移動も一緒に（隣り合う固定予定だけ）
      await p.locator('.route .lbl', { hasText: '大学（架空）' }).click();
      const rel = await p.locator('[data-skip]').count();
      ok(rel === 2, `大学を中止するとき、隣り合う移動2件を一緒に中止の候補にする（離れた打合せは含めない：${rel}件）`);
      await p.click('[data-act="skipBlock"]'); await p.waitForTimeout(100);
      const st = await p.evaluate(() => window.__app.D.blocks().filter((x) => x.fixed).map((x) => [window.__app.D.blockLabel(x), x.status]));
      ok(st.filter((x) => x[1] === 'skipped').length === 3 && st.find((x) => x[0] === '打合せ（架空）')[1] === 'planned', '大学と前後の移動が「中止」、打合せは予定のまま');
      ok((await p.locator('.route li.skipped').count()) === 3 && (await p.locator('.route').innerText()).includes('中止'), '時間割に「中止」と表示（削除されない）');
      // 3) 12:23〜14:23 の作業をあとから記録（今は14:24）
      await p.clock.fastForward('02:43:00'); await p.waitForTimeout(500); // 14:24
      await p.locator('.quest [data-act="sheet"][data-v="log"]').click();
      await p.fill('#l-start', '14:00'); await p.fill('#l-end', '15:00'); await p.click('[data-act="logPast"]');
      ok((await p.locator('#l-err').innerText()).includes('まだ来ていない時刻'), 'あとから記録：未来の時刻は記録しない');
      await p.fill('#l-start', '11:00'); await p.fill('#l-end', '12:00'); await p.click('[data-act="logPast"]');
      ok((await p.locator('#l-err').innerText()).includes('重なっています'), 'あとから記録：すでにある記録と重なる時間は記録しない');
      await p.evaluate(() => { const D = window.__app.D; const t = D.recurringTasks()[0]; window.__app.db.put('work_sessions', { id: crypto.randomUUID(), task_id: t.id, block_id: null, started_at: new Date('2026-11-16T12:37:36+09:00').toISOString(), ended_at: new Date('2026-11-16T12:37:38+09:00').toISOString(), minutes: 0, status: '中断', paused_ms: 0 }); });
      await p.fill('#l-start', '12:23'); await p.fill('#l-end', '14:23'); // 途中に0分の中断記録があっても記録できる
      await p.locator('input[name="l-focus"][value="4"]').check({ force: true }); await p.fill('#l-next', '次は資料の確認から');
      await p.click('[data-act="logPast"]'); await p.waitForTimeout(150);
      const ss = await p.evaluate(() => window.__app.db.all('work_sessions').map((s) => [s.minutes, s.focus, s.memo]).sort());
      ok(ss.some((x) => x[0] === 120 && x[1] === 4 && x[2] === 'あとから記録'), '12:23〜14:23 の120分が、集中度つきで記録される');
      ok((await p.locator('.route').innerText()).includes('12:23') && (await p.evaluate(() => window.__lastSound)) === 'save', '時間割に実績として入る（12:23〜）');
      const a = await p.evaluate(() => window.__app.D.analysis(7));
      ok(a.workMin === 220, `分析の作業時間に入る（今日 ${a.workMin}分）`);
      await p.locator('[data-act="tab"][data-v="ai"]:visible').first().click();
      const ct = await p.inputValue('#c-text');
      ok(ct.includes('## 中止した予定') && ct.includes('大学（架空）') && ct.includes('実績120分'), '相談用の書き出しに、中止した予定とあとから記録した作業が出る');
      // 4) 中止の取り消し
      await p.locator('[data-act="tab"][data-v="home"]:visible').first().click();
      await p.locator('.route li.skipped .lbl', { hasText: '大学（架空）' }).click(); await p.click('[data-act="unskipBlock"]');
      ok((await p.evaluate(() => window.__app.D.blocks().find((x) => x.title === '大学（架空）').status)) === 'planned', '中止を取り消せる');
      // 5) サウンドをオフ
      await p.locator('[data-act="tab"][data-v="habits"]:visible').first().click(); await p.click('[data-act="sound"]');
      ok((await p.locator('#app').innerText()).includes('サウンド：オフ'), 'サウンドをオフにできる');
      await p.evaluate(() => { window.__lastSound = null; }); await p.locator('.stat [data-act="habit"]').first().click();
      ok((await p.evaluate(() => window.__lastSound)) === null, 'オフのときは鳴らない');
      ok((await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0, '横にはみ出さない');
      ok(errs.length === 0, 'ブラウザのエラーなし' + (errs.length ? '：' + errs.join(' / ') : ''));
      await c.close();
    }
  } catch (e) { failures++; console.error(e); }
  await b.close(); server.kill();
  console.log(`\n結果：成功 ${passes} ／ 失敗 ${failures}`);
  process.exit(failures ? 1 : 0);
})();
