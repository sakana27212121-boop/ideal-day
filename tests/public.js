// 公開ページ（GitHub Pages）での最終検証。テスト専用ユーザーを作り、最後に削除する（本人のデータには触れない）。
// 実行：node tests/public.js [URL]
const { chromium, devices } = require('playwright');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const URL0 = process.argv[2] || 'https://sakana27212121-boop.github.io/ideal-day/';
const REF = 'mpunorwcdhhwkivwembl', API = `https://${REF}.supabase.co`;
const OUT = path.join(__dirname, 'screenshots'); fs.mkdirSync(OUT, { recursive: true });
let failures = 0, passes = 0;
const ok = (c, m) => { if (c) { passes++; console.log('  ✓ ' + m); } else { failures++; console.log('  ✗ ' + m); } };
const curl = (args) => execFileSync('curl', ['-sS', ...args], { encoding: 'utf8' });
const keys = JSON.parse(curl([`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`]));
const SERVICE = keys.find((k) => k.name === 'service_role').api_key;
const admin = (method, p, body) => JSON.parse(curl(['-X', method, API + p, '-H', 'apikey: ' + SERVICE, '-H', 'Authorization: Bearer ' + SERVICE, '-H', 'Content-Type: application/json', ...(body ? ['-d', JSON.stringify(body)] : [])]) || '{}');
const stamp = Date.now();
const U = { email: `final-test-${stamp}@example.com`, password: 'Final-' + stamp + '-pw' };

const sync = (p) => p.evaluate(() => window.__app.db.sync());
const text = (p) => p.locator('#app').innerText();
const vis = (p, sel) => p.locator(sel).filter({ visible: true }).first();

async function open(browser, name, opts) {
  const ctx = await browser.newContext({ ...opts, timezoneId: 'Asia/Tokyo', locale: 'ja-JP', deviceScaleFactor: 1 });
  const p = await ctx.newPage(); p.errs = [];
  p.on('pageerror', (e) => p.errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED|Failed to fetch/.test(m.text())) p.errs.push(m.text()); });
  p.name = name; p.ctx = ctx; return p;
}
async function login(p) {
  await p.goto(URL0); await p.waitForSelector('#a-email', { timeout: 20000 });
  await p.fill('#a-email', U.email); await p.fill('#a-pass', U.password); await p.click('[data-act="login"]');
  await p.waitForFunction(() => window.__app && window.__app.V.user && window.__app.V.firstSync, null, { timeout: 30000 });
  await p.waitForTimeout(300);
}
async function overflowAll(p) {
  for (const tab of ['home', 'habits', 'tasks', 'growth', 'ai']) {
    await vis(p, `[data-act="tab"][data-v="${tab}"]`).click(); await p.waitForTimeout(150);
    const o = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    ok(o <= 0, `${p.name}：${tab} 画面が横にはみ出さない`);
    await p.screenshot({ path: path.join(OUT, `public-${p.name}-${tab}.png`), fullPage: true });
  }
  await vis(p, '[data-act="tab"][data-v="home"]').click();
}

