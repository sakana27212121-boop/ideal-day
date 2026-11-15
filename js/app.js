// アプリ本体：ログイン、画面切替、操作の受け取り、同期のきっかけ
import { DB } from './db.js';
import { createDomain } from './domain.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { uid, toMin, logicalDate, WD } from './util.js';
import * as UI from './views.js';

const root = document.getElementById('app');
const toastEl = document.getElementById('toast');
const params = new URLSearchParams(location.search);
const LOCAL = params.has('local'); // 開発・検証用：ログインせずこの端末だけで動かす
const db = new DB();
const D = createDomain(db);
const V = { tab: 'home', sheet: null, id: null, period: 7, mini: false, signup: false, authMsg: '', authErr: false, busy: false, ready: false, user: null };
const TABS = ['home', 'habits', 'tasks', 'growth', 'ai', 'setup'];
let client = null;
let toastTimer;

function toast(msg) { if (!msg) return; toastEl.textContent = msg; toastEl.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (toastEl.hidden = true), 2600); }
const val = (id) => { const e = document.getElementById(id); return e ? e.value.trim() : ''; };
const radio = (n) => { const e = root.querySelector(`input[name="${n}"]:checked`); return e ? e.value : ''; };

// ---------- 描画 ----------
function render() {
  const active = document.activeElement, keepId = active && active.id, selStart = active && active.selectionStart;
  if (!V.ready) { root.innerHTML = '<div class="auth"><h1>冒険の書</h1><p class="meta" style="text-align:center">読み込み中…</p></div>'; return; }
  if (!V.user && !LOCAL) { root.innerHTML = UI.authView(V); return; }
  UI.setTerms(D.prefs().terms);
  document.title = '冒険の書';
  // 新しい端末では、最初の受信が終わるまで設定画面を出さない（既存の設定を上書きしないため）
  if (!D.onboarded() && V.user && !V.firstSync && navigator.onLine !== false) { root.innerHTML = '<div class="auth"><h1>冒険の書</h1><p class="meta" style="text-align:center">記録を読み込んでいます…</p></div>'; return; }
  const tab = D.onboarded() ? V.tab : 'setup';
  const run = D.running();
  let html;
  if (run && !V.mini) html = UI.battle(D) + (V.sheet === 'end' ? UI.endSheet(D, V) : '');
  else {
    const page = { home: UI.home, habits: UI.habits, tasks: UI.tasks, growth: UI.growth, ai: UI.ai, setup: UI.setup }[tab](D, V);
    const back = run ? `<button class="btn go wide" data-act="mini">${UI.T('doing')}：${(D.task(run.task_id) || {}).title || ''}（<span data-elapsed>${UI.elapsedClock(D.elapsedMs(run))}</span>）に戻る</button>` : '';
    const d = new Date(), today = D.today();
    html = `<div class="shell">${D.onboarded() ? UI.nav(V, db) : ''}<main>
      <div class="topbar"><span class="day">${+today.slice(5, 7)}月${+today.slice(8)}日（${WD[new Date(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8)).getDay()]}）</span>${UI.syncBadge(db)}</div>
      ${back}${page}
      <div class="foot">${V.user ? `<span>${V.user.email || ''}</span><button data-act="logout">ログアウト</button>` : '<span>この端末のみで動作中（検証用）</span>'}<button data-act="syncNow">今すぐ同期</button></div></main></div>`;
    html += { start: UI.startSheet, task: UI.taskSheet, block: UI.blockSheet, sleep: UI.sleepSheet }[V.sheet]?.(D, V) || '';
  }
  root.innerHTML = html;
  if (keepId) { const e = document.getElementById(keepId); if (e) { e.focus(); try { if (selStart != null) e.setSelectionRange(selStart, selStart); } catch (x) { /* 選択位置を持たない入力 */ } } }
}
// 入力中は外部（同期）の更新で描き直さない
function softRender() { if (V.acting) { V.pending = true; return; } const a = document.activeElement; if (a && root.contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) { V.pending = true; return; } render(); }
root.addEventListener('focusout', () => setTimeout(() => { if (V.pending && !(document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))) { V.pending = false; render(); } }, 0));

