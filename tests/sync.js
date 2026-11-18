// 本物のSupabaseを使った同期と権限の検証。テスト専用ユーザーを作り、最後に削除する。
// 実行：node tests/sync.js   （Supabase管理APIのトークンがプロキシ経由で使える環境で）
// 管理用キーは実行中にだけ取得し、ファイルにもログにも残さない。
const { chromium, devices } = require('playwright');
const { execFileSync, spawn } = require('child_process');
const path = require('path');

const REF = 'mpunorwcdhhwkivwembl', API = `https://${REF}.supabase.co`, PORT = 8771, BASE = `http://localhost:${PORT}/`;
let failures = 0, passes = 0;
const ok = (c, m) => { if (c) { passes++; console.log('  ✓ ' + m); } else { failures++; console.log('  ✗ ' + m); } };
const curl = (args) => execFileSync('curl', ['-sS', ...args], { encoding: 'utf8' });
const keys = JSON.parse(curl([`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`]));
const SERVICE = keys.find((k) => k.name === 'service_role').api_key;
const ANON = keys.find((k) => k.name === 'anon').api_key;
const admin = (method, p, body) => JSON.parse(curl(['-X', method, API + p, '-H', 'apikey: ' + SERVICE, '-H', 'Authorization: Bearer ' + SERVICE, '-H', 'Content-Type: application/json', ...(body ? ['-d', JSON.stringify(body)] : [])]) || '{}');
const stamp = Date.now();
const users = [];
function createUser(tag) { const email = `sync-test-${tag}-${stamp}@example.com`, password = 'Test-' + stamp + '-pw'; const u = admin('POST', '/auth/v1/admin/users', { email, password, email_confirm: true }); users.push(u.id); return { id: u.id, email, password }; }

async function login(ctx, u) {
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.errs = errs;
  await p.goto(BASE); await p.waitForSelector('#a-email');
  await p.fill('#a-email', u.email); await p.fill('#a-pass', u.password); await p.click('[data-act="login"]');
  p.on('console', (m) => process.env.DEBUG && console.log('   [console]', m.text()));
  p.on('requestfailed', (r) => process.env.DEBUG && console.log('   [reqfail]', r.url(), r.failure() && r.failure().errorText));
  try { await p.waitForFunction(() => window.__app && window.__app.V.user && window.__app.db.status.state === 'ok', null, { timeout: 20000 }); }
  catch (e) { console.log('   状態:', await p.evaluate(() => JSON.stringify({ user: window.__app.V.user, st: window.__app.db.status, msg: window.__app.V.authMsg }))); throw e; }
  return p;
}
const sync = (p) => p.evaluate(() => window.__app.db.sync());
const text = (p) => p.locator('#app').innerText();