(async () => {
  const browser = await chromium.launch({ proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined });
  let uid = null;
  try {
    console.log('\n■ 公開ページ・登録停止');
    const guest = await open(browser, 'guest', { viewport: { width: 1280, height: 800 } });
    await guest.goto(URL0); await guest.waitForSelector('#a-email');
    ok((await guest.title()) === '冒険の書', '公開ページが表示される');
    await guest.click('[data-act="authMode"]'); await guest.fill('#a-email', `final-signup-${stamp}@gmail.com`); await guest.fill('#a-pass', 'Abcdefgh-123');
    await guest.click('[data-act="signup"]'); await guest.waitForTimeout(2500);
    const gt = await text(guest);
    ok(/新規登録は停止しています/.test(gt), '新規登録しようとすると、停止中であることが表示される');
    await guest.ctx.close();

    const u = admin('POST', '/auth/v1/admin/users', { email: U.email, password: U.password, email_confirm: true }); uid = u.id;
    ok(!!uid, 'テスト専用ユーザーを作成（管理機能）');

    console.log('\n■ iPhone：ログイン・初期設定・作業');
    const ph = await open(browser, 'iphone', devices['iPhone 15']);
    await login(ph);
    ok((await text(ph)).includes('理想の生活リズム'), 'iPhone：ログインでき、初回は理想の設定が出る');
    await ph.click('[data-act="evAdd"]'); await ph.fill('#e-title0', '大学 講義');
    await ph.click('[data-act="saveIdeal"]');
    await ph.click('.quest [data-act="sheet"][data-v="task"]');
    await ph.fill('#t-title', '最終テストのタスク'); await ph.fill('#t-goal', '公開環境で確かめる'); await ph.fill('#t-est', '30');
    await ph.click('[data-act="saveTask"]');
    await ph.click('.quest [data-act="open-start"]'); await ph.click('[data-act="start"]');
    ok(await ph.locator('.timer').isVisible(), 'iPhone：タスクを開始できる');
    await ph.click('[data-act="pause"]'); ok((await text(ph)).includes('一時停止中'), 'iPhone：一時停止できる');
    await ph.click('[data-act="resume"]'); ok(!(await text(ph)).includes('一時停止中'), 'iPhone：再開できる');
    await ph.evaluate(() => { const s = window.__app.D.running(); window.__app.db.put('work_sessions', { id: s.id, started_at: new Date(Date.now() - 50 * 60000).toISOString() }); const b = window.__app.db.get('schedule_blocks', s.block_id); window.__app.db.put('schedule_blocks', { id: b.id, start_min: b.start_min - 50 }); }); // 50分前に開始したことにする
    await ph.click('[data-act="open-end"][data-status="継続"]');
    await ph.fill('#f-next', '公開テスト：次はここから'); await ph.fill('#f-progress', '半分まで');
    await ph.click('[data-act="end"]'); await ph.waitForTimeout(300);
    const s1 = await ph.evaluate(() => window.__app.db.all('work_sessions')[0]);
    ok(s1 && s1.ended_at && s1.minutes >= 49, `iPhone：終了で作業時間が記録される（${s1 && s1.minutes}分）`);
    const pt = await text(ph);
    const later = await ph.evaluate(() => { const D = window.__app.D; const s = window.__app.db.all('work_sessions')[0]; const blk = window.__app.db.raw('schedule_blocks', s.block_id); return D.blocks(blk.date).some((x) => x.id !== blk.id && !x.fixed && x.status === 'planned' && x.start_min >= blk.start_min); });
    ok(later ? pt.includes('予定変更の提案') : !pt.includes('予定変更の提案'), `iPhone：予定と実績のずれから予定変更の提案が出る（後ろにずらせる予定が${later ? 'ある' : 'ない時間帯は提案なし'}）`);
    const toastTxt = await ph.locator('#toast').innerText().catch(() => '');
    const noSlot = toastTxt.includes('今日は空きがない');
    ok(pt.includes('続きの再配置の提案') || noSlot, `iPhone：「継続」で終えると続きの再配置の提案が出る（今日の空きがない時間帯は、その旨を表示：${noSlot ? '空きなし' : '提案あり'}）`);
    while (await ph.locator('[data-act="acceptProposal"]').count()) { await ph.locator('[data-act="acceptProposal"]').first().click(); await ph.waitForTimeout(150); }
    const rb = await ph.evaluate(() => window.__app.D.blocks().filter((b) => b.kind === 'task' && b.status === 'planned').map((b) => b.id));
    ok(noSlot ? rb.length === 0 : rb.length === 1, 'iPhone：承認すると続きが時間割に入る（空きがない時間帯は入らない）');
    await ph.click('[data-act="wake"]');
    await sync(ph);
    ok((await ph.evaluate(() => window.__app.db.dirty.size)) === 0 && (await ph.evaluate(() => window.__app.db.status.error)) == null, 'iPhone：すべてサーバーへ送信済み（未送信0件・エラーなし）');

    console.log('\n■ PC：同じアカウントで同期');
    const pc = await open(browser, 'pc', { viewport: { width: 1440, height: 900 } });
    await login(pc);
    let t = await text(pc);
    ok(t.includes('最終テストのタスク') && t.includes('公開テスト：次はここから'), 'PC：iPhoneのタスクと引き継ぎが表示される');
    ok((await pc.evaluate((ids) => ids.every((id) => window.__app.D.blocks().some((b) => b.id === id)), rb)), 'PC：iPhoneで承認した再配置がPCの時間割にも出る');
    ok(t.includes('大学 講義') === (await ph.evaluate(() => window.__app.D.blocks().some((b) => b.title === '大学 講義'))), 'PC：時間割がiPhoneと一致する');
    const blk = await pc.evaluate(() => window.__app.D.blocks().find((b) => b.kind === 'exercise' && b.status === 'planned'));
    await pc.click(`[data-act="shift"][data-id="${blk.id}"][data-n="15"]`); await sync(pc);
    await ph.reload(); await ph.waitForFunction(() => window.__app && window.__app.V.firstSync, null, { timeout: 30000 }); await sync(ph);
    ok((await ph.evaluate((id) => window.__app.D.blocks().find((b) => b.id === id).start_min, blk.id)) === blk.start_min + 15, 'iPhone：再読み込み後、PCで変更した予定が反映される');
    ok((await ph.evaluate(() => window.__app.D.state().wake_at)) != null, 'iPhone：再読み込み後も記録が残る');

    console.log('\n■ オフライン起動（Service Worker）');
    const ctl = await ph.evaluate(async () => { await navigator.serviceWorker.ready; return !!navigator.serviceWorker.controller; });
    ok(ctl, 'iPhone：オフライン用の仕組み（Service Worker）が有効');
    await ph.ctx.setOffline(true);
    await ph.reload(); await ph.waitForTimeout(3000);
    t = await text(ph);
    ok(t.includes('最終テストのタスク') || t.includes('公開テスト：次はここから'), 'iPhone：オフラインでもアプリが起動し、記録が見られる');
    const fontOk = await ph.evaluate(() => document.fonts.check('16px "DotGothic16"'));
    ok(fontOk, 'iPhone：オフラインでもドット書体が使える');
    await vis(ph, '[data-act="tab"][data-v="habits"]').click();
    await ph.click('[data-act="scale"][data-f="energy"][data-n="2"]'); await sync(ph);
    ok(/オフライン|同期できません/.test(await ph.locator('.sync').first().innerText()), 'iPhone：オフライン中は同期待ちと表示される');
    await ph.screenshot({ path: path.join(OUT, 'public-iphone-offline.png'), fullPage: true });
    await ph.ctx.setOffline(false); await sync(ph); await sync(pc);
    ok((await pc.evaluate(() => (window.__app.D.state() || {}).energy)) === 2, 'PC：オンラインに戻ると、オフライン中の記録が届く');

    console.log('\n■ 表示（PC・iPhone）');
    await overflowAll(ph); await overflowAll(pc);
    ok([ph, pc].every((x) => x.errs.length === 0), 'ブラウザのエラーなし' + [ph, pc].map((x) => x.errs.join(' ')).join(''));
  } catch (e) { failures++; console.error(e); }
  finally {
    if (uid) admin('DELETE', '/auth/v1/admin/users/' + uid);
    const left = JSON.parse(curl(['-X', 'POST', `https://api.supabase.com/v1/projects/${REF}/database/query`, '-H', 'Content-Type: application/json', '-d', JSON.stringify({ query: "select (select count(*) from auth.users where email like 'final-%') u, (select count(*) from auth.users) total" })]));
    ok(left[0].u === 0 && left[0].total === 1, `テスト用ユーザーを削除し、残りはあなたのアカウント1件のみ（${left[0].total}件）`);
    await browser.close();
    console.log(`\n結果：成功 ${passes} ／ 失敗 ${failures}`);
    process.exit(failures ? 1 : 0);
  }
})();
