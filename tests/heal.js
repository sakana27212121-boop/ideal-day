// 週の型が届く前に作られた日の作り直しと、日付の切り替わり（4時）の検証。架空のデータを使う
// 実行：node tests/heal.js
const { chromium, devices } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const PORT = 8773, BASE = `http://localhost:${PORT}/?local=1`;
let failures = 0, passes = 0;
const ok = (c, m) => { if (c) { passes++; console.log('  ✓ ' + m); } else { failures++; console.log('  ✗ ' + m); } };

// 週の型（月曜）を登録する。登録日時（updated_at）は指定した時刻にする
const addTemplate = (p, regIso) => p.evaluate((regIso) => {
  const { db } = window.__app; const id = () => crypto.randomUUID(); const t = id();
  db.put('tasks', { id: t, title: '定例：深い作業', recurring: true, status: 'open', priority: 2, estimate_min: 60, sort: 0 }, { batch: true });
  const evs = [['起床・身支度', 'habit', 450, 30], ['朝食', 'meal', 480, 30], ['深い作業', 'task', 540, 60, t], ['自由時間', 'free', 600, 60], ['大学（架空）', 'fixed', 900, 240]];
  evs.forEach(([title, kind, s, d, task]) => { const e = db.put('recurring_events', { id: id(), title, kind, weekdays: [1], start_min: s, dur: d, active: true, task_id: task || null }, { batch: true }); db.data.recurring_events[e.id].updated_at = regIso; });
  db.commit();
}, regIso);
const sources = (p, date) => p.evaluate((date) => window.__app.D.blocks(date).map((b) => b.source), date);

async function scenario(b, name, fn) {
  console.log(`\n■ ${name}`);
  const c = await b.newContext({ ...devices['iPhone 15'], timezoneId: 'Asia/Tokyo', deviceScaleFactor: 1 });
  const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  try { await fn(p); } catch (e) { failures++; console.error(e); }
  ok(errs.length === 0, 'ブラウザのエラーなし' + (errs.length ? '：' + errs.join(' / ') : ''));
  await c.close();
}