(async () => {
  const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch({ proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined });
  try {
    const A = createUser('a'), B = createUser('b');
    ok(A.id && B.id, 'テスト専用ユーザーを作成');
    console.log('\n■ 同じユーザーで iPhone と PC からログイン');
    const phoneCtx = await browser.newContext({ ...devices['iPhone 15'], timezoneId: 'Asia/Tokyo', locale: 'ja-JP' });
    const pcCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'Asia/Tokyo', locale: 'ja-JP' });
    const phone = await login(phoneCtx, A);
    ok((await text(phone)).includes('理想の生活リズム'), 'iPhone：初回ログインで理想の設定が出る');
    await phone.click('[data-act="saveIdeal"]');
    await phone.click('.quest [data-act="sheet"][data-v="task"]');
    await phone.fill('#t-title', '同期テストのタスク'); await phone.fill('#t-goal', '同期を確かめる'); await phone.click('[data-act="saveTask"]');
    await phone.click('.quest [data-act="open-start"]'); await phone.click('[data-act="start"]');
    await sync(phone);

    const pc = await login(pcCtx, A);
    await pc.waitForTimeout(500);
    ok(await pc.locator('.timer').isVisible(), 'PC：iPhoneで開始した作業が「作業中」として表示される');

    await phone.click('[data-act="open-end"][data-status="継続"]');
    await phone.fill('#f-next', '同期テスト：次はここから'); await phone.click('[data-act="end"]');
    await sync(phone); await sync(pc); await pc.waitForTimeout(300);
    ok(!(await pc.locator('.timer').isVisible()), 'PC：iPhoneで終了すると作業中の画面が閉じる');
    await pc.screenshot({ path: path.join(__dirname, 'screenshots', 'sync-pc.png'), fullPage: true });
    ok((await text(pc)).includes('同期テスト：次はここから'), 'PC：iPhoneで残した「次に始める場所」が表示される');

    const blk = await pc.evaluate(() => window.__app.D.blocks().find((b) => b.kind === 'exercise'));
    await pc.click(`[data-act="shift"][data-id="${blk.id}"][data-n="15"]`);
    await sync(pc); await sync(phone);
    const phoneStart = await phone.evaluate((id) => window.__app.D.blocks().find((b) => b.id === id).start_min, blk.id);
    ok(phoneStart === blk.start_min + 15, 'iPhone：PCで動かした予定の時刻が反映される');
    const nBlocks = [await phone.evaluate(() => window.__app.D.blocks().length), await pc.evaluate(() => window.__app.D.blocks().length)];
    ok(nBlocks[0] === nBlocks[1], `両端末の時間割の件数が一致（重複して作られない：${nBlocks.join(' / ')}）`);

    await phone.click('[data-act="tab"][data-v="habits"]'); await phone.click('[data-act="scale"][data-f="fulfill"][data-n="4"]');
    await sync(phone); await sync(pc);
    ok((await pc.evaluate(() => (window.__app.D.state() || {}).fulfill)) === 4, 'PC：iPhoneで記録した充実度が反映される');

    await phone.evaluate(() => window.__app.D.switchDay(6)); await sync(phone); await sync(pc);
    ok((await pc.evaluate(() => window.__app.D.switchedToday())) === true && (await pc.evaluate(() => window.__app.D.switchDay(1))) === false, 'PC：iPhoneで型を切り替えた日は、PCからも切り替えられない（1日1回）');

    console.log('\n■ オフライン中の記録');
    await phoneCtx.setOffline(true);
    await phone.click('[data-act="scale"][data-f="energy"][data-n="3"]');
    await sync(phone);
    await phone.waitForFunction(() => window.__app.db.status.state !== 'syncing', null, { timeout: 10000 }).catch(() => {});
    ok(['offline', 'error'].includes(await phone.evaluate(() => window.__app.db.status.state)), 'iPhone：オフラインでも記録でき、同期待ちとして表示される');
    ok((await phone.locator('.sync').first().innerText()).match(/オフライン|同期できません/), 'iPhone：画面に同期できていないことが表示される');
    await phoneCtx.setOffline(false);
    await sync(phone); await sync(pc);
    ok((await pc.evaluate(() => (window.__app.D.state() || {}).energy)) === 3, 'PC：通信が戻ると、オフライン中の記録が届く');

    console.log('\n■ 端末のデータを消しても復元できる');
    const fresh = await browser.newContext({ viewport: { width: 1280, height: 800 }, timezoneId: 'Asia/Tokyo', locale: 'ja-JP' });
    const p3 = await login(fresh, A);
    await p3.click('[data-act="tab"][data-v="tasks"]');
    ok((await text(p3)).includes('同期テストのタスク') && (await text(p3)).includes('同期テスト：次はここから'), '新しいブラウザでログインすると、タスクと引き継ぎがサーバーから戻る');

    console.log('\n■ 本人のデータは本人だけ');
    const other = await browser.newContext({ viewport: { width: 1280, height: 800 }, timezoneId: 'Asia/Tokyo' });
    const pb = await login(other, B);
    const bTasks = await pb.evaluate(() => window.__app.db.all('tasks').length);
    ok(bTasks === 0, '別のユーザーからは他人のタスクが見えない');
    const anon = JSON.parse(curl([API + '/rest/v1/tasks?select=*', '-H', 'apikey: ' + ANON]));
    ok(Array.isArray(anon) ? anon.length === 0 : !!anon.message, 'ログインしていない状態ではデータを読めない');
    const tok = JSON.parse(curl(['-X', 'POST', API + '/auth/v1/token?grant_type=password', '-H', 'apikey: ' + ANON, '-H', 'Content-Type: application/json', '-d', JSON.stringify({ email: B.email, password: B.password })])).access_token;
    const aTask = await phone.evaluate(() => window.__app.db.all('tasks')[0]);
    const hack = curl(['-X', 'POST', API + '/rest/v1/tasks', '-H', 'apikey: ' + ANON, '-H', 'Authorization: Bearer ' + tok, '-H', 'Content-Type: application/json', '-H', 'Prefer: resolution=merge-duplicates', '-d', JSON.stringify({ id: aTask.id, user_id: A.id, title: '書き換え' })]);
    ok(/row-level security|violates|42501/.test(hack), '別のユーザーが他人のタスクを書き換えようとすると拒否される');
    await sync(phone);
    ok((await phone.evaluate((id) => window.__app.db.get('tasks', id).title, aTask.id)) === '同期テストのタスク', '本人のデータは変わっていない');

    ok([phone, pc, p3, pb].every((x) => x.errs.length === 0), 'ブラウザのエラーなし' + [phone, pc, p3, pb].map((x) => x.errs.join(' ')).join(''));
  } catch (e) { failures++; console.error(e); }
  finally {
    for (const id of users) admin('DELETE', '/auth/v1/admin/users/' + id);
    const left = JSON.parse(curl(['-X', 'POST', `https://api.supabase.com/v1/projects/${REF}/database/query`, '-H', 'Content-Type: application/json', '-d', JSON.stringify({ query: `select (select count(*) from auth.users where email like 'sync-test-%') u, (select count(*) from public.tasks t where not exists (select 1 from auth.users x where x.id=t.user_id)) orphan` })]));
    ok(left[0].u === 0 && left[0].orphan === 0, 'テスト用ユーザーとデータを削除した');
    await browser.close(); server.kill();
    console.log(`\n結果：成功 ${passes} ／ 失敗 ${failures}`);
    process.exit(failures ? 1 : 0);
  }
})();