db.on((src) => { if (src === 'remote') { D.ensureDay(); softRender(); } else if (src === 'status') { document.querySelectorAll('.sync').forEach((e) => (e.outerHTML = UI.syncBadge(db))); } else softRender(); });

// ---------- 起動 ----------
async function boot() {
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  const h = location.hash.slice(1); if (TABS.includes(h)) V.tab = h;
  if (LOCAL) { db.load('local'); V.ready = true; afterLoad(); return; }
  if (!window.supabase) { // ライブラリが読めない（オフライン初回など）
    const last = localStorage.getItem('ideal-day:lastUser');
    if (last) { const u = JSON.parse(last); V.user = u; db.load(u.id); }
    V.ready = true; afterLoad(); return;
  }
  client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'ideal-day-auth' } });
  let session = null;
  try { session = (await client.auth.getSession()).data.session; } catch (e) { /* オフライン */ }
  if (session) setUser(session.user);
  else { const last = localStorage.getItem('ideal-day:lastUser'); if (last && navigator.onLine === false) { const u = JSON.parse(last); V.user = u; db.load(u.id); db.attach(client); } }
  client.auth.onAuthStateChange((ev, s) => {
    if (ev === 'SIGNED_OUT') { V.user = null; render(); }
    else if (s && (!V.user || V.user.id !== s.user.id)) { setUser(s.user); afterLoad(); }
  });
  V.ready = true; afterLoad();
}
function setUser(u) {
  V.user = { id: u.id, email: u.email };
  try { localStorage.setItem('ideal-day:lastUser', JSON.stringify(V.user)); } catch (e) { /* 保存できなくても続行 */ }
  db.load(u.id); db.attach(client); V.firstSync = false;
}
async function afterLoad() {
  render();
  if (V.user && client) {
    await db.sync();
    V.firstSync = true; // 受信できなかった場合も、端末内のデータで続ける
    D.ensureDay(); render();
  } else if (LOCAL) { D.ensureDay(); render(); }
}

// 定期処理：経過時間の表示、日付の切替、同期
let lastDay = logicalDate(), lastMinute = -1;
setInterval(() => {
  const run = D.running();
  if (run) document.querySelectorAll('[data-elapsed]').forEach((e) => (e.textContent = UI.elapsedClock(D.elapsedMs(run))));
  const m = new Date().getMinutes();
  if (m !== lastMinute) { lastMinute = m; const day = logicalDate(); if (day !== lastDay) { lastDay = day; newDay(); } if (V.ready && !V.sheet) softRender(); }
}, 1000);
// 日付が変わったら、先に同期してから時間割を作る（端末に最新の週の型が届く前に古い設定で作らない）
async function newDay() { try { await db.sync(); } catch (e) { /* 通信できなくても端末内のデータで続ける */ } D.ensureDay(); render(); }
setInterval(() => { if (document.visibilityState === 'visible') db.sync(); }, 20000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') db.sync(); });
window.addEventListener('online', () => db.sync());
window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (TABS.includes(h) && h !== V.tab) { V.tab = h; V.sheet = null; render(); } });

