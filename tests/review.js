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
        db.put('improvement_proposals', { id: crypto.randomUUID(), kind: 'day_review', date: '2026-11-16', status: 'new', source: 'ai', text: '2件中1件は見合う。長い作業は書き方があいまい。', payload: {} });
        window.__app.render(); });
      const h = await p.locator('#app').innerText();
      ok(h.includes('AIの評価（推測）') && h.includes('判断できない') && h.includes('見合う') && h.includes('次は：何を何個まとめたかを書く') && h.includes('2件中1件は見合う'), 'ホームに前日のAIの評価（推測）が出る');
      await p.locator('[data-act="tab"][data-v="growth"]:visible').first().click();
      const g = await p.locator('#app').innerText();
      ok(g.includes('AI：判断できない') && g.includes('構成決定と3枚の清書は40分として妥当です。') && g.includes('自己評価4'), '分析画面で、自分の評価とAIの評価が並んで見られる');
      await p.locator('[data-act="tab"][data-v="ai"]:visible').first().click();
      ok((await p.inputValue('#c-text')).includes('AIの評価（推測）：判断できない'), '相談用の書き出しにもAIの評価が入る');
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
