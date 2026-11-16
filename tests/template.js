// 週の型（曜日ごとの時間割）と定例タスクの検証。架空の時間割を使う（個人の予定は含めない）
// 実行：node tests/template.js
const { chromium, devices } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const PORT = 8772, BASE = `http://localhost:${PORT}/?local=1`;
let failures = 0, passes = 0;
const ok = (c, m) => { if (c) { passes++; console.log('  ✓ ' + m); } else { failures++; console.log('  ✗ ' + m); } };

(async () => {
  const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const b = await chromium.launch();
  try {
    for (const [name, opts] of [['iphone', devices['iPhone 15']], ['pc', { viewport: { width: 1440, height: 900 } }]]) {
      console.log(`\n■ ${name}`);
      const c = await b.newContext({ ...opts, timezoneId: 'Asia/Tokyo', deviceScaleFactor: 1 });
      const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
      await p.clock.install({ time: new Date('2026-11-15T21:00:00+09:00') }); // 日曜の夜に登録
      await p.goto(BASE); await p.waitForTimeout(400);
      await p.click('[data-act="saveIdeal"]'); await p.waitForTimeout(100);
      // 架空の週の型（月曜）を登録
      await p.evaluate(() => {
        const { db } = window.__app; const id = () => crypto.randomUUID();
        const tWork = id(), tThink = id();
        db.put('tasks', { id: tWork, title: '定例：深い作業', recurring: true, status: 'open', priority: 2, estimate_min: 60, sort: 0 }, { batch: true });
        db.put('tasks', { id: tThink, title: '定例：考える時間', recurring: true, status: 'open', priority: 2, estimate_min: 45, sort: 1 }, { batch: true });
        const ev = (title, kind, s, d, extra = {}) => db.put('recurring_events', { id: id(), title, kind, weekdays: [1], start_min: s, dur: d, active: true, ...extra }, { batch: true });
        ev('起床・身支度', 'habit', 450, 30); ev('朝食', 'meal', 480, 30); ev('考える時間', 'task', 540, 45, { task_id: tThink });
        ev('深い作業', 'task', 600, 60, { task_id: tWork }); ev('自由時間', 'free', 660, 45); ev('余白', 'buffer', 705, 15);
        ev('大学（架空）', 'fixed', 900, 240); ev('入浴', 'habit', 1290, 30);
        db.put('recurring_events', { id: id(), title: '固定の会議（架空）', kind: 'fixed', weekdays: [4], start_min: 1000, dur: 60, active: true }, { batch: true });
        db.commit();
      });
      // 月曜 9:00 に進めて、その日の時間割を作る
      await p.clock.fastForward('12:00:00'); await p.reload(); await p.waitForTimeout(400);
      const bl = await p.evaluate(() => window.__app.D.blocks().map((x) => ({ k: x.kind, t: window.__app.D.blockLabel(x), s: x.start_min, f: x.fixed, src: x.source })));
      ok(bl.length === 8 && bl.every((x) => x.src === 'template'), `月曜は週の型どおりに作られる（${bl.length}件・理想の生活からの自動作成なし）`);
      ok(bl.find((x) => x.t === '大学（架空）').f === true && bl.filter((x) => x.k !== 'fixed').every((x) => !x.f), '固定予定だけが固定、ほかは動かせる予定');
      ok(bl.some((x) => x.k === 'task' && x.t === '定例：深い作業'), '作業枠に定例タスクが結びつく');
      let t = await p.locator('#app').innerText();
      ok(t.includes('定例：考える時間') && /NEXT ACTION/.test(t), 'NEXT ACTION に週の型の作業枠が出る');
      ok(t.includes('余白'), '余白も時間割に表示される');
      // 予定より5分遅れて開始 → 完了で終了（定例タスクは残る、再配置の提案なし）
      await p.clock.fastForward('05:00');
      await p.locator('.quest [data-act="open-start"]').click(); await p.click('[data-act="start"]');
      await p.clock.fastForward('40:00');
      await p.click('[data-act="open-end"][data-status="継続"]');
      await p.locator('input[name="status"][value="完了"]').check({ force: true });
      await p.locator('input[name="focus"][value="4"]').check({ force: true }); await p.locator('input[name="energy"][value="3"]').check({ force: true });
      await p.fill('#f-outcome', '作りたいアプリの機能を3つ書き出した'); await p.locator('input[name="f-value"][value="4"]').check({ force: true });
      await p.click('[data-act="end"]'); await p.waitForTimeout(150);
      const tk = await p.evaluate(() => window.__app.D.tasks().find((x) => x.title === '定例：考える時間'));
      ok(tk.status === 'open', '定例タスクは「完了」にしても次回に残る');
      ok(!(await p.locator('#app').innerText()).includes('続きの再配置の提案'), '定例タスクでは続きの再配置の提案を出さない');
      const a = await p.evaluate(() => window.__app.D.analysis(7).sessions[0]);
      ok(a.startGap === 5 && a.plan === 45 && a.minutes === 40 && a.focus === 4 && a.energy === 3, `予定と実績・開始のずれ・集中度・体調を記録（ずれ+${a.startGap}分、予定${a.plan}分、実績${a.minutes}分）`);
      // 2回目：深い作業も定例タスク
      await p.locator('.quest [data-act="open-start"]').click(); await p.click('[data-act="start"]'); await p.clock.fastForward('50:00');
      await p.click('[data-act="open-end"][data-status="継続"]'); await p.fill('#f-next', '次は資料の確認から'); await p.fill('#f-outcome', '企画書の1〜4ページの数字を最新にした'); await p.locator('input[name="f-value"][value="3"]').check({ force: true }); await p.click('[data-act="end"]'); await p.waitForTimeout(150);
      ok(!(await p.locator('#app').innerText()).includes('続きの再配置の提案'), '「継続」でも定例タスクは再配置の提案なし');
      // タスク画面：定例の作業の一覧
      await p.locator('[data-act="tab"][data-v="tasks"]:visible').first().click();
      t = await p.locator('#app').innerText();
      ok(t.includes('定例の作業（週の型）') && t.includes('定例：深い作業') && t.includes('次：次は資料の確認から'), 'タスク画面に定例の作業と引き継ぎが出る');
      // 分析画面：開始のずれ・体調の列
      await p.locator('[data-act="tab"][data-v="growth"]:visible').first().click();
      t = await p.locator('#app').innerText();
      ok(t.includes('開始のずれ') && t.includes('+5分'), '分析画面に開始のずれが出る');
      // 書き出し
      await p.locator('[data-act="tab"][data-v="ai"]:visible').first().click();
      const ct = await p.inputValue('#c-text');
      ok(ct.includes('開始のずれ+5分') && ct.includes('定例の作業（週の型）') && ct.includes('体調3'), '相談用の書き出しに開始のずれ・定例の作業・体調が出る');
      // 理想の設定を保存しても週の型は消えない
      await p.locator('[data-act="tab"][data-v="habits"]:visible').first().click(); await p.click('[data-act="tab"][data-v="setup"]');
      t = await p.locator('#app').innerText();
      ok(t.includes('週の型・試行版') && [await p.inputValue('#e-title0'), await p.inputValue('#e-title1')].sort().join() === ['固定の会議（架空）', '大学（架空）'].sort().join() && (await p.locator('#e-title2').count()) === 0, '設定画面には固定予定だけが並び、週の型は件数で案内される');
      const nBefore = await p.evaluate(() => window.__app.db.all('recurring_events').length);
      await p.click('[data-act="saveIdeal"]'); await p.waitForTimeout(100);
      const nAfter = await p.evaluate(() => window.__app.db.all('recurring_events').length);
      ok(nBefore === nAfter && nAfter === 9, `理想の設定を保存しても週の型は消えない（${nBefore}→${nAfter}件）`);
      // 週の型がない曜日（火曜）は従来どおり理想の生活から作る
      await p.clock.fastForward('24:00:00'); await p.reload(); await p.waitForTimeout(400);
      const tue = await p.evaluate(() => window.__app.D.blocks().map((x) => x.source));
      ok(tue.length > 0 && tue.every((s) => s === 'auto'), '週の型がない曜日は、従来どおり理想の生活から作る');
      const ow = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth); ok(ow <= 0, '横にはみ出さない');
      ok(errs.length === 0, 'ブラウザのエラーなし' + (errs.length ? '：' + errs.join(' / ') : ''));
      await c.close();
    }
  } catch (e) { failures++; console.error(e); }
  await b.close(); server.kill();
  console.log(`\n結果：成功 ${passes} ／ 失敗 ${failures}`);
  process.exit(failures ? 1 : 0);
})();