// ---------- 操作 ----------
const acts = {
  tab: (d) => { V.tab = d.v; V.sheet = null; V.mini = false; V.events = null; try { history.replaceState(null, '', '#' + d.v); } catch (e) { /* 一部の環境では不可 */ } render(); window.scrollTo(0, 0); },
  sheet: (d) => { V.sheet = d.v; V.id = d.id || null; render(); const f = root.querySelector('.overlay input, .overlay select, .overlay button'); if (f) f.focus(); },
  close: () => { V.sheet = null; render(); },
  mini: () => { V.mini = !V.mini; render(); },
  'open-start': (d) => { V.sheet = 'start'; V.id = d.id; V.block = d.block || null; render(); },
  start: () => { const s = D.start(V.id, V.block); V.sheet = null; V.mini = false; if (s) toast('開始時刻を記録しました'); render(); },
  pause: () => { D.pause(); toast('一時停止しました'); },
  resume: () => { D.resume(); toast('再開しました'); },
  'open-end': (d) => { V.sheet = 'end'; V.status = d.status; render(); },
  end: () => {
    const f = { status: radio('status') || V.status || '継続', focus: +radio('focus') || null, energy: +radio('energy') || null, progress: val('f-progress'), remaining: val('f-remaining'), next: val('f-next'), problem: val('f-problem') };
    V.sheet = null; V.mini = false; V.tab = 'home';
    const r = D.end(f);
    toast(f.status === '完了' ? 'タスクを完了にしました' : r && r.resched && r.resched.none ? '記録しました。今日は空きがないため、続きは明日の予定に入ります' : f.next ? '記録しました。次回はここから再開できます' : '記録しました');
    render(); return r;
  },
  cancelSession: () => { D.cancelSession(); toast('開始を取り消しました'); },
  acceptProposal: (d) => {
    const p = D.db.get('improvement_proposals', d.id), r = D.acceptProposal(d.id) || {};
    if (p && p.kind === 'reschedule') toast(r.ok ? (r.moved ? `空きが変わっていたため ${UI.fmtMin(r.start)} から入れました` : '続きを時間割に入れました') : '今日は入れられる空き時間がありません');
    else toast('予定を変更しました（固定予定はそのまま）');
  },
  rejectProposal: (d) => { D.rejectProposal(d.id); toast('予定は変更していません'); },
  shift: (d) => { D.shiftBlock(d.id, +d.n); },
  replan: () => { const n = D.replan(); toast(n ? `${n}件のタスクを空き時間に入れました` : '入れられる空き時間やタスクがありません'); },
  wake: () => { const s = D.recordWake(); toast(s != null ? `起床を記録しました（睡眠 ${s}時間）` : '起床を記録しました'); },
  undoWake: () => { D.undoWake(); toast('起床の記録を取り消しました'); },
  bed: () => { D.recordBed(); toast('就寝を記録しました。おやすみなさい'); },
  undoBed: () => { D.undoBed(); toast('就寝の記録を取り消しました'); },
  habit: (d) => D.toggleHabit(d.id),
  rest: () => { D.addRest(); toast('休憩を記録しました'); },
  scale: (d) => D.setScale(d.f, +d.n),
  saveNote: () => { D.putState(D.today(), { note: val('f-note') || null }); toast('保存しました'); },
  saveSleep: () => { const h = parseFloat(val('s-hours')); if (!(h >= 0 && h <= 16)) { toast('0〜16の数字で入力してください'); return; } D.setSleepHours(h); V.sheet = null; toast('睡眠時間を保存しました'); render(); },
  addHabit: () => { const n = val('f-habit'); if (!n) { toast('習慣の名前を入力してください'); return; } D.addHabit(n); toast('習慣を追加しました'); },
  hideHabit: (d) => { D.hideHabit(d.id); toast('習慣を外しました（記録は残ります）'); },
  addChallenge: (d) => { D.addHabit(d.v); toast('習慣に追加しました'); },
  terms: () => { D.setPref('terms', UI.isGame() ? 'plain' : 'game'); },
  saveTask: (d) => {
    const title = val('t-title'); if (!title) { const e = document.getElementById('t-err'); if (e) e.hidden = false; document.getElementById('t-title')?.focus(); return; }
    const est = Math.max(5, Math.min(600, parseInt(val('t-est'), 10) || 30));
    const v = { title, goal: val('t-goal') || null, done_when: val('t-done') || null, estimate_min: est, priority: +val('t-prio') || 2, due_date: val('t-due') || null }, proj = val('t-project');
    D.saveTask({ ...(d.id ? D.db.raw('tasks', d.id) : {}), id: d.id || undefined, ...v, project_id: D.ensureProject(proj) });
    V.sheet = null; toast(d.id ? 'タスクを保存しました' : 'タスクを追加しました（「空き時間にタスクを入れ直す」で時間割に入ります）'); render();
  },
  deleteTask: (d) => { if (V.confirm !== 'task' + d.id) { V.confirm = 'task' + d.id; toast('もう一度押すと削除します'); return; } V.confirm = null; D.deleteTask(d.id); V.sheet = null; toast('タスクを削除しました'); render(); },
  reopenTask: (d) => { D.reopenTask(d.id); V.sheet = null; toast('未完了に戻しました'); render(); },
  saveBlock: (d) => {
    const start = toMin(val('b-start')), len = parseInt(val('b-dur'), 10);
    if (start == null || !(len > 0)) { toast('開始時刻と長さを入力してください'); return; }
    const taskId = val('b-task'), fixed = !!document.getElementById('b-fixed')?.checked;
    let s = start; if (s < 240 && D.idealOrDefault().wake_time && toMin(D.idealOrDefault().wake_time) > s) s += 1440; // 深夜は当日の続き
    const base = d.id ? D.db.get('schedule_blocks', d.id) : null;
    if (base) D.saveBlock({ id: base.id, start_min: s, dur: len, fixed, ...(base.kind !== 'task' ? { title: val('b-title') || base.title, kind: val('b-kind') || base.kind } : {}) });
    else if (taskId) D.saveBlock({ start_min: s, dur: len, kind: 'task', task_id: taskId, fixed });
    else { const title = val('b-title'); if (!title) { toast('名前を入力するか、タスクを選んでください'); return; } D.saveBlock({ start_min: s, dur: len, kind: val('b-kind') || 'habit', title, fixed: fixed || val('b-kind') === 'fixed' }); }
    V.sheet = null; toast('予定を保存しました'); render();
  },
  deleteBlock: (d) => { D.deleteBlock(d.id); V.sheet = null; toast('予定を削除しました'); render(); },
  period: (d) => { V.period = +d.n; render(); },
  experiment: (d) => { const h = D.analysis(V.period).hypotheses.find((x) => x.key === d.key) || D.analysis(14).hypotheses.find((x) => x.key === d.key); if (h) { D.startExperiment(h); toast('改善実験を始めました（7日間）'); } },
  evaluate: (d) => { D.evaluate(d.id); toast('記録から結果をまとめました'); },
  decide: (d) => { D.decide(d.id, d.v); toast({ keep: '続けることにしました', revert: '元に戻すことにしました', other: '別の案を試せます' }[d.v]); },
  cDays: (d) => { V.cDays = +d.n; render(); },
  copyConsult: async () => {
    const el = document.getElementById('c-text'); if (!el) return;
    try { await navigator.clipboard.writeText(el.value); toast('コピーしました。Claude Code に貼り付けてください'); }
    catch (e) { el.focus(); el.select(); try { el.setSelectionRange(0, el.value.length); } catch (x) { /* 選択できない環境 */ } toast('自動でコピーできませんでした。選択された文章をコピーしてください'); }
  },
  evAdd: () => { V.events = readEvents(); V.events.push({ id: uid(), title: '', weekdays: [1], start_min: 540, dur: 90, kind: 'fixed', active: true }); render(); },
  evDel: (d) => { V.events = readEvents(); V.events.splice(+d.i, 1); render(); },
  saveIdeal: () => {
    const I = D.idealOrDefault();
    const meals = (I.meals || []).map((m, i) => ({ name: val('i-meal-n' + i) || m.name, time: val('i-meal-t' + i) || m.time, dur: parseInt(val('i-meal-d' + i), 10) || m.dur }));
    const lines = (id) => val(id).split('\n').map((x) => x.trim()).filter(Boolean);
    const v = { wake_time: val('i-wake') || I.wake_time, bed_time: val('i-bed') || I.bed_time, sleep_hours: parseFloat(val('i-sleep')) || I.sleep_hours, meals,
      exercise_time: val('i-ex-t') || null, exercise_min: parseInt(val('i-ex-m'), 10) || 0, free_time: val('i-free-t') || null, free_min: parseInt(val('i-free-m'), 10) || 0,
      work_start: val('i-ws') || null, work_end: val('i-we') || null, rest_min: parseInt(val('i-rest'), 10) || 0, rest_every_min: I.rest_every_min, focus_period: val('i-focus') || 'am', goals: lines('i-goals'), priorities: lines('i-prio') };
    const events = readEvents().filter((e) => e.title && e.weekdays.length && e.dur > 0);
    const first = !D.onboarded();
    D.saveIdeal(v, events); V.events = null;
    if (first) D.ensureDay();
    V.tab = first ? 'home' : 'habits'; toast(first ? '冒険を始めましょう。今日の旅程を作りました' : '理想の生活を保存しました（明日以降の予定に反映されます）'); render();
  },
  login: async () => {
    const email = val('a-email'), pass = document.getElementById('a-pass')?.value || '';
    V.email = email; if (!email || !pass) { V.authMsg = 'メールアドレスとパスワードを入力してください'; V.authErr = true; render(); return; }
    V.busy = true; V.authMsg = ''; render();
    const { error } = await client.auth.signInWithPassword({ email, password: pass });
    V.busy = false;
    if (error) { V.authMsg = /confirm/i.test(error.message) ? 'メールの確認がまだです。届いたメールのリンクを開いてから、もう一度ログインしてください' : /invalid/i.test(error.message) ? 'メールアドレスかパスワードが違います' : 'ログインできませんでした：' + error.message; V.authErr = true; render(); }
  },
  signup: async () => {
    const email = val('a-email'), pass = document.getElementById('a-pass')?.value || '';
    V.email = email; if (!email || pass.length < 8) { V.authMsg = 'メールアドレスと、8文字以上のパスワードを入力してください'; V.authErr = true; render(); return; }
    V.busy = true; render();
    const { data, error } = await client.auth.signUp({ email, password: pass, options: { emailRedirectTo: location.origin + location.pathname } });
    V.busy = false;
    if (error) { V.authMsg = /not allowed|disabled/i.test(error.message) ? '新規登録は停止しています（個人用のアプリです）。登録済みのアカウントでログインしてください' : '登録できませんでした：' + error.message; V.authErr = true; }
    else if (!data.session) { V.signup = false; V.authMsg = '確認メールを送りました。メールのリンクを開いてから、ここでログインしてください'; V.authErr = false; }
    render();
  },
  authMode: () => { V.email = val('a-email'); V.signup = !V.signup; V.authMsg = ''; render(); },
  logout: async () => { if (V.confirm !== 'logout') { V.confirm = 'logout'; toast('もう一度押すとログアウトします'); return; } V.confirm = null; await db.sync(); await client.auth.signOut(); V.user = null; localStorage.removeItem('ideal-day:lastUser'); render(); },
  syncNow: async () => { await db.sync(); toast(db.status.state === 'ok' ? '同期しました' : db.status.state === 'local' ? 'この端末のみのモードです' : '同期できませんでした。通信状態を確認してください'); },
};
function readEvents() {
  const evs = V.events || D.fixedEvents();
  return evs.map((e, i) => {
    if (!document.getElementById('e-title' + i)) return { ...e };
    const s = toMin(val('e-start' + i)), en = toMin(val('e-end' + i));
    return { ...e, title: val('e-title' + i), start_min: s ?? e.start_min, dur: s != null && en != null ? (en > s ? en - s : en + 1440 - s) : e.dur, weekdays: [0, 1, 2, 3, 4, 5, 6].filter((d) => document.getElementById(`e-wd${i}-${d}`)?.checked) };
  });
}

