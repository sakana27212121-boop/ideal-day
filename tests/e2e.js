// 実ブラウザでの動作検証（PC・iPhone）。ログインなしの検証用モード（?local=1）で主要な操作を通す。
// 実行：node tests/e2e.js   （Playwright と Chromium が入っている環境で）
const { chromium, devices } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'screenshots');
const PORT = 8770;
const BASE = `http://localhost:${PORT}/?local=1`;
fs.mkdirSync(OUT, { recursive: true });

let failures = 0, passes = 0;
const ok = (cond, msg) => { if (cond) { passes++; console.log('  ✓ ' + msg); } else { failures++; console.log('  ✗ ' + msg); } };

async function overflow(p) { return p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); }
const app = (p, fn, arg) => p.evaluate(fn, arg);

async function run(name, ctxOpts) {
  console.log(`\n■ ${name}`);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...ctxOpts, timezoneId: 'Asia/Tokyo', locale: 'ja-JP', deviceScaleFactor: 1, permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.clock.install({ time: new Date('2026-11-16T08:00:00+09:00') }); // 月曜 8:00
  const shot = (n) => p.screenshot({ path: path.join(OUT, `${name}-${n}.png`), fullPage: true });
  const click = (sel) => p.locator(sel).filter({ visible: true }).first().click();
  const text = () => p.locator('#app').innerText();

  // 1. 初回：理想の設定
  await p.goto(BASE); await p.waitForTimeout(500);
  ok((await text()).includes('理想の生活リズム'), '初回は理想の設定画面が出る');
  await click('[data-act="evAdd"]');
  await p.fill('#e-title0', '大学 講義（線形代数）'); await p.fill('#e-start0', '09:00'); await p.fill('#e-end0', '10:30');
  await shot('01-setup');
  await click('[data-act="saveIdeal"]'); await p.waitForTimeout(200);
  let t = await text();
  ok(t.includes('大学 講義（線形代数）') && t.includes('固定'), '固定予定（毎週月曜）が今日の時間割に入る');
  ok(t.includes('起床・身支度') && t.includes('朝食') && t.includes('就寝準備'), '理想の生活から時間割が自動で組まれる');
  ok(t.includes('まだクエストがありません'), 'タスクがないときは追加を案内する');

  // 2. タスク追加 → 自動で空き時間へ
  await click('.quest [data-act="sheet"][data-v="task"]');
  await click('[data-act="saveTask"]');
  ok(await p.locator('#t-err').isVisible(), 'タスク名が空だと保存せずに知らせる');
  await p.fill('#t-title', '企画資料の修正'); await p.fill('#t-project', 'SIS'); await p.fill('#t-goal', '3ページ目の図表を差し替える');
  await p.fill('#t-done', '全10ページの図表が最新'); await p.fill('#t-est', '60'); await p.selectOption('#t-prio', '1');
  await click('[data-act="saveTask"]');
  await click('[data-act="tab"][data-v="tasks"]');
  await click('.btn.go[data-act="sheet"][data-v="task"]');
  await p.fill('#t-title', '数学Webテスト作成'); await p.fill('#t-est', '30'); await click('[data-act="saveTask"]');
  await click('[data-act="replan"]'); await p.waitForTimeout(100);
  const blocks = await app(p, () => window.__app.D.blocks().map((b) => ({ id: b.id, kind: b.kind, start: b.start_min, dur: b.dur, task: b.task_id, title: window.__app.D.blockLabel(b) })));
  const tb = blocks.filter((b) => b.kind === 'task');
  ok(tb.length === 2, `2件のタスクが時間割に入る（${tb.map((b) => b.title + ' ' + b.start).join(', ')}）`);
  const lecture = blocks.find((b) => b.title.startsWith('大学'));
  ok(tb.every((b) => b.start + b.dur <= lecture.start || b.start >= lecture.start + lecture.dur), 'タスクは固定予定と重ならない');
  await click('[data-act="tab"][data-v="home"]');
  t = await text();
  ok(t.includes('企画資料の修正') && /NEXT ACTION/.test(t), 'ホームのNEXT ACTIONに優先度の高いタスクが出る');

  // 3. 生活習慣の記録（ホームから）
  await click('[data-act="wake"]');
  ok((await text()).includes('起床 08:00'), '起床ボタンで時刻が自動記録される');
  ok((await p.locator('.stat .bar', { hasText: '食事' }).innerText()).includes('未記録'), '食事を記録する前は「0」ではなく「未記録」と表示される');
  await click('.stat [data-act="habit"]');
  ok((await p.locator('.stat .bar', { hasText: '食事' }).innerText()).includes('1（未2）'), '食事の記録がステータスに反映され、未記録の食事と区別される');
  const exBtn = p.locator('.stat [data-act="habit"]', { hasText: '運動' });
  await exBtn.click(); ok((await exBtn.innerText()).includes('✓'), '習慣ボタン：1回押すと「した」');
  await exBtn.click(); ok((await exBtn.innerText()).includes('×') && (await p.locator('.stat .bar', { hasText: '運動' }).innerText()).includes('なし'), '習慣ボタン：2回目で「しなかった」');
  await exBtn.click(); ok(!(await exBtn.innerText()).match(/[✓×]/) && (await p.locator('.stat .bar', { hasText: '運動' }).innerText()).includes('未記録'), '習慣ボタン：3回目で「未記録」に戻る');
  await exBtn.click(); await exBtn.click(); // 「しなかった」にしておく（書き出しで確認）
  await shot('02-home');

  // 4. タスク開始 → 一時停止 → 再開（予定の10:30に開始）
  await p.clock.fastForward('02:30:00');
  await click('[data-act="tab"][data-v="home"]');
  await click('.quest [data-act="open-start"]');
  t = await text();
  ok(t.includes('完了条件') && t.includes('全10ページの図表が最新') && t.includes('はじめてのクエスト'), '開始前に今回やること・完了条件・初回であることが出る');
  await click('[data-act="start"]');
  ok(await p.locator('.timer').isVisible(), '作業中の画面（経過時間）に切り替わる');
  await p.clock.fastForward('10:00');
  await click('[data-act="pause"]');
  ok((await text()).includes('一時停止中'), '一時停止できる');
  await p.clock.fastForward('20:00');
  await click('[data-act="resume"]');
  await shot('03-working');

  // 5. 作業終了（予定60分 → 実際は長引く）→ 引き継ぎ → 予定変更の提案
  await p.clock.fastForward('01:20:00');
  await click('[data-act="open-end"][data-status="継続"]');
  await p.fill('#f-next', '4ページ目の表から再開'); await p.fill('#f-outcome', '3ページ目まで修正済み'); await p.fill('#f-remaining', '4〜10ページ');
  await p.locator('input[name="f-value"][value="3"]').check({ force: true });
  await p.locator('input[name="focus"][value="4"]').check({ force: true });
  await shot('04-end');
  await click('[data-act="end"]'); await p.waitForTimeout(150);
  const ses = await app(p, () => window.__app.db.all('work_sessions'));
  ok(ses.length === 1 && ses[0].minutes === 90 && ses[0].status === '継続' && ses[0].focus === 4, `実作業時間は一時停止を除いて自動計算（${ses[0] && ses[0].minutes}分）`);
  t = await text();
  ok(t.includes('予定変更の提案') && t.includes('長くかかりました'), '予定より長引くと、以降の予定を動かす提案が出る');
  const before = await app(p, () => window.__app.D.blocks().map((b) => [b.id, b.start_min, b.fixed]));
  await shot('05-proposal');
  await click('[data-act="acceptProposal"]'); await p.waitForTimeout(100);
  const after = await app(p, () => window.__app.D.blocks().map((b) => [b.id, b.start_min, b.fixed]));
  const moved = after.filter(([id, s]) => { const b = before.find((x) => x[0] === id); return b && b[1] !== s; });
  ok(moved.length > 0, `承認すると予定が動く（${moved.length}件）`);
  ok(after.filter((x) => x[2]).every(([id, s]) => before.find((b) => b[0] === id)[1] === s), '固定予定は動かない');

  // 5b. 「継続」で終えたタスクの再配置（承認制）
  t = await text(p);
  ok(t.includes('続きの再配置の提案') && t.includes('企画資料の修正'), '「継続」で終えると、続きを空き時間に入れる提案が出る');
  const nBefore = await app(p, () => window.__app.D.blocks().filter((b) => b.kind === 'task' && b.status === 'planned').length);
  await shot('05b-reschedule');
  await click('[data-act="acceptProposal"]'); await p.waitForTimeout(100);
  const rs = await app(p, () => { const D = window.__app.D; const bs = D.blocks(); const nb = bs.filter((b) => b.kind === 'task' && b.status === 'planned' && D.task(b.task_id).title === '企画資料の修正');
    const overlap = nb.some((x) => bs.some((y) => y.id !== x.id && x.start_min < y.start_min + y.dur && y.start_min < x.start_min + x.dur));
    return { n: bs.filter((b) => b.kind === 'task' && b.status === 'planned').length, nb: nb.map((b) => b.start_min), overlap, now: (new Date().getHours() * 60 + new Date().getMinutes()) }; });
  ok(rs.n === nBefore + 1 && rs.nb.length === 1 && rs.nb[0] >= rs.now, `承認すると、続きが今より後の時間割に入る（${rs.nb.map((m) => Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0')).join(',')}）`);
  ok(!rs.overlap, '再配置した枠はほかの予定と重ならない');
  ok(!(await text(p)).includes('続きの再配置の提案'), '承認後は提案が消える');

  // 6. 再読み込みしても残る・次回の開始時に引き継ぎが出る
  await p.reload(); await p.waitForTimeout(500);
  await click('[data-act="tab"][data-v="tasks"]');
  t = await text();
  ok(t.includes('次：4ページ目の表から再開'), '再読み込み後もタスク一覧に「次に始める場所」が残る');
  ok(t.includes('実績 1時間30分（1回）'), 'タスクに作業セッションの実績が紐づく');
  await p.locator('.item', { hasText: '企画資料の修正' }).locator('[data-act="open-start"]').click();
  t = await text();
  ok(t.includes('3ページ目まで修正済み') && t.includes('4〜10ページ') && t.includes('4ページ目の表から再開'), '再開時に前回の結果・残り・次に始める場所が出る');
  await click('[data-act="close"]');

  // 7. 中断 → 再開
  await p.locator('.item', { hasText: '数学Webテスト作成' }).locator('[data-act="open-start"]').click();
  await click('[data-act="start"]');
  await p.clock.fastForward('05:00');
  await click('[data-act="open-end"][data-status="中断"]');
  ok(await p.locator('input[name="status"][value="中断"]').isChecked(), '中断ボタンから開くと状態が「中断」になっている');
  await click('[data-act="end"]'); await p.waitForTimeout(100);
  ok(!(await text(p)).includes('続きの再配置の提案'), '「中断」では再配置の提案は出ない（予定変更の提案のみ）');
  await click('[data-act="tab"][data-v="tasks"]');
  ok(await p.locator('.item', { hasText: '数学Webテスト作成' }).locator('[data-act="open-start"]', { hasText: '再開' }).count() === 1, '中断したタスクは「再開」として残る');

  // 8. 予定の変更が各画面に反映される
  await click('[data-act="tab"][data-v="home"]');
  const exBlock = await app(p, () => window.__app.D.blocks().find((b) => b.kind === 'exercise'));
  await p.click(`[data-act="shift"][data-id="${exBlock.id}"][data-n="15"]`);
  const ex2 = await app(p, (id) => window.__app.D.blocks().find((b) => b.id === id).start_min, exBlock.id);
  ok(ex2 === exBlock.start_min + 15, '時間割の「+15」で予定を後ろにずらせる');
  await click('.route + .row [data-act="sheet"][data-v="block"]');
  await p.fill('#b-title', '買い物'); await p.fill('#b-start', '16:00'); await p.fill('#b-dur', '30');
  await click('[data-act="saveBlock"]');
  ok((await p.locator('.route').innerText()).includes('買い物'), '追加した予定がホームの時間割に出る');
  await click('[data-act="tab"][data-v="tasks"]');
  ok((await p.locator('.route').innerText()).includes('買い物'), '同じ予定がタスク画面の時間割にも出る');
  await p.locator('.route .lbl', { hasText: '買い物' }).click();
  await p.fill('#b-start', '16:30'); await click('[data-act="saveBlock"]');
  ok((await p.locator('.route li', { hasText: '買い物' }).innerText()).includes('16:30'), '予定をタップして時刻を変更できる');

  // 9. 生活習慣の画面
  await click('[data-act="tab"][data-v="habits"]');
  await p.click('[data-act="scale"][data-f="energy"][data-n="4"]');
  await p.click('[data-act="scale"][data-f="fulfill"][data-n="5"]');
  await p.fill('#f-habit', 'ストレッチ'); await click('[data-act="addHabit"]');
  t = await text();
  ok(t.includes('ストレッチ'), '習慣の項目を追加できる');
  await shot('06-habits');
  await click('[data-act="tab"][data-v="home"]');
  t = await text();
  ok(t.includes('4/5') && t.includes('ストレッチ'), '元気の記録と追加した習慣がホームに反映される');

  // 10. 分析・成長
  await click('[data-act="tab"][data-v="growth"]');
  t = await text();
  ok(t.includes('予定時間と実績') && t.includes('企画資料の修正') && t.includes('90分'), '分析画面に予定と実績が出る');
  ok(t.includes('まだ傾向を言えるだけの記録がありません'), 'データが少ないときは断定しない');
  await click('[data-act="period"][data-n="28"]');
  ok((await text()).includes('28日'), '表示期間を切り替えられる');
  await shot('07-growth');

  // 11. AI相談（Claude Codeで相談するための記録の書き出し）
  await click('[data-act="tab"][data-v="ai"]');
  let ct = await p.inputValue('#c-text');
  ok(ct.includes('## 日々の記録') && ct.includes('企画資料の修正') && ct.includes('理想の生活'), '相談用に、理想・日々の記録・タスクが書き出される');
  ok(ct.includes('4ページ目の表から再開') && ct.includes('推測で埋めていません'), '自由記述（次に始める場所）を含み、事実のみであることを明記');
  const todayRow = ct.split('\n').find((l) => l.startsWith('| 11/16 '));
  const prevRow = ct.split('\n').find((l) => l.startsWith('| 11/15 '));
  ok(todayRow && todayRow.includes('| 1（未2） | × |'), `書き出しでも、食事の未記録分と「運動しなかった」が区別される（${todayRow}）`);
  ok(prevRow && prevRow.includes('| − | − |'), '記録のない日の食事・運動は「−」（0ではない）');
  await p.locator('#c-free').uncheck();
  ct = await p.inputValue('#c-text');
  ok(!ct.includes('4ページ目の表から再開') && ct.includes('企画資料の修正'), '自由記述を外すと、文章の記録は書き出されない');
  await click('[data-act="cDays"][data-n="28"]');
  ok((await p.inputValue('#c-text')).includes('28日間'), '書き出す期間を切り替えられる');
  await click('[data-act="copyConsult"]'); await p.waitForTimeout(200);
  const cb = await p.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  ok(cb.includes('## 日々の記録') || (await p.locator('#toast').innerText()).includes('コピー'), '「記録をコピー」でコピーできる（できない環境では選択して案内）');
  await shot('08-consult');

  // 12. 呼び名の切替
  await click('[data-act="tab"][data-v="habits"]');
  await click('[data-act="terms"]');
  await click('[data-act="tab"][data-v="home"]');
  t = await text();
  ok(t.includes('次にやること') && !t.includes('つぎのクエスト'), '呼び名をふつうの名称に切り替えられる');
  await click('[data-act="tab"][data-v="habits"]'); await click('[data-act="terms"]');

  // 13. 横スクロールが出ない
  for (const tab of ['home', 'habits', 'tasks', 'growth', 'ai']) {
    await click(`[data-act="tab"][data-v="${tab}"]`);
    const o = await overflow(p); ok(o <= 0, `${tab}：横にはみ出さない`);
    await shot('tab-' + tab);
  }

  // 14. データのつながり（タスク・セッション・引き継ぎ）
  const rel = await app(p, () => { const db = window.__app.db; const s = db.all('work_sessions'); const h = db.all('handoffs');
    return { s: s.every((x) => db.get('tasks', x.task_id) && db.raw('schedule_blocks', x.block_id)), h: h.every((x) => db.get('tasks', x.task_id) && s.find((y) => y.id === x.session_id)) }; });
  ok(rel.s && rel.h, '作業セッションはタスクと予定に、引き継ぎはセッションに紐づいて保存される');

  ok(errors.length === 0, 'ブラウザのエラーなし' + (errors.length ? '：' + errors.join(' / ') : ''));
  await browser.close();
}

(async () => {
  const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  try {
    await run('iphone', devices['iPhone 15']);
    await run('pc', { viewport: { width: 1440, height: 900 } });
  } catch (e) { failures++; console.error(e); }
  server.kill();
  console.log(`\n結果：成功 ${passes} ／ 失敗 ${failures}`);
  process.exit(failures ? 1 : 0);
})();
