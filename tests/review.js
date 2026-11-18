// AIの評価（推測）の表示の検証（架空の記録）。実行：node tests/review.js
const { chromium, devices } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const PORT = 8776, BASE = `http://localhost:${PORT}/?local=1`;
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
      await p.clock.install({ time: new Date('2026-11-17T08:00:00+09:00') });
      await p.goto(BASE); await p.waitForTimeout(300); await p.click('[data-act="saveIdeal"]'); await p.waitForTimeout(100);
      ok(!(await p.locator('#app').innerText()).includes('AIの評価（推測）'), '評価がないときはホームに出ない');
      await p.evaluate(() => { const { db, D } = window.__app; const t = db.put('tasks', { id: crypto.randomUUID(), title: '資料づくり', status: 'open', est_min: 60, priority: 2 });
        const s1 = db.put('work_sessions', { id: crypto.randomUUID(), task_id: t.id, started_at: '2026-11-16T10:00:00+09:00', ended_at: '2026-11-16T11:30:00+09:00', block_id: 'b1', minutes: 90, status: 'continue', outcome: 'まとめた', value_rating: 2 });
        const s2 = db.put('work_sessions', { id: crypto.randomUUID(), task_id: t.id, started_at: '2026-11-16T14:00:00+09:00', ended_at: '2026-11-16T14:40:00+09:00', block_id: 'b2', minutes: 40, status: 'done', outcome: 'スライド8枚の構成を決め、3枚を清書した', value_rating: 4 });
        db.put('improvement_proposals', { id: crypto.randomUUID(), kind: 'session_review', date: '2026-11-16', status: 'new', source: 'ai', text: '「まとめた」だけでは何が進んだか分からず、90分に見合うか判断できません。', payload: { session_id: s1.id, verdict: '判断できない', hint: '何を何個まとめたかを書く', task: '資料づくり', minutes: 90 } });
        db.put('improvement_proposals', { id: crypto.randomUUID(), kind: 'session_review', date: '2026-11-16', status: 'new', source: 'ai', text: '構成決定と3枚の清書は40分として妥当です。', payload: { session_id: s2.id, verdict: '見合う', hint: '', task: '資料づくり', minutes: 40 } });
        db.put('improvement_proposals', { id: crypto.randomUUID(), kind: 'day_review', date: '2026-11-16', status: 'new', source: 'ai', text: '2件中1件は見合う。長い作業は書き方があいまい。', payload: { advice: ['90分ごとに一度区切る', '寝る前に画面を閉じる'] } });
        window.__app.render(); });
      const h = await p.locator('#app').innerText();
      ok(h.includes('AIの評価（推測）') && h.includes('判断できない') && h.includes('見合う') && h.includes('次は：何を何個まとめたかを書く') && h.includes('2件中1件は見合う') && h.includes('今日へのアドバイス') && h.includes('90分ごとに一度区切る'), 'ホームに前日の振り返り・今日へのアドバイス・作業ごとの評価が出る');
      await p.locator('[data-act="tab"][data-v="growth"]:visible').first().click();
      const g = await p.locator('#app').innerText();
      ok(g.includes('AI：判断できない') && g.includes('構成決定と3枚の清書は40分として妥当です。') && g.includes('自己評価4'), '分析画面で、自分の評価とAIの評価が並んで見られる');
      await p.locator('[data-act="tab"][data-v="ai"]:visible').first().click();
      ok((await p.inputValue('#c-text')).includes('AIの評価（推測）：判断できない') && (await p.inputValue('#c-text')).includes('翌日へ：90分ごとに一度区切る'), '相談用の書き出しにもAIの評価と振り返りが入る');
      // 大学課題の時間に、ほかの作業（SIS）をする
      await p.locator('[data-act="tab"][data-v="home"]:visible').first().click();
      const r2 = await p.evaluate(() => { const { db, D } = window.__app; const u = db.put('tasks', { id: crypto.randomUUID(), title: '大学課題', status: 'open', recurring: true, est_min: 60, priority: 2 }), w = db.put('tasks', { id: crypto.randomUUID(), title: 'SIS 深い作業', status: 'open', recurring: true, est_min: 60, priority: 2 });
        const n = new Date(), m = n.getHours() * 60 + n.getMinutes();
        const b = db.put('schedule_blocks', { id: crypto.randomUUID(), date: D.today(), start_min: m - 10, dur: 60, kind: 'task', task_id: u.id, status: 'planned', source: 'template' }); window.__app.render(); return { b: b.id, w: w.id }; });
      await p.evaluate((id) => { window.__app.V.sheet = 'block'; window.__app.V.id = id; window.__app.render(); }, r2.b);
      const bt = await p.locator('.overlay').innerText();
      ok(bt.includes('この時間にほかの作業をする') && !(await p.locator('#bh-task option', { hasText: '大学課題' }).count()), '大学課題の時間を押すと「ほかの作業をする」が出る（候補に大学課題自身は出ない）');
      await p.selectOption('#bh-task', r2.w); await p.click('[data-act="startHere"]'); await p.waitForTimeout(100);
      await p.clock.fastForward(30 * 60e3);
      const res = await p.evaluate((ids) => { const { db, D } = window.__app; const s = D.running(); D.end({ status: '継続', focus: 3, energy: 3, outcome: '資料3枚を修正した', value: 3 }); const b = db.get('schedule_blocks', ids.b);
        return { task: s && s.task_id === ids.w, host: s && s.block_id === ids.b, status: b.status, text: D.consultText(7, true) }; }, r2);
      ok(res.task && res.host && res.status === 'planned', 'SISの作業として記録され、大学課題の予定は「済」にならない');
      ok(res.text.includes('大学課題の時間に作業'), '相談用の書き出しに「大学課題の時間に作業」と出る');
      await p.clock.fastForward(3 * 86400e3); await p.locator('[data-act="tab"][data-v="home"]:visible').first().click(); await p.waitForTimeout(100);
      ok(!(await p.locator('#app').innerText()).includes('判断できない'), '古い評価（2日以上前）はホームに出ない');
      ok((await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0, '横にはみ出さない');
      ok(errs.length === 0, 'ブラウザのエラーなし' + (errs.length ? '：' + errs.join(' / ') : ''));
      await c.close();
    }
  } catch (e) { failures++; console.error(e); }
  await b.close(); server.kill();
  console.log(`\n結果：成功 ${passes} ／ 失敗 ${failures}`);
  process.exit(failures ? 1 : 0);
})();
