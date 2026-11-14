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
      db.all('recurring_events').forEach((e) => { if (!keep.has(e.id)) db.remove('recurring_events', e.id, { batch: true }); });
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
  D.toggleHabit = (hid, date = D.today()) => { const l = D.habitLog(date, hid); if (l) db.remove('habit_logs', l.id); else db.put('habit_logs', { id: uid(), date, habit_id: hid, done: true, at: new Date().toISOString() }); };
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
  D.openTasks = () => D.tasks().filter((t) => t.status !== 'done').sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999') || a.priority - b.priority || a.sort - b.sort);
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
    if (db.all('schedule_blocks').some((b) => b.date === date) || Object.values(db.data.schedule_blocks).some((b) => b.date === date)) return false;
    D.generate(date); return true;
  };
  D.generate = (date) => {
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
  // 空き時間にタスクを入れる（集中しやすい時間帯を優先）
  D.placeTasks = (date, fromMin, keyFn) => {
    const I = D.idealOrDefault();
    const lo = Math.max(toMin(I.work_start) ?? toMin(I.wake_time) + 60, fromMin ?? 0), hi = toMin(I.work_end) ?? (toMin(I.bed_time) - 120);
    const busy = D.blocks(date).map((b) => [b.start_min, b.start_min + b.dur]).sort((a, b) => a[0] - b[0]);
    const scheduled = new Set(D.blocks(date).filter((b) => b.kind === 'task').map((b) => b.task_id));
    let wins = []; let cur = lo;
    busy.forEach(([s, e]) => { if (s > cur) wins.push([cur, Math.min(s, hi)]); cur = Math.max(cur, e); });
    if (cur < hi) wins.push([cur, hi]);
    wins = wins.filter(([s, e]) => e - s >= 15).map(([s, e]) => [Math.ceil(s / 5) * 5, e]);
    const pref = { am: (w) => w[0], pm: (w) => (w[0] >= 720 ? w[0] - 2000 : w[0]), night: (w) => (w[0] >= 1020 ? w[0] - 3000 : w[0]) }[I.focus_period] || ((w) => w[0]);
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
    let b = blockId ? db.get('schedule_blocks', blockId) : D.blocks(date).find((x) => x.task_id === taskId && x.status === 'planned');
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
    if (f.status === '完了') db.put('tasks', { id: s.task_id, status: 'done', completed_at: endedAt.toISOString() }, { batch: true });
    const b = db.get('schedule_blocks', s.block_id);
    let proposal = null;
    if (b) {
      db.put('schedule_blocks', { id: b.id, status: 'done', actual_min: minutes }, { batch: true });
      const endMin = nowMin(endedAt), planEnd = b.start_min + b.dur, delta = Math.round((endMin - planEnd) / 5) * 5;
      if (Math.abs(delta) >= 10 && b.date === D.today()) proposal = D.makeShiftProposal(b, delta, endMin);
    }
    db.commit();
    return { minutes, proposal };
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
  D.scheduleProposal = () => db.all('improvement_proposals').filter((p) => p.kind === 'schedule' && p.status === 'new' && p.date === D.today()).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] || null;
  D.acceptProposal = (id) => {
    const p = db.get('improvement_proposals', id); if (!p) return;
    (p.payload.moves || []).forEach((m) => { const b = db.get('schedule_blocks', m.id); if (b && !b.fixed && b.status === 'planned') db.put('schedule_blocks', { id: b.id, start_min: m.to }, { batch: true }); });
    db.put('improvement_proposals', { id, status: 'accepted' }, { batch: true }); db.commit();
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
        exercise: ex ? !!D.habitLog(d, ex.id) : null, meals: meals.filter((m) => D.habitLog(d, m.id)).length, workMin: ss.reduce((a, s) => a + (s.minutes || 0), 0), focus: avg(fs) };
    });
    const has = (r) => r.wake != null || r.sleep != null || r.energy != null || r.fulfill != null || r.workMin > 0 || r.meals > 0 || r.exercise;
    const recorded = rows.filter(has);
    const period = (s) => { const h = new Date(s.started_at).getHours(); return h >= 4 && h < 12 ? 'am' : h < 17 && h >= 12 ? 'pm' : 'night'; };
    const focusBy = {}; ['am', 'pm', 'night'].forEach((k) => { const f = sessions.filter((s) => period(s) === k && s.focus).map((s) => s.focus); focusBy[k] = { avg: avg(f), n: f.length }; });
    const planned = sessions.filter((s) => s.block_id).map((s) => { const b = db.raw('schedule_blocks', s.block_id); return { ...s, plan: b ? b.dur : null, task: (D.task(s.task_id) || db.raw('tasks', s.task_id) || {}).title, date: logicalDate(new Date(s.started_at)) }; });
    const sum = {
      days, n: recorded.length, rows,
      sleep: avg(rows.map((r) => r.sleep).filter((x) => x != null)), wakeOk: rows.filter((r) => r.wake != null && r.wake - idealWake <= 15).length, wakeN: rows.filter((r) => r.wake != null).length,
      exerciseDays: rows.filter((r) => r.exercise).length, energy: avg(rows.map((r) => r.energy).filter((x) => x != null)), fulfill: avg(rows.map((r) => r.fulfill).filter((x) => x != null)),
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

  // ---------- AI相談（接続前） ----------
  D.ask = (q) => {
    db.put('ai_messages', { id: uid(), role: 'user', content: q, context: {} }, { batch: true });
    db.put('ai_messages', { id: uid(), role: 'system', content: 'AI相談はまだ接続していません（本体の完成後に接続します）。相談内容は保存しました。', context: {} }, { batch: true });
    db.commit();
  };
  D.messages = () => db.all('ai_messages').sort((a, b) => a.updated_at.localeCompare(b.updated_at));

  return D;
}