root.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
  const a = el.dataset.act; if (!acts[a]) return;
  if (a !== 'deleteTask' && a !== 'logout') V.confirm = null;
  e.preventDefault();
  // 操作の途中では描き直さず、終わってから1回だけ描く（入力値の読み取り中に画面が変わらないように）
  V.acting = true; let r;
  try { r = acts[a](el.dataset); } finally { V.acting = false; }
  const done = () => { if (V.pending) { V.pending = false; render(); } };
  if (r && typeof r.then === 'function') r.then(done, done); else done();
});
root.addEventListener('change', (e) => { if (e.target.id === 'c-free') { V.cFree = e.target.checked; render(); } });
root.addEventListener('input', (e) => { if (e.target.id === 'f-memo') { clearTimeout(V.memoT); const v = e.target.value; V.memoT = setTimeout(() => D.memo(v), 600); } });
root.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && V.sheet) { acts.close(); return; }
  if (e.key !== 'Enter' || e.isComposing) return;
  const map = { 'f-ask': 'ask', 'f-habit': 'addHabit', 'a-pass': V.signup ? 'signup' : 'login' };
  if (map[e.target.id]) { e.preventDefault(); acts[map[e.target.id]]({}); }
});

window.__app = { D, db, V, render }; // 検証用
boot();
