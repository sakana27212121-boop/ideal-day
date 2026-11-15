// 生活・タスク・予定・分析のルール（画面からは独立）
import { uid, detId, logicalDate, addDays, weekday, toMin, fmt, nowMin, avg, tsMin, md, dur } from './util.js';

export const DEFAULT_IDEAL = {
  wake_time: '06:30', bed_time: '23:30', sleep_hours: 7,
  meals: [{ name: '朝食', time: '07:00', dur: 30 }, { name: '昼食', time: '12:00', dur: 45 }, { name: '夕食', time: '19:00', dur: 45 }],
  exercise_time: '18:00', exercise_min: 30, rest_every_min: 90, rest_min: 15, free_time: '21:00', free_min: 90,
  focus_period: 'am', work_start: '09:00', work_end: '18:00', goals: [], priorities: [],
};

export function createDomain(db) {
  const D = {};
  D.db = db;
  D.today = () => logicalDate();
  D.settings = () => db.all('user_settings')[0] || null;
  D.prefs = () => (D.settings() && D.settings().prefs) || {};
  D.setPref = (k, v) => { const s = D.settings(); db.put('user_settings', { id: s ? s.id : (db.uid && db.uid !== 'local' ? db.uid : uid()), prefs: { ...D.prefs(), [k]: v }, onboarded: s ? s.onboarded : false }); };
  D.onboarded = () => !!(D.settings() && D.settings().onboarded && D.ideal());
  D.ideal = () => db.all('ideal_life')[0] || null;
  D.idealOrDefault = () => ({ ...DEFAULT_IDEAL, ...(D.ideal() || {}) });

  // ---------- 理想の設定 ----------
  D.saveIdeal = (v, fixedEvents) => {
    const cur = D.ideal();
    db.put('ideal_life', { ...v, id: cur ? cur.id : uid() }, { batch: true });
    const habits = db.all('habits');
    v.meals.forEach((m, i) => { if (!habits.find((h) => h.kind === 'meal' && h.name === m.name)) db.put('habits', { id: uid(), name: m.name, kind: 'meal', target: m.time, sort: i }, { batch: true }); });
    if (!habits.find((h) => h.kind === 'exercise')) db.put('habits', { id: uid(), name: '運動', kind: 'exercise', target: v.exercise_min + '分', sort: 10 }, { batch: true });
    if (fixedEvents) {
      const keep = new Set(fixedEvents.map((e) => e.id));
      // 設定画面で扱うのは固定予定だけ。週の型（kind≠fixed）は消さない
      db.all('recurring_events').filter((e) => (e.kind || 'fixed') === 'fixed').forEach((e) => { if (!keep.has(e.id)) db.remove('recurring_events', e.id, { batch: true }); });
      fixedEvents.forEach((e) => db.put('recurring_events', e, { batch: true }));
    }
    const s = D.settings();
    db.put('user_settings', { id: s ? s.id : (db.uid && db.uid !== 'local' ? db.uid : uid()), prefs: D.prefs(), onboarded: true }, { batch: true });
    db.commit();
  };

  // ---------- 習慣・日々の状態 ----------
  D.habits = () => db.all('habits').filter((h) => h.active !== false).sort((a, b) => a.sort - b.sort);
  D.state = (date = D.today()) => db.all('daily_states').find((s) => s.date === date) || null;
  D.putState = (date, patch) => { const s = D.state(date); return db.put('daily_states', { ...(s || { id: uid(), date, rest_count: 0 }), ...patch }); };
  D.habitLog = (date, hid) => db.all('habit_logs').find((l) => l.date === date && l.habit_id === hid) || null;
  // 習慣の記録は3状態：null＝未記録、true＝した、false＝しなかった（未記録を「しなかった」と混同しない）
  D.habitStatus = (date, hid) => { const l = D.habitLog(date, hid); return l ? l.done !== false : null; };
  // タップで 未記録 → した → しなかった → 未記録 と切り替える
  D.toggleHabit = (hid, date = D.today()) => { const l = D.habitLog(date, hid);
    if (!l) db.put('habit_logs', { id: uid(), date, habit_id: hid, done: true, at: new Date().toISOString() });
    else if (l.done !== false) db.put('habit_logs', { id: l.id, done: false, at: new Date().toISOString() });
    else db.remove('habit_logs', l.id); };
  // 食事の記録状況：done＝食べた数、known＝記録した数、total＝食事の数（known＝0なら未記録）
  D.mealText = (m) => (!m || !m.known ? '−' : m.known < m.total ? `${m.done}（未${m.total - m.known}）` : `${m.done}/${m.total}`);
  D.mealStatus = (date) => { const ms = D.habits().filter((h) => h.kind === 'meal'), st = ms.map((m) => D.habitStatus(date, m.id)); return { done: st.filter((x) => x === true).length, known: st.filter((x) => x !== null).length, total: ms.length }; };
  D.recordWake = () => {
    const date = D.today(), now = new Date(), prev = D.state(addDays(date, -1));
    let sleep = null;
    if (prev && prev.bed_at) { const h = (now - new Date(prev.bed_at)) / 3.6e6; if (h > 0 && h < 16) sleep = Math.round(h * 10) / 10; }
    D.putState(date, { wake_at: now.toISOString(), ...(sleep != null ? { sleep_hours: sleep } : {}) });
    return sleep;
  };
  D.undoWake = () => D.putState(D.today(), { wake_at: null });
  D.recordBed = () => D.putState(D.today(), { bed_at: new Date().toISOString() });
  D.undoBed = () => D.putState(D.today(), { bed_at: null });
  D.setScale = (field, n) => D.putState(D.today(), { [field]: n });
  D.addRest = () => { const s = D.state(); D.putState(D.today(), { rest_count: ((s && s.rest_count) || 0) + 1 }); };
  D.setSleepHours = (h) => D.putState(D.today(), { sleep_hours: h });
  D.addHabit = (name) => db.put('habits', { id: uid(), name, kind: 'custom', sort: 20 + D.habits().length });
  D.hideHabit = (id) => db.put('habits', { id, active: false });

  // ---------- タスク ----------
  D.projects = () => db.all('projects').filter((p) => p.active !== false);
  D.project = (id) => db.get('projects', id);
  D.ensureProject = (name) => { if (!name) return null; const p = D.projects().find((x) => x.name === name); return p ? p.id : db.put('projects', { id: uid(), name }).id; };
  D.tasks = () => db.all('tasks');
  D.task = (id) => db.get('tasks', id);
  D.openTasks = () => D.tasks().filter((t) => t.status !== 'done' && !t.recurring).sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999') || a.priority - b.priority || a.sort - b.sort);
  D.recurringTasks = () => D.tasks().filter((t) => t.recurring).sort((a, b) => a.sort - b.sort);
  D.saveTask = (v) => db.put('tasks', { status: 'open', priority: 2, estimate_min: 30, sort: D.tasks().length, ...v, id: v.id || uid() });
  D.reopenTask = (id) => db.put('tasks', { id, status: 'open', completed_at: null });
  D.deleteTask = (id) => { db.remove('tasks', id, { batch: true }); db.all('schedule_blocks').filter((b) => b.task_id === id && b.status === 'planned').forEach((b) => db.remove('schedule_blocks', b.id, { batch: true })); db.commit(); };
  D.sessionsOf = (taskId) => db.all('work_sessions').filter((s) => s.task_id === taskId && s.ended_at).sort((a, b) => a.started_at.localeCompare(b.started_at));
  D.handoff = (taskId) => db.all('handoffs').filter((h) => h.task_id === taskId).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] || null;
  D.workedMin = (taskId) => D.sessionsOf(taskId).reduce((a, s) => a + (s.minutes || 0), 0);
  // 実績からの見積もり補正（予定時間に対する実績の比）
  D.paceRatio = () => {
    const pairs = db.all('work_sessions').filter((s) => s.ended_at && s.block_id && s.minutes).map((s) => { const b = db.raw('schedule_blocks', s.block_id); return b && b.dur ? s.minutes / b.dur : null; }).filter((x) => x && x > 0.2 && x < 4);
    return pairs.length >= 3 ? { ratio: Math.round(avg(pairs) * 100) / 100, n: pairs.length } : null;
  };
  D.predictMin = (t) => { const p = D.paceRatio(); const base = t.estimate_min || 30; const m = p ? base * Math.min(1.5, Math.max(0.7, p.ratio)) : base; return Math.max(15, Math.min(120, Math.round(m / 5) * 5)); };

  // ---------- 予定 ----------
  D.blocks = (date = D.today()) => db.all('schedule_blocks').filter((b) => b.date === date).sort((a, b) => a.start_min - b.start_min);
  D.blockLabel = (b) => (b.kind === 'task' ? ((D.task(b.task_id) || {}).title || '（削除されたタスク）') : b.title);
  D.ensureDay = (date = D.today()) => {
    if (!D.onboarded()) return false;
    if (db.all('schedule_blocks').some((b) => b.date === date) || Object.values(db.data.schedule_blocks).some((b) => b.date === date)) return D.healDay(date);
    D.generate(date); return true;
  };
  // 週の型が届く前に理想の生活から作られてしまった日を、週の型で作り直す。
  // 条件：その曜日に週の型がある／その日の予定がすべて自動作成のまま（手で直した予定・終了した予定・作業記録がない）／週の型を登録した日の翌日以降
  D.healDay = (date) => {
    const tpl = D.templateFor(date).filter((e) => (e.kind || 'fixed') !== 'fixed'); if (!tpl.length) return false;
    const bl = D.blocks(date); if (!bl.length || bl.some((b) => b.source !== 'auto' || b.status !== 'planned')) return false;
    const ids = new Set(bl.map((b) => b.id)); if (db.all('work_sessions').some((s) => ids.has(s.block_id))) return false;
    const regDay = logicalDate(new Date(tpl.map((e) => e.updated_at).sort()[0]));
    if (date <= regDay) return false;
    bl.forEach((b) => db.remove('schedule_blocks', b.id, { batch: true }));
    D.generate(date); return true;
  };
  // 週の型：曜日ごとの時間割（固定予定以外も含む）。登録されている曜日は型どおりに作る
  D.fixedEvents = () => db.all('recurring_events').filter((e) => e.active !== false && (e.kind || 'fixed') === 'fixed');
  D.templateFor = (date) => db.all('recurring_events').filter((e) => e.active !== false && (e.weekdays || []).includes(weekday(date))).sort((a, b) => a.start_min - b.start_min);
  D.hasTemplate = (date) => D.templateFor(date).some((e) => (e.kind || 'fixed') !== 'fixed');
  D.generate = (date) => {
    if (D.hasTemplate(date)) {
      D.templateFor(date).forEach((e) => { const kind = e.kind || 'fixed';
        db.put('schedule_blocks', { id: detId(db.uid || 'local', date, 'tp' + e.id), date, start_min: e.start_min, dur: e.dur, kind, title: e.title, task_id: e.task_id || null,
          fixed: kind === 'fixed', status: 'planned', source: 'template' }, { batch: true }); });
      db.commit(); return;
    }
    const I = D.idealOrDefault(), key = (k) => detId(db.uid || 'local', date, k);
    const wake = toMin(I.wake_time); let bed = toMin(I.bed_time); if (bed <= wake) bed += 1440;
    const add = (k, kind, title, start, d, extra = {}) => { if (start == null || !d) return; db.put('schedule_blocks', { id: key(k), date, start_min: start, dur: d, kind, title, fixed: false, status: 'planned', source: 'auto', ...extra }, { batch: true }); };
    add('wake', 'habit', '起床・身支度', wake, 30);
    (I.meals || []).forEach((m, i) => add('meal' + i, 'meal', m.name, toMin(m.time), m.dur || 30));
    db.all('recurring_events').filter((e) => e.active !== false && (e.weekdays || []).includes(weekday(date))).forEach((e) => add('fx' + e.id, 'fixed', e.title, e.start_min, e.dur, { fixed: true }));
    if (I.exercise_time && I.exercise_min) add('ex', 'exercise', '運動', toMin(I.exercise_time), I.exercise_min);
    if (I.free_time && I.free_min) add('free', 'free', '自由時間', toMin(I.free_time), I.free_min);
    add('bed', 'habit', '就寝準備', bed - 30, 30);
    db.commit();
    D.placeTasks(date, null, key);
  };
  // 空き時間の一覧（override：{予定ID: 仮の開始分} で「提案を承認した後」の状態を想定できる）
  D.freeWindows = (date, fromMin, override = {}) => {
    const I = D.idealOrDefault();
    const lo = Math.max(toMin(I.work_start) ?? toMin(I.wake_time) + 60, fromMin ?? 0), hi = toMin(I.work_end) ?? (toMin(I.bed_time) - 120);
    const busy = D.blocks(date).map((b) => { const st = override[b.id] ?? b.start_min; return [st, st + b.dur]; }).sort((a, b) => a[0] - b[0]);
    let wins = []; let cur = lo;
    busy.forEach(([s, e]) => { if (s > cur) wins.push([cur, Math.min(s, hi)]); cur = Math.max(cur, e); });
    if (cur < hi) wins.push([cur, hi]);
    return wins.filter(([s, e]) => e - s >= 15).map(([s, e]) => [Math.ceil(s / 5) * 5, e]).filter(([s, e]) => e - s >= 15);
  };
  D.focusPref = () => ({ am: (w) => w[0], pm: (w) => (w[0] >= 720 ? w[0] - 2000 : w[0]), night: (w) => (w[0] >= 1020 ? w[0] - 3000 : w[0]) }[D.idealOrDefault().focus_period] || ((w) => w[0]));
  D.findSlot = (date, L, fromMin, override) => { const pref = D.focusPref(); const w = D.freeWindows(date, fromMin, override).sort((a, b) => pref(a) - pref(b)).find((x) => x[1] - x[0] >= L); return w ? w[0] : null; };
  // 空き時間にタスクを入れる（集中しやすい時間帯を優先）
  D.placeTasks = (date, fromMin, keyFn) => {
    const I = D.idealOrDefault();
    const scheduled = new Set(D.blocks(date).filter((b) => b.kind === 'task').map((b) => b.task_id));
    const wins = D.freeWindows(date, fromMin);
    const pref = D.focusPref();
    let placed = 0;
    for (const t of D.openTasks()) {
      if (scheduled.has(t.id)) continue;
      const L = D.predictMin(t);
      const order = wins.map((w, i) => [w, i]).sort((a, b) => pref(a[0]) - pref(b[0]));
      const hit = order.find(([w]) => w[1] - w[0] >= L);
      if (!hit) continue;
      const w = hit[0], s = w[0];
      db.put('schedule_blocks', { id: keyFn ? keyFn('task' + t.id) : uid(), date, start_min: s, dur: L, kind: 'task', task_id: t.id, fixed: false, status: 'planned', source: 'auto' }, { batch: true });
      let next = s + L;
      if (I.rest_min && w[1] - next >= I.rest_min + 15) { db.put('schedule_blocks', { id: keyFn ? keyFn('rest' + t.id) : uid(), date, start_min: next, dur: I.rest_min, kind: 'rest', title: '休憩', fixed: false, status: 'planned', source: 'auto' }, { batch: true }); next += I.rest_min; }
      w[0] = next; placed++;
    }
    db.commit();
    return placed;
  };
  // 予定を組み直す：今より後の自動のタスク・休憩枠を消して、空き時間に入れ直す（固定予定・生活の枠は動かさない）
  D.replan = () => {
    const date = D.today(), n = nowMin();
    D.blocks(date).filter((b) => b.source === 'auto' && b.status === 'planned' && (b.kind === 'task' || b.kind === 'rest') && b.start_min >= n).forEach((b) => db.remove('schedule_blocks', b.id, { batch: true }));
    db.commit();
    return D.placeTasks(date, Math.ceil(n / 5) * 5, null);
  };
  D.saveBlock = (v) => db.put('schedule_blocks', { date: D.today(), status: 'planned', source: 'user', fixed: false, ...v, id: v.id || uid() });
  D.deleteBlock = (id) => db.remove('schedule_blocks', id);
  D.shiftBlock = (id, delta) => { const b = db.get('schedule_blocks', id); if (b && !b.fixed) db.put('schedule_blocks', { id, start_min: b.start_min + delta }); };
  D.timeline = (date = D.today()) => {
    const n = nowMin(), run = D.running();
    return D.blocks(date).map((b) => ({ ...b, label: D.blockLabel(b), end: b.start_min + b.dur,
      state: run && run.block_id === b.id ? 'active' : b.status === 'done' ? 'done' : (n >= b.start_min && n < b.start_min + b.dur) ? 'now' : n >= b.start_min + b.dur ? 'past' : 'future' }));
  };

  // ---------- NEXT ACTION ----------
  D.nextAction = () => {
    const run = D.running(); if (run) return { mode: 'working', task: D.task(run.task_id), session: run };
    const n = nowMin(), date = D.today();
    const cands = D.blocks(date).filter((b) => b.kind === 'task' && b.status === 'planned' && D.task(b.task_id) && D.task(b.task_id).status !== 'done');
    const b = cands.find((x) => x.start_min + x.dur > n) || cands[0];
    if (b) { const t = D.task(b.task_id); return { mode: D.sessionsOf(t.id).length ? 'resume' : 'start', task: t, block: b, late: b.start_min + b.dur <= n }; }
    const t = D.openTasks()[0];
    if (t) return { mode: D.sessionsOf(t.id).length ? 'resume' : 'start', task: t, block: null, unscheduled: true };
    return { mode: 'none' };
  };

  // ---------- 作業セッション ----------
  D.running = () => db.all('work_sessions').filter((s) => !s.ended_at).sort((a, b) => b.started_at.localeCompare(a.started_at))[0] || null;
  D.elapsedMs = (s) => { if (!s) return 0; const end = s.ended_at ? new Date(s.ended_at) : s.paused_at ? new Date(s.paused_at) : new Date(); return Math.max(0, end - new Date(s.started_at) - (s.paused_ms || 0)); };
  D.start = (taskId, blockId) => {
    if (D.running()) return null;
    const t = D.task(taskId); if (!t) return null;
    const date = D.today();
    const n0 = nowMin();
    let b = blockId ? db.get('schedule_blocks', blockId) : D.blocks(date).filter((x) => x.task_id === taskId && x.status === 'planned').sort((p, q) => Math.abs(p.start_min - n0) - Math.abs(q.start_min - n0))[0];
    if (!b) b = D.saveBlock({ date, start_min: Math.floor(nowMin() / 5) * 5, dur: D.predictMin(t), kind: 'task', task_id: taskId, source: 'user' });
    return db.put('work_sessions', { id: uid(), task_id: taskId, block_id: b.id, started_at: new Date().toISOString(), ended_at: null, paused_at: null, paused_ms: 0, memo: '' });
  };
  D.pause = () => { const s = D.running(); if (s && !s.paused_at) db.put('work_sessions', { id: s.id, paused_at: new Date().toISOString() }); };
  D.resume = () => { const s = D.running(); if (s && s.paused_at) db.put('work_sessions', { id: s.id, paused_ms: (s.paused_ms || 0) + (Date.now() - new Date(s.paused_at)), paused_at: null }); };
  D.memo = (text) => { const s = D.running(); if (s) db.put('work_sessions', { id: s.id, memo: text }); };
  D.cancelSession = () => { const s = D.running(); if (s) db.remove('work_sessions', s.id); };
  D.end = (f) => {
    const s = D.running(); if (!s) return null;
    if (s.paused_at) D.resume();
    const s2 = D.running(); const minutes = Math.round(D.elapsedMs(s2) / 60000);
    const endedAt = new Date();
    db.put('work_sessions', { id: s.id, ended_at: endedAt.toISOString(), minutes, status: f.status, focus: f.focus || null, energy: f.energy || null, problem: f.problem || null }, { batch: true });
    if (f.progress || f.remaining || f.next) db.put('handoffs', { id: uid(), task_id: s.task_id, session_id: s.id, progress: f.progress || null, remaining: f.remaining || null, next_step: f.next || null }, { batch: true });
    const tk = D.task(s.task_id);
    if (f.status === '完了' && !(tk && tk.recurring)) db.put('tasks', { id: s.task_id, status: 'done', completed_at: endedAt.toISOString() }, { batch: true });
    const b = db.get('schedule_blocks', s.block_id);
    let proposal = null;
    if (b) {
      db.put('schedule_blocks', { id: b.id, status: 'done', actual_min: minutes }, { batch: true });
      const endMin = nowMin(endedAt), planEnd = b.start_min + b.dur, delta = Math.round((endMin - planEnd) / 5) * 5;
      if (Math.abs(delta) >= 10 && b.date === D.today()) proposal = D.makeShiftProposal(b, delta, endMin);
    }
    let resched = null;
    if (f.status === '継続' && !(tk && tk.recurring) && (!b || b.date === D.today())) resched = D.makeRescheduleProposal(s.task_id, nowMin(endedAt), proposal);
    db.commit();
    return { minutes, proposal, resched };
  };
  D.makeShiftProposal = (b, delta, endMin) => {
    const date = b.date, all = D.blocks(date);
    const fixed = all.filter((x) => x.fixed && x.start_min + x.dur > endMin);
    // 長引いた：後ろの予定（固定以外）をずらす。早く終わった：タスクと休憩だけを前倒しする（食事などの生活の時刻は動かさない）
    const moves = all.filter((x) => x.id !== b.id && !x.fixed && x.status === 'planned' && x.start_min >= b.start_min && x.start_min < Math.max(endMin, b.start_min + b.dur) + 240 && (delta > 0 || x.kind === 'task' || x.kind === 'rest'))
      .map((x) => ({ id: x.id, label: D.blockLabel(x), from: x.start_min, to: Math.max(x.start_min + delta, delta < 0 ? Math.ceil(endMin / 5) * 5 : 0), dur: x.dur }));
    if (!moves.length) return null;
    const conflicts = moves.filter((m) => fixed.some((f) => m.to < f.start_min + f.dur && m.to + m.dur > f.start_min)).map((m) => m.label);
    const task = D.task(b.task_id);
    return db.put('improvement_proposals', { id: uid(), kind: 'schedule', date, status: 'new', source: 'rule',
      text: `「${task ? task.title : D.blockLabel(b)}」が予定より${Math.abs(delta)}分${delta > 0 ? '長くかかりました' : '早く終わりました'}。以降の予定を${Math.abs(delta)}分${delta > 0 ? '後ろ' : '前'}にずらしますか？`,
      basis: `予定の終了 ${fmt(b.start_min + b.dur)} → 実際の終了 ${fmt(endMin)}`, payload: { delta, moves, conflicts, fixed: fixed.map((f) => f.title) } }, { batch: true });
  };
  // 「継続」で終えたタスクを今日の空き時間に入れ直す案（承認後に反映。固定予定は動かさない）
  D.makeRescheduleProposal = (taskId, fromMin, shift) => {
    const t = D.task(taskId); if (!t || t.status === 'done') return null;
    const date = D.today();
    if (D.blocks(date).some((x) => x.task_id === taskId && x.status === 'planned' && x.start_min >= fromMin)) return null; // すでに後で予定あり
    const override = {}; if (shift && shift.payload) (shift.payload.moves || []).forEach((m) => { override[m.id] = m.to; });
    const L = D.predictMin(t), start = D.findSlot(date, L, Math.ceil(fromMin / 5) * 5, override);
    if (start == null) return { none: true };
    return db.put('improvement_proposals', { id: uid(), kind: 'reschedule', date, status: 'new', source: 'rule',
      text: `「${t.title}」の続きを ${fmt(start)}〜${fmt(start + L)}（${dur(L)}）に入れますか？`,
      basis: `「継続」で終了したため、今日の空き時間から提案しています${shift ? '（予定変更の提案を承認した場合の時間割で計算）' : ''}`, payload: { task_id: taskId, start, dur: L } }, { batch: true });
  };
  D.proposalsToday = () => db.all('improvement_proposals').filter((p) => (p.kind === 'schedule' || p.kind === 'reschedule') && p.status === 'new' && p.date === D.today()).sort((a, b) => (a.kind === 'schedule' ? 0 : 1) - (b.kind === 'schedule' ? 0 : 1) || a.updated_at.localeCompare(b.updated_at));
  D.scheduleProposal = () => db.all('improvement_proposals').filter((p) => p.kind === 'schedule' && p.status === 'new' && p.date === D.today()).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] || null;
  D.acceptProposal = (id) => {
    const p = db.get('improvement_proposals', id); if (!p) return;
    if (p.kind === 'reschedule') {
      const { task_id, dur: L } = p.payload; let start = p.payload.start;
      const free = D.freeWindows(p.date, 0).some(([s, e]) => s <= start && start + L <= e);
      if (!free) { start = D.findSlot(p.date, L, Math.ceil(nowMin() / 5) * 5); if (start == null) return { ok: false }; }
      db.put('schedule_blocks', { id: uid(), date: p.date, start_min: start, dur: L, kind: 'task', task_id, fixed: false, status: 'planned', source: 'user' }, { batch: true });
      db.put('improvement_proposals', { id, status: 'accepted', payload: { ...p.payload, start } }, { batch: true }); db.commit();
      return { ok: true, start, moved: start !== p.payload.start };
    }
    (p.payload.moves || []).forEach((m) => { const b = db.get('schedule_blocks', m.id); if (b && !b.fixed && b.status === 'planned') db.put('schedule_blocks', { id: b.id, start_min: m.to }, { batch: true }); });
    db.put('improvement_proposals', { id, status: 'accepted' }, { batch: true }); db.commit();
    return { ok: true };
  };
  D.rejectProposal = (id) => db.put('improvement_proposals', { id, status: 'dismissed' });

  // ---------- 分析 ----------
  D.analysis = (days = 7) => {
    const I = D.idealOrDefault(), today = D.today(), dates = [];
    for (let i = days - 1; i >= 0; i--) dates.push(addDays(today, -i));
    const idealWake = toMin(I.wake_time);
    const habits = D.habits(), meals = habits.filter((h) => h.kind === 'meal'), ex = habits.find((h) => h.kind === 'exercise');
    const sessions = db.all('work_sessions').filter((s) => s.ended_at && dates.includes(logicalDate(new Date(s.started_at))));
    const rows = dates.map((d) => {
      const st = D.state(d) || {}; const ss = sessions.filter((s) => logicalDate(new Date(s.started_at)) === d);
      const fs = ss.map((s) => s.focus).filter(Boolean);
      return { date: d, wake: st.wake_at ? tsMin(st.wake_at, d) : null, sleep: st.sleep_hours ?? null, energy: st.energy ?? null, fulfill: st.fulfill ?? null,
        exercise: ex ? D.habitStatus(d, ex.id) : null, meal: D.mealStatus(d), meals: D.mealStatus(d).known ? D.mealStatus(d).done : null, workMin: ss.reduce((a, s) => a + (s.minutes || 0), 0), focus: avg(fs) };
    });
    const has = (r) => r.wake != null || r.sleep != null || r.energy != null || r.fulfill != null || r.workMin > 0 || r.meal.known > 0 || r.exercise != null;
    const recorded = rows.filter(has);
    const period = (s) => { const h = new Date(s.started_at).getHours(); return h >= 4 && h < 12 ? 'am' : h < 17 && h >= 12 ? 'pm' : 'night'; };
    const focusBy = {}; ['am', 'pm', 'night'].forEach((k) => { const f = sessions.filter((s) => period(s) === k && s.focus).map((s) => s.focus); focusBy[k] = { avg: avg(f), n: f.length }; });
    const planned = sessions.filter((s) => s.block_id).map((s) => { const b = db.raw('schedule_blocks', s.block_id); const d0 = new Date(s.started_at); return { ...s, plan: b ? b.dur : null, planStart: b ? b.start_min : null, startGap: b && b.source !== 'user' ? tsMin(s.started_at, logicalDate(d0)) - b.start_min : null, task: (D.task(s.task_id) || db.raw('tasks', s.task_id) || {}).title, date: logicalDate(new Date(s.started_at)) }; });
    const sum = {
      days, n: recorded.length, rows,
      sleep: avg(rows.map((r) => r.sleep).filter((x) => x != null)), wakeOk: rows.filter((r) => r.wake != null && r.wake - idealWake <= 15).length, wakeN: rows.filter((r) => r.wake != null).length,
      exerciseDays: rows.filter((r) => r.exercise === true).length, exerciseKnown: rows.filter((r) => r.exercise != null).length, energy: avg(rows.map((r) => r.energy).filter((x) => x != null)), fulfill: avg(rows.map((r) => r.fulfill).filter((x) => x != null)),
      workMin: rows.reduce((a, r) => a + r.workMin, 0), focusBy, sessions: planned.sort((a, b) => b.started_at.localeCompare(a.started_at)),
      completed: D.tasks().filter((t) => t.status === 'done' && t.completed_at && dates.includes(logicalDate(new Date(t.completed_at)))).length,
    };
    sum.hypotheses = D.hypotheses(sum, I);
    return sum;
  };
  // 仮説：十分なデータがあるときだけ「傾向」として出す。因果は断定しない
  D.hypotheses = (a, I) => {
    const out = [], rows = a.rows;
    const split = (cond, val) => { const g = rows.filter((r) => cond(r) === true && val(r) != null), b = rows.filter((r) => cond(r) === false && val(r) != null); return { g: avg(g.map(val)), gn: g.length, b: avg(b.map(val)), bn: b.length }; };
    const fa = a.focusBy.am, fp = a.focusBy.pm;
    if (fa.n >= 3 && fp.n >= 3 && Math.abs(fa.avg - fp.avg) >= 0.5) {
      const am = fa.avg > fp.avg;
      out.push({ key: 'focus-time', text: `${am ? '午前' : '午後'}の作業は集中度が高い傾向があります`, basis: `集中度 午前${fa.avg}（${fa.n}回）／午後${fp.avg}（${fp.n}回）`, action: `重要な仕事を${am ? '午前中' : '午後'}に移して1週間試す` });
    }
    const sl = split((r) => (r.sleep == null ? null : r.sleep >= I.sleep_hours), (r) => r.fulfill);
    if (sl.gn >= 3 && sl.bn >= 3 && Math.abs(sl.g - sl.b) >= 0.5) out.push({ key: 'sleep-fulfill', text: `睡眠${I.sleep_hours}時間以上の日は充実度が${sl.g > sl.b ? '高い' : '低い'}傾向があります`, basis: `充実度 ${sl.g}（${sl.gn}日）／${sl.b}（${sl.bn}日）`, action: `就寝準備を30分早めて1週間試す` });
    const exs = split((r) => r.exercise, (r) => r.energy);
    if (exs.gn >= 3 && exs.bn >= 3 && Math.abs(exs.g - exs.b) >= 0.5) out.push({ key: 'exercise-energy', text: `運動した日は元気が${exs.g > exs.b ? '高い' : '低い'}傾向があります`, basis: `元気 ${exs.g}（運動${exs.gn}日）／${exs.b}（${exs.bn}日）`, action: `運動を毎日10分だけでも入れて1週間試す` });
    const pr = a.sessions.filter((s) => s.plan && s.minutes);
    if (pr.length >= 5) { const r = avg(pr.map((s) => s.minutes / s.plan)); if (r >= 1.15 || r <= 0.85) out.push({ key: 'estimate', text: `作業は予定時間の約${r}倍かかる傾向があります`, basis: `直近${pr.length}回の予定と実績`, action: r > 1 ? '予定時間を長めに見積もって1週間試す' : '予定時間を短めに見積もって1週間試す' }); }
    return out;
  };
  D.tip = () => {
    const a = D.analysis(14);
    const run = D.experiments().find((e) => e.status === 'running');
    if (run) return { kind: '実験', text: `実験中：${run.title}`, basis: `${md(run.start_date)}から${run.days}日間。今日は${Math.min(run.days, D.dayIndex(run.start_date) + 1)}日目です。` };
    if (a.hypotheses[0]) return { kind: '提案', text: a.hypotheses[0].action, basis: a.hypotheses[0].text + '（' + a.hypotheses[0].basis + '）' };
    const y = D.state(addDays(D.today(), -1)), I = D.idealOrDefault(), t = D.state();
    const sl = t && t.sleep_hours != null ? t.sleep_hours : null;
    if (sl != null && sl < I.sleep_hours - 1) return { kind: '提案', text: '睡眠が短めです。今日は休憩を予定どおり取りましょう', basis: `記録：睡眠${sl}時間（理想${I.sleep_hours}時間）` };
    if (y && y.fulfill && y.fulfill <= 2) return { kind: '提案', text: '昨日は充実度が低めでした。今日は自由時間を守りましょう', basis: `記録：昨日の充実度 ${y.fulfill}/5` };
    return { kind: 'お知らせ', text: '記録がたまると、ここに改善ポイントを1つ表示します', basis: `分析には同じ条件の記録が3日分以上必要です（現在${a.n}日分）` };
  };

  // ---------- 改善実験 ----------
  D.experiments = () => db.all('experiments').sort((a, b) => b.start_date.localeCompare(a.start_date));
  D.dayIndex = (start) => { const [y, m, d] = start.split('-').map(Number), [y2, m2, d2] = D.today().split('-').map(Number); return Math.round((new Date(y2, m2 - 1, d2) - new Date(y, m - 1, d)) / 864e5); };
  D.startExperiment = (h) => {
    const p = db.put('improvement_proposals', { id: uid(), kind: 'improvement', status: 'accepted', source: 'rule', text: h.action, basis: h.text + '（' + h.basis + '）', date: D.today() }, { batch: true });
    db.put('experiments', { id: uid(), proposal_id: p.id, title: h.action, change: h.action, start_date: D.today(), days: 7, status: 'running' }, { batch: true });
    db.commit();
  };
  D.metricsBetween = (from, days) => {
    const rows = []; for (let i = 0; i < days; i++) { const d = addDays(from, i); const st = D.state(d) || {}; const ss = db.all('work_sessions').filter((s) => s.ended_at && logicalDate(new Date(s.started_at)) === d); rows.push({ fulfill: st.fulfill, energy: st.energy, sleep: st.sleep_hours, focus: avg(ss.map((s) => s.focus).filter(Boolean)), work: ss.reduce((a, s) => a + (s.minutes || 0), 0) }); }
    const pick = (k) => avg(rows.map((r) => r[k]).filter((x) => x != null && x !== 0 || k === 'work'));
    return { fulfill: pick('fulfill'), energy: pick('energy'), sleep: pick('sleep'), focus: pick('focus'), workPerDay: Math.round(rows.reduce((a, r) => a + r.work, 0) / days) };
  };
  D.evaluate = (id) => {
    const e = db.get('experiments', id); if (!e) return null;
    const during = D.metricsBetween(e.start_date, Math.min(e.days, D.dayIndex(e.start_date) + 1)), before = D.metricsBetween(addDays(e.start_date, -7), 7);
    const lab = { focus: '集中度', fulfill: '充実度', energy: '元気', sleep: '睡眠' };
    const parts = Object.keys(lab).map((k) => (during[k] != null && before[k] != null ? `${lab[k]} ${before[k]}→${during[k]}` : null)).filter(Boolean);
    const summary = parts.length ? parts.join('、') + `。作業 ${dur(before.workPerDay)}/日→${dur(during.workPerDay)}/日。記録の比較であり、変化の原因とは断定できません。` : '比較できる記録が足りません。';
    return db.put('experiment_results', { id: uid(), experiment_id: id, metrics: { before, during }, summary });
  };
  D.result = (expId) => db.all('experiment_results').filter((r) => r.experiment_id === expId).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] || null;
  D.decide = (id, decision) => db.put('experiments', { id, status: 'ended', decision });

  // ---------- 成長・新しい挑戦 ----------
  D.stability = () => {
    const a = D.analysis(14), I = D.idealOrDefault();
    const ok = a.n >= 10 && a.wakeN >= 7 && a.wakeOk / a.wakeN >= 0.7 && (a.fulfill || 0) >= 3.5 && (a.sleep || 0) >= I.sleep_hours - 0.5;
    return { ok, a, reason: a.n < 10 ? `記録が14日中${a.n}日分です（10日分以上で判断します）` : `起床達成 ${a.wakeOk}/${a.wakeN}日・充実度 ${a.fulfill ?? '−'}・睡眠 ${a.sleep ?? '−'}時間` };
  };
  D.challenges = () => {
    const I = D.idealOrDefault();
    return [...(I.goals || []).filter(Boolean).map((g) => `目標「${g}」に週2回15分取り組む`), '新しい学習を週2回15分', '散歩やストレッチを10分', '趣味の時間を週1回1時間', '寝る前に10分の読書'].slice(0, 5);
  };

  // ---------- Claude Codeで相談するための記録の書き出し ----------
  // 記録された事実だけを並べる（推測や補完はしない）。自由記述を含めるかは本人が選ぶ
  D.consultText = (days = 14, free = true) => {
    const I = D.idealOrDefault(), a = D.analysis(days), today = D.today(), hm = (m) => (m == null ? '−' : fmt(m));
    const L = [];
    L.push(`# 生活管理アプリ「冒険の書」の記録（${md(addDays(today, -(days - 1)))}〜${md(today)}、${days}日間）`);
    L.push('以下はアプリに記録された事実です。記録がない項目は「−」で、推測で埋めていません。');
    L.push('', '## 理想の生活', `- 起床 ${I.wake_time} ／ 就寝 ${I.bed_time} ／ 睡眠 ${I.sleep_hours}時間`, `- 食事：${(I.meals || []).map((m) => `${m.name} ${m.time}`).join('、')}`,
      `- 運動 ${I.exercise_time || '−'}から${I.exercise_min || 0}分 ／ 自由時間 ${I.free_time || '−'}から${I.free_min || 0}分`, `- 作業できる時間 ${I.work_start || '−'}〜${I.work_end || '−'} ／ 集中しやすい時間帯：${{ am: '午前', pm: '午後', night: '夜' }[I.focus_period] || '−'}`);
    if ((I.goals || []).length) L.push(`- 目標：${I.goals.join('／')}`);
    if ((I.priorities || []).length) L.push(`- 大切にしたいこと：${I.priorities.join('／')}`);
    const fx = db.all('recurring_events').filter((e) => e.active !== false);
    if (fx.length) L.push(`- 毎週の固定予定：${fx.map((e) => `${e.title}（${(e.weekdays || []).map((d) => '日月火水木金土'[d]).join('')} ${fmt(e.start_min)}〜${fmt(e.start_min + e.dur)}）`).join('、')}`);
    L.push('', '## 日々の記録', '（「−」は未記録。食事は食べた数で、「未2」は2食分が未記録。運動は ◯＝した、×＝しなかった）', '| 日付 | 起床 | 睡眠 | 食事 | 運動 | 元気 | 充実度 | 作業時間 | 集中度 |' + (free ? ' ひとこと |' : ''), '|---|---|---|---|---|---|---|---|---|' + (free ? '---|' : ''));
    a.rows.forEach((r) => { const st = D.state(r.date) || {}; L.push(`| ${md(r.date)} | ${hm(r.wake)} | ${r.sleep ?? '−'} | ${D.mealText(r.meal)} | ${r.exercise === true ? '◯' : r.exercise === false ? '×' : '−'} | ${r.energy ?? '−'} | ${r.fulfill ?? '−'} | ${r.workMin ? dur(r.workMin) : '−'} | ${r.focus ?? '−'} |` + (free ? ` ${(st.note || '−').replace(/[|\n]/g, ' ')} |` : '')); });
    const custom = D.habits().filter((h) => h.kind === 'custom');
    if (custom.length) { L.push('', '## 独自の習慣（実施した日数）'); custom.forEach((h) => { const st = a.rows.map((r) => D.habitStatus(r.date, h.id)); L.push(`- ${h.name}：した ${st.filter((x) => x === true).length}日／しなかった ${st.filter((x) => x === false).length}日／未記録 ${st.filter((x) => x === null).length}日`); }); }
    L.push('', '## 未完了のタスク');
    const open = D.openTasks();
    if (!open.length) L.push('- なし');
    open.forEach((t) => { const h = D.handoff(t.id), p = D.project(t.project_id); L.push(`- ${t.title}${p ? `（${p.name}）` : ''}：予定${t.estimate_min}分／実績${D.workedMin(t.id)}分・${D.sessionsOf(t.id).length}回${t.due_date ? `／締切${md(t.due_date)}` : ''}${t.priority === 1 ? '／優先' : ''}` + (free && h && h.next_step ? `／次：${h.next_step}` : '')); });
    const rt = D.recurringTasks(); if (rt.length) L.push('', '## 定例の作業（週の型）', ...rt.map((t) => `- ${t.title}：実績${D.workedMin(t.id)}分・${D.sessionsOf(t.id).length}回`));
    L.push('', '## 作業セッション（新しい順、最大30件。開始のずれ＝実際の開始−予定の開始）');
    if (!a.sessions.length) L.push('- なし');
    a.sessions.slice(0, 30).forEach((x) => { const d = new Date(x.started_at); L.push(`- ${md(x.date)} ${fmt(d.getHours() * 60 + d.getMinutes())}〜 ${x.task || ''}：予定${x.planStart != null ? fmt(x.planStart) + '〜' : ''}${x.plan ?? '−'}分／実績${x.minutes}分${x.startGap != null ? `／開始のずれ${x.startGap > 0 ? '+' : ''}${x.startGap}分` : ''}／${x.status || '−'}／集中${x.focus ?? '−'}／体調${x.energy ?? '−'}` + (free && x.problem ? `／問題：${x.problem}` : '')); });
    L.push('', '## 集計', `- 平均睡眠 ${a.sleep ?? '−'}時間、理想どおりの起床 ${a.wakeOk}/${a.wakeN}日、運動 ${a.exerciseDays}日（記録 ${a.exerciseKnown}日中）、平均充実度 ${a.fulfill ?? '−'}、作業 ${dur(a.workMin)}、完了タスク ${a.completed}件`,
      `- 時間帯別の集中度：午前 ${a.focusBy.am.avg ?? '−'}（${a.focusBy.am.n}回）／午後 ${a.focusBy.pm.avg ?? '−'}（${a.focusBy.pm.n}回）／夜 ${a.focusBy.night.avg ?? '−'}（${a.focusBy.night.n}回）`);
    const ex = D.experiments(); if (ex.length) { L.push('', '## 改善実験'); ex.forEach((e) => { const r = D.result(e.id); L.push(`- ${e.title}（${md(e.start_date)}から${e.days}日・${e.status === 'running' ? '実施中' : e.decision || '終了'}）${r ? '：' + r.summary : ''}`); }); }
    L.push('', '## お願い', '- 上の記録（事実）と、あなたの推測・提案を分けて書いてください。', '- 記録が少ない点は断定せず、「傾向」「仮説」として扱ってください。', '- 予定や習慣の変更は提案にとどめてください（反映するかは私が決めます）。');
    return L.join('\n');
  };

  // ---------- AI相談（接続前） ----------
  D.ask = (q) => {
    db.put('ai_messages', { id: uid(), role: 'user', content: q, context: {} }, { batch: true });
    db.put('ai_messages', { id: uid(), role: 'system', content: 'AI相談はまだ接続していません（本体の完成後に接続します）。相談内容は保存しました。', context: {} }, { batch: true });
    db.commit();
  };
  D.messages = () => db.all('ai_messages').sort((a, b) => a.updated_at.localeCompare(b.updated_at));

  return D;
}