(async () => {
  const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const b = await chromium.launch();
  try {
    await scenario(b, '週の型が届く前に、理想の生活から月曜の時間割が作られてしまった場合', async (p) => {
      await p.clock.install({ time: new Date('2026-11-16T08:00:00+09:00') });
      await p.goto(BASE); await p.waitForTimeout(300); await p.click('[data-act="saveIdeal"]'); await p.waitForTimeout(100);
      ok((await sources(p, '2026-11-16')).every((s) => s === 'auto'), '（前提）月曜の時間割が理想の生活から作られている');
      await addTemplate(p, '2026-11-15T13:00:00Z'); // 日曜の夜に登録された週の型が、あとから届いた
      await p.reload(); await p.waitForTimeout(400);
      const src = await sources(p, '2026-11-16');
      ok(src.length === 5 && src.every((s) => s === 'template'), `週の型で作り直される（${src.length}件）`);
      const del = await p.evaluate(() => Object.values(window.__app.db.data.schedule_blocks).filter((x) => x.deleted && x.source === 'auto').length);
      ok(del > 0, `元の自動作成の予定は削除の印付きで残る（${del}件、物理削除しない）`);
    });
    await scenario(b, '作業を記録した日は作り直さない', async (p) => {
      await p.clock.install({ time: new Date('2026-11-16T08:00:00+09:00') });
      await p.goto(BASE); await p.waitForTimeout(300); await p.click('[data-act="saveIdeal"]'); await p.waitForTimeout(100);
      await p.evaluate(() => { const D = window.__app.D; const t = D.saveTask({ title: '単発の作業' }); D.start(t.id); });
      await p.clock.fastForward('30:00'); await p.evaluate(() => window.__app.D.end({ status: '継続', next: '続きから' }));
      const before = await p.evaluate(() => window.__app.D.blocks('2026-11-16').length);
      await addTemplate(p, '2026-11-15T13:00:00Z');
      await p.reload(); await p.waitForTimeout(400);
      const src = await sources(p, '2026-11-16');
      ok(!src.includes('template') && src.length === before, '作業の記録がある日は作り直さない（記録と予定を守る）');
      ok((await p.evaluate(() => window.__app.db.all('work_sessions').length)) === 1, '作業の記録は残っている');
    });
    await scenario(b, '週の型を登録した当日は作り直さない', async (p) => {
      await p.clock.install({ time: new Date('2026-11-16T08:00:00+09:00') });
      await p.goto(BASE); await p.waitForTimeout(300); await p.click('[data-act="saveIdeal"]'); await p.waitForTimeout(100);
      await addTemplate(p, '2026-11-16T00:00:00Z'); // 月曜の朝9時に登録
      await p.reload(); await p.waitForTimeout(400);
      ok((await sources(p, '2026-11-16')).every((s) => s === 'auto'), '登録した当日の時間割はそのまま');
      await p.clock.fastForward(7 * 24 * 3600 * 1000); await p.reload(); await p.waitForTimeout(400); // 翌週の月曜
      const src = await sources(p, '2026-11-23');
      ok(src.length === 5 && src.every((s) => s === 'template'), '翌週の月曜からは週の型で作られる');
    });
    await scenario(b, '0時の切り替わりと、0時を過ぎた就寝の睡眠時間', async (p) => {
      await p.clock.install({ time: new Date('2026-11-15T21:00:00+09:00') });
      await p.goto(BASE); await p.waitForTimeout(300); await p.click('[data-act="saveIdeal"]'); await p.waitForTimeout(100);
      await addTemplate(p, '2026-11-15T12:00:00Z');
      await p.clock.fastForward('02:58:00'); await p.waitForTimeout(1500); // 23:58
      ok((await p.locator('.topbar .day').innerText()).includes('11月15日') && !(await p.locator('#app').innerText()).includes('前日'), '23:58：まだ11月15日（前日扱いの案内は出ない）');
      await p.clock.fastForward('03:00'); await p.waitForTimeout(1500); // 0:01（開いたまま日付が変わる）
      const src = await sources(p, '2026-11-16');
      ok(src.length === 5 && src.every((s) => s === 'template'), `開いたまま0時を過ぎると、月曜の時間割が週の型で作られる（${src.length}件）`);
      ok((await p.locator('.topbar .day').innerText()).includes('11月16日'), '画面の日付が11月16日に切り替わる');
      await p.click('[data-act="bed"]'); // 0:01に就寝 → 11/16の記録に入る
      await p.clock.fastForward('07:29:00'); await p.waitForTimeout(500); // 7:30
      await p.click('[data-act="wake"]');
      const st = await p.evaluate(() => window.__app.D.state());
      ok(st.sleep_hours === 7.5, `0時を過ぎてから「寝る」を押しても、睡眠時間（寝床にいた時間）を計算できる（${st.sleep_hours}時間）`);
    });
    await scenario(b, '夜遅く（23:42）に型を切り替えても、その日の時間割に反映される', async (p) => {
      await p.clock.install({ time: new Date('2026-11-16T09:00:00+09:00') });
      await p.goto(BASE); await p.waitForTimeout(300); await p.click('[data-act="saveIdeal"]'); await p.waitForTimeout(100);
      await addTemplate(p, '2026-11-15T12:00:00Z'); // 月曜の型
      await p.evaluate(() => { const { db } = window.__app; const id = () => crypto.randomUUID(); // 土曜の型（固定なし）
        [['昼食（土）', 'meal', 720, 45], ['自由時間（土）', 'free', 840, 240]].forEach(([title, kind, s, d]) => db.put('recurring_events', { id: id(), title, kind, weekdays: [6], start_min: s, dur: d, active: true }, { batch: true })); db.commit(); });
      await p.reload(); await p.waitForTimeout(400);
      await p.evaluate(() => { const D = window.__app.D; window.__app.db.data.schedule_blocks = Object.fromEntries(Object.entries(window.__app.db.data.schedule_blocks).filter(([, b]) => b.date !== D.today())); D.ensureDay(); });
      await p.clock.fastForward('14:42:00'); await p.waitForTimeout(500); // 23:42
      const r = await p.evaluate(() => window.__app.D.switchDay(6));
      const bl = await p.evaluate(() => window.__app.D.blocks().map((x) => window.__app.D.blockLabel(x)));
      ok(r === true && bl.includes('昼食（土）') && bl.includes('自由時間（土）') && !bl.includes('大学（架空）'), `23:42の切り替えでも、その日の時間割が土曜の型になる（${bl.join('・')}）`);
    });
    await scenario(b, '曜日に結びつかない型（例：在宅作業日）を選べる', async (p) => {
      await p.clock.install({ time: new Date('2026-11-16T09:00:00+09:00') });
      await p.goto(BASE); await p.waitForTimeout(300); await p.click('[data-act="saveIdeal"]'); await p.waitForTimeout(100);
      await addTemplate(p, '2026-11-15T12:00:00Z'); // 月曜の型
      await p.evaluate(() => { const { db, D } = window.__app; const id = () => crypto.randomUUID();
        [['深い作業（在宅）', 'task', 540, 180], ['運動（在宅）', 'exercise', 930, 45]].forEach(([title, kind, s, d]) => db.put('recurring_events', { id: id(), title, kind, weekdays: [7], start_min: s, dur: d, active: true }, { batch: true }));
        db.commit(); D.setPref('dayTypeNames', { 7: '在宅作業日（架空）' }); });
      await p.evaluate(() => { const D = window.__app.D; window.__app.db.data.schedule_blocks = Object.fromEntries(Object.entries(window.__app.db.data.schedule_blocks).filter(([, x]) => x.date !== D.today())); D.ensureDay(); window.__app.render(); });
      await p.click('[data-act="sheet"][data-v="day"]');
      const t = await p.locator('.overlay').innerText();
      ok(t.includes('在宅作業日（架空）') && t.includes('月曜の型'), '型の一覧に「在宅作業日」が曜日の型と並んで出る');
      await p.locator('input[name="daytype"][value="7"]').check({ force: true }); await p.click('[data-act="switchDay"]'); await p.waitForTimeout(150);
      const bl = await p.evaluate(() => window.__app.D.blocks().map((x) => x.title));
      ok(bl.includes('深い作業（在宅）') && bl.includes('運動（在宅）') && !bl.includes('大学（架空）'), '切り替えると、その日が在宅作業日の型になる');
      ok((await p.locator('.route + .row').innerText()).includes('在宅作業日（架空）で進行中'), '「在宅作業日で進行中」と表示');
      ok((await p.evaluate(() => window.__app.D.consultText(7, true))).includes('月曜 → 在宅作業日（架空）'), '相談用の書き出しに型の名前が出る');
      ok((await p.evaluate(() => { const D = window.__app.D; const d = '2026-11-23'; D.ensureDay(d); return D.blocks(d).some((x) => x.title === '深い作業（在宅）'); })) === false, '在宅作業日の型は、ふだんの曜日の時間割には入らない');
    });
    await scenario(b, '23時に就寝した場合の睡眠時間', async (p) => {
      await p.clock.install({ time: new Date('2026-11-15T23:00:00+09:00') });
      await p.goto(BASE); await p.waitForTimeout(300); await p.click('[data-act="saveIdeal"]'); await p.waitForTimeout(100);
      await p.click('[data-act="bed"]');
      await p.clock.fastForward('08:30:00'); await p.reload(); await p.waitForTimeout(400); // 7:30
      await p.click('[data-act="wake"]');
      ok((await p.evaluate(() => window.__app.D.state().sleep_hours)) === 8.5, '前日の23時に「寝る」→7:30に「起きた」で8.5時間');
    });
  } catch (e) { failures++; console.error(e); }
  await b.close(); server.kill();
  console.log(`\n結果：成功 ${passes} ／ 失敗 ${failures}`);
  process.exit(failures ? 1 : 0);
})();
