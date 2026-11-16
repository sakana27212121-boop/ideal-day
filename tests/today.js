// 型の切り替え・移動中の作業記録・やったことと見合いの記録・サウンドの検証（架空の時間割）。実行：node tests/today.js
const { chromium, devices } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const PORT = 8774, BASE = `http://localhost:${PORT}/?local=1`;
let failures = 0, passes = 0;
const ok = (c, m) => { if (c) { passes++; console.log('  ✓ ' + m); } else { failures++; console.log('  ✗ ' + m); } };
const lbl = (p, text) => p.locator('.route .lbl', { hasText: text });
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
      // 架空の週の型：月曜＝大学の日、土曜＝在宅の日
      await p.evaluate(() => { const { db } = window.__app; const id = () => crypto.randomUUID(); const t = id();
        db.put('tasks', { id: t, title: '定例：深い作業', recurring: true, status: 'open', priority: 2, estimate_min: 60, sort: 0 }, { batch: true });
        const ev = (wd, title, kind, s, d, task) => { const e = db.put('recurring_events', { id: id(), title, kind, weekdays: [wd], start_min: s, dur: d, active: true, task_id: task || null }, { batch: true }); db.data.recurring_events[e.id].updated_at = '2026-11-15T12:00:00Z'; };
        [['深い作業', 'task', 600, 60, t], ['昼食', 'meal', 720, 40], ['移動', 'fixed', 780, 120], ['大学（架空）', 'fixed', 900, 240], ['移動', 'fixed', 1140, 120], ['夕食', 'meal', 1260, 30]].forEach((x) => ev(1, ...x));
        [['深い作業', 'task', 600, 60, t], ['昼食', 'meal', 720, 45], ['深い作業', 'task', 900, 60, t], ['自由時間', 'free', 960, 240], ['夕食', 'meal', 1200, 45]].forEach((x) => ev(6, ...x));
        db.commit(); });
      await p.clock.fastForward('12:00:00'); await p.reload(); await p.waitForTimeout(400); // 月曜 9:00
      // 1) 型の日は予定を1つずつ変えられない
      ok((await p.locator('[data-act="shift"]').count()) === 0 && (await p.locator('[data-act="replan"]').count()) === 0 && (await p.locator('.route + .row [data-v="block"]').count()) === 0, '型の日は「±15」「予定を追加」「入れ直す」が出ない');
      await lbl(p, '大学（架空）').click();
      let t = await p.locator('.overlay').innerText();
      ok(t.includes('1つずつは変えられません') && (await p.locator('#b-start').count()) === 0 && (await p.locator('[data-act="deleteBlock"]').count()) === 0, '予定を押すと詳細だけ（時刻の変更・削除はできない）');
      await p.click('[data-act="close"]');
      // 2) 開始→終了：やったこと・見合いは必須、あいまいなら一度促す
      await p.clock.fastForward('01:00:00');
      await p.locator('.quest [data-act="open-start"]').click(); await p.click('[data-act="start"]');
      ok((await p.evaluate(() => window.__lastSound)) === 'start', 'サウンド：開始で鳴る');
      await p.clock.fastForward('01:01:00'); await p.waitForTimeout(1500);
      ok((await p.evaluate(() => window.__lastSound)) === 'timeup', 'サウンド：予定の時間（60分）で知らせる');
      await p.click('[data-act="open-end"][data-status="継続"]'); await p.click('[data-act="end"]');
      ok((await p.locator('#f-vague').innerText()).includes('必須') && (await p.evaluate(() => !!window.__app.D.running())), 'やったことが空なら記録しない（10分以上の作業）');
      await p.fill('#f-outcome', '作業した'); await p.locator('input[name="f-value"][value="2"]').check({ force: true }); await p.click('[data-act="end"]');
      ok((await p.locator('#f-vague').innerText()).includes('あいまい') && (await p.evaluate(() => !!window.__app.D.running())), '「作業した」のようなあいまいな書き方は一度だけ促す');
      await p.fill('#f-outcome', '企画書の3〜5ページの図表を差し替えた'); await p.click('[data-act="end"]'); await p.waitForTimeout(150);
      ok(!(await p.evaluate(() => !!window.__app.D.running())) && (await p.evaluate(() => window.__lastSound)) === 'save', '具体的に書けば記録できる（サウンド：記録）');
      ok(!(await p.locator('#app').innerText()).includes('予定変更の提案'), '型の日は、予定を1つずつ動かす提案を出さない');
      // 3) 移動の時間に作業する（予定はそのまま）
      await p.clock.fastForward('02:20:00'); await p.waitForTimeout(400); // 13:20（移動中）
      await lbl(p, '移動').first().click();
      ok((await p.locator('[data-act="startHere"]').count()) === 1, '移動中の予定を押すと「ここで作業を始める」が出る');
      await p.click('[data-act="startHere"]'); await p.clock.fastForward('40:00');
      await p.click('[data-act="open-end"][data-status="継続"]');
      await p.fill('#f-outcome', '電車で英単語アプリを30語進めた'); await p.locator('input[name="f-value"][value="4"]').check({ force: true }); await p.click('[data-act="end"]'); await p.waitForTimeout(150);
      const mv = await p.evaluate(() => { const D = window.__app.D; const b = D.blocks().find((x) => x.title === '移動' && x.start_min === 780); const s = window.__app.db.all('work_sessions').find((x) => x.block_id === b.id); return { st: b.status, kind: b.kind, min: s && s.minutes, out: s && s.outcome }; });
      ok(mv.st === 'planned' && mv.kind === 'fixed' && mv.min === 40 && mv.out.includes('30語'), '移動の予定は変わらず、その時間の作業（40分・やったこと）が記録される');
      // 4) 大学がなくなった → 今日の型を「土曜の型」に切り替える（14:00）
      await p.clock.fastForward('00:20:00'); await p.waitForTimeout(400); // 14:20
      await p.click('[data-act="sheet"][data-v="day"]');
      t = await p.locator('.overlay').innerText();
      ok(t.includes('月曜の型') && t.includes('固定：大学（架空）') && t.includes('土曜の型') && t.includes('固定予定なし'), '型の一覧に、各曜日の型と固定予定の有無が出る');
      await p.locator('input[name="daytype"][value="6"]').check({ force: true }); await p.click('[data-act="switchDay"]'); await p.waitForTimeout(150);
      const after = await p.evaluate(() => window.__app.D.blocks().map((x) => [x.start_min, window.__app.D.blockLabel(x), x.status]));
      ok(!after.some((x) => x[1] === '大学（架空）') && after.some((x) => x[0] === 900 && x[1] === '定例：深い作業') && after.some((x) => x[1] === '自由時間') && after.some((x) => x[0] === 720 && x[1] === '昼食' && x[2] === 'planned'), `その日全体が土曜の型に置き換わる（大学がなくなり、15:00 深い作業・自由時間が入る。過ぎた時間の予定も土曜の型）`);
      ok(after.some((x) => x[0] === 600 && x[2] === 'done') && after.some((x) => x[0] === 780 && x[1] === '移動'), '終わった作業と、作業を記録した移動の予定は残る');
      ok((await p.evaluate(() => window.__app.db.all('work_sessions').length)) === 2, '作業の記録は消えない');
      ok((await p.locator('.route + .row').innerText()).includes('土曜の型で進行中'), '今の型が表示される');
      ok((await p.locator('[data-act="sheet"][data-v="day"]').count()) === 0 && (await p.locator('.route + .row').innerText()).includes('変更済み（1日1回まで）'), '切り替えたあとは「今日の型を変える」が出ない（1日1回まで）');
      const again = await p.evaluate(() => { const D = window.__app.D; const n = D.blocks().length; const r = D.switchDay(1); return { r, same: D.blocks().length === n }; });
      ok(again.r === false && again.same, '2回目の切り替えは内部でも拒否され、時間割は変わらない');
      // 5) 過去の予定の時間にした作業を書く（予定はそのまま）
      await lbl(p, '昼食').click(); await p.click('[data-act="logBlock"]');
      ok((await p.inputValue('#l-start')) === '12:00' && (await p.inputValue('#l-end')) === '12:45', 'その予定（土曜の型の昼食 12:00〜12:45）の時刻が入った状態で開く');
      await p.fill('#l-start', '12:10'); await p.fill('#l-end', '12:35');
      await p.fill('#l-outcome', 'メールを5件返信した'); await p.locator('input[name="l-value"][value="3"]').check({ force: true }); await p.click('[data-act="logPast"]'); await p.waitForTimeout(150);
      ok((await p.evaluate(() => window.__app.db.all('work_sessions').length)) === 3, '過去の予定の時間にした作業も記録できる');
      // 6) 分析：時間と成果の振り返り
      await p.locator('[data-act="tab"][data-v="growth"]:visible').first().click();
      t = await p.locator('#app').innerText();
      ok(t.includes('時間と成果の振り返り') && t.includes('10分以上の作業') && t.includes('3回'), '分析画面に「時間と成果の振り返り」が出る');
      ok(t.includes('見合わない') && t.includes('企画書の3〜5ページ'), '見合い2以下の作業が、やったことと一緒に一覧に出る');
      await p.locator('[data-act="tab"][data-v="ai"]:visible').first().click();
      const ct = await p.inputValue('#c-text');
      ok(ct.includes('やったこと：電車で英単語アプリを30語進めた') && ct.includes('見合い4') && ct.includes('移動の時間に作業') && ct.includes('## 型の切り替え') && ct.includes('土曜の型') && ct.includes('かけた時間に対して'), '相談用の書き出しに、やったこと・見合い・移動中の作業・型の切り替え・評価の依頼が出る');
      ok((await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0, '横にはみ出さない');
      await p.clock.fastForward('09:22:00'); await p.waitForTimeout(1500); // 23:42：夜遅くの切り替えでも、その日の時間割に反映される（別シナリオで確認）
      await p.clock.fastForward('00:38:00'); await p.waitForTimeout(1500); // 翌日（火曜）0:20
      await p.locator('[data-act="tab"][data-v="home"]:visible').first().click();
      ok((await p.evaluate(() => window.__app.D.switchedToday())) === false, '翌日はまた1回切り替えられる');
      ok(errs.length === 0, 'ブラウザのエラーなし' + (errs.length ? '：' + errs.join(' / ') : ''));
      await c.close();
    }
  } catch (e) { failures++; console.error(e); }
  await b.close(); server.kill();
  console.log(`\n結果：成功 ${passes} ／ 失敗 ${failures}`);
  process.exit(failures ? 1 : 0);
})();
