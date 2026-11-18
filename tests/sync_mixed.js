// 11/17 の同期停止の再現と修正の確認（項目の組み合わせが違う行を一度に送る）。本物のSupabaseを使う。テスト専用ユーザーを作り、最後に削除する。
// 実行：node tests/sync.js   （Supabase管理APIのトークンがプロキシ経由で使える環境で）
// 管理用キーは実行中にだけ取得し、ファイルにもログにも残さない。
const { chromium, devices } = require('playwright');
const { execFileSync, spawn } = require('child_process');
const path = require('path');

const REF = 'mpunorwcdhhwkivwembl', API = `https://${REF}.supabase.co`, PORT = 8777, BASE = `http://localhost:${PORT}/`;
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
    const A = createUser('mixed');
    const ctx = await browser.newContext({ ...devices['iPhone 15'], timezoneId: 'Asia/Tokyo' });
    const p = await login(ctx, A);
    // 前日の行（サーバーから受け取った形：全項目あり）と、新しい日の行（回復の時間の項目なし＝修正前のアプリが作った形）を同時に送る
    const st = await p.evaluate(async () => { const { db } = window.__app; const now = new Date().toISOString();
      db.data.daily_states['11111111-1111-4111-8111-111111111111'] = { id: '11111111-1111-4111-8111-111111111111', date: '2026-11-16', wake_at: null, bed_at: now, sleep_hours: 7, energy: 3, fulfill: 4, rest_count: 0, note: null, template_wd: 6, template_switched_at: null, recoveries: [], deleted: false, updated_at: now };
      db.data.daily_states['22222222-2222-4222-8222-222222222222'] = { id: '22222222-2222-4222-8222-222222222222', date: '2026-11-17', rest_count: 0, energy: 4, updated_at: now };
      db.dirty.add('daily_states:11111111-1111-4111-8111-111111111111'); db.dirty.add('daily_states:22222222-2222-4222-8222-222222222222');
      await db.sync(); return { state: db.status.state, error: db.status.error, dirty: db.dirty.size }; });
    ok(st.state === 'ok' && st.dirty === 0, `項目の違う行をまとめて同期しても失敗しない（${st.state}${st.error ? '：' + st.error : ''}）`);
    const rows = JSON.parse(curl(['-X', 'POST', `https://api.supabase.com/v1/projects/${REF}/database/query`, '-H', 'Content-Type: application/json', '-d', JSON.stringify({ query: `select date, energy, recoveries from public.daily_states where user_id = '${A.id}' order by date` })]));
    if (process.env.DEBUG) console.log(rows);
    ok(Array.isArray(rows) && rows.length === 2 && rows[1].energy === 4 && Array.isArray(rows[1].recoveries), 'サーバーに2日分とも届く（回復の時間の項目は既定値）');
    // 送れない状態が続いたら、ホームに警告が出る（記録はこの端末に残る）
    await p.click('[data-act="saveIdeal"]'); await p.waitForTimeout(800);
    await p.evaluate(async () => { const { db } = window.__app; db.data.daily_states['33333333-3333-4333-8333-333333333333'] = { id: '33333333-3333-4333-8333-333333333333', date: '2026-11-18', rest_count: null, updated_at: new Date().toISOString() }; db.dirty.add('daily_states:33333333-3333-4333-8333-333333333333'); await db.sync(); });
    await p.waitForTimeout(300);
    const h = await text(p); if (process.env.DEBUG) console.log(h.slice(0, 400), await p.evaluate(() => JSON.stringify(window.__app.db.status)));
    ok(h.includes('同期できていません') && h.includes('送れていない記録が1件') && h.includes('もう一度送る'), '同期に失敗し続けると、ホームに警告と件数が出る');
    await p.evaluate(async () => { const { db } = window.__app; db.data.daily_states['33333333-3333-4333-8333-333333333333'].rest_count = 0; await db.sync(); }); await p.waitForTimeout(300);
    ok(!(await text(p)).includes('同期できていません'), '送れたら警告は消える');
    ok(p.errs.length === 0, 'ブラウザのエラーなし' + (p.errs.length ? '：' + p.errs.join(' / ') : ''));
    await ctx.close();
  } catch (e) { failures++; console.error(e); }
  for (const id of users) admin('DELETE', '/auth/v1/admin/users/' + id);
  await browser.close(); server.kill();
  console.log(`\n結果：成功 ${passes} ／ 失敗 ${failures}`);
  process.exit(failures ? 1 : 0);
})();
