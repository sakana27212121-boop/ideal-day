// 画面の描画（HTML文字列を返すだけ。操作は app.js が data-act で受け取る）
import { esc as E, fmt, dur, md, WD, toMin, logicalDate, addDays } from './util.js';

// 呼び名：ゲーム風は主要部分だけ。設定でふつうの呼び名に切り替えられる。新しい項目はふつうの名称で追加する
const TERMS = {
  status: ['ステータス', '今日の状態'], next: ['つぎのクエスト', '次にやること'], none: ['今日のクエストはすべて終わりました', '今日のタスクはすべて終わりました'],
  save: ['前回のセーブ地点', '前回の引き継ぎ'], first: ['はじめてのクエスト。前回の記録はありません', '初めてのタスクです。前回の記録はありません'],
  start: ['クエスト開始', '開始する'], route: ['きょうの旅程', '今日の時間割'], hint: ['きょうのヒント', '今日の改善ポイント'],
  list: ['クエスト一覧', 'タスク一覧'], add: ['新しいクエスト', '新しいタスク'], sage: ['賢者', 'AI'], startChk: ['クエスト開始前の確認', '開始前の確認'],
  saveTitle: ['ぼうけんをセーブ', '作業の記録'], saveBtn: ['セーブする', '記録する'], doing: ['クエスト中', '作業中'], log: ['冒険の記録', '分析・成長'],
};
let game = true;
export const setTerms = (mode) => { game = mode !== 'plain'; };
export const T = (k) => TERMS[k][game ? 0 : 1];
export const isGame = () => game;

const KC = { fixed: 'var(--hp)', task: 'var(--gold)', meal: 'var(--food)', rest: 'var(--mp)', exercise: 'var(--grass)', habit: 'var(--violet)', free: 'var(--pink)', buffer: '#5d6f68' };
export const KIND = { task: 'タスク', fixed: '固定予定', meal: '食事', rest: '休憩', exercise: '運動', habit: '生活', free: '自由時間', buffer: '余白' };
const NAV = [['home', 'ホーム', '野営地'], ['habits', '生活習慣', 'ステータス'], ['tasks', 'タスク', 'クエスト'], ['growth', '分析', '冒険の記録'], ['ai', 'AI相談', '賢者']];

// オリジナルのドット絵（旅人）
const SPRITE = ['....hhhh....', '...hhhhhh...', '...hssssh...', '...sesses...', '...ssssss...', '....ssss....', '..ccbbbbcc..', '.ccbbbbbbcc.', '.ssbbbbbbss.', '...bbbbbb...', '...pp..pp...', '..ddd..ddd..'];
const PAL = { h: '#7a4a2a', s: '#f2c79a', e: '#1a1a1a', c: '#3c7a3c', b: '#4f9a4f', p: '#3b3f6b', d: '#5a3a24' };
let spriteURL = '';
export function sprite() {
  if (spriteURL) return spriteURL;
  try { const c = document.createElement('canvas'); c.width = c.height = 12; const x = c.getContext('2d'); SPRITE.forEach((r, y) => [...r].forEach((ch, i) => { if (PAL[ch]) { x.fillStyle = PAL[ch]; x.fillRect(i, y, 1, 1); } })); spriteURL = c.toDataURL(); } catch (e) { /* 描けない環境では空 */ }
  return spriteURL;
}

export function syncBadge(db) {
  const s = db.status, t = s.at ? `${String(s.at.getHours()).padStart(2, '0')}:${String(s.at.getMinutes()).padStart(2, '0')}` : '';
  const txt = { local: 'この端末のみ', idle: '同期待ち', syncing: '同期中…', ok: '同期済み ' + t, offline: 'オフライン（あとで同期）', error: '同期できません（あとで再試行）' }[s.state] || '';
  return `<span class="sync ${s.state}" title="${E(s.error || '')}"><i></i>${txt}</span>`;
}

export function nav(V, db) {
  return `<nav class="cmd" aria-label="画面切替">${NAV.map(([k, a, b]) => `<button data-act="tab" data-v="${k}" ${V.tab === k ? 'aria-current="page"' : ''}><span class="n">${a}</span>${game ? `<span class="k">${b}</span>` : ''}</button>`).join('')}
    <div class="side-only" style="padding:10px 10px 2px">${syncBadge(db)}</div></nav>`;
}

// ---------------- ホーム ----------------
function statusWin(D, cls = '') {
  const I = D.idealOrDefault(), st = D.state() || {}, habits = D.habits(), today = D.today();
  const exp = D.db.all('work_sessions').reduce((a, s) => a + (s.minutes || 0), 0), lv = 1 + Math.floor(exp / 300);
  const meals = habits.filter((h) => h.kind === 'meal'), ms = D.mealStatus(today), mealsDone = ms.done;
  const ex = habits.find((h) => h.kind === 'exercise'), exSt = ex ? D.habitStatus(today, ex.id) : null, exDone = exSt === true;
  // 習慣ボタン：未記録 → した（緑）→ しなかった（×）→ 未記録
  const hb = (h) => { const st = D.habitStatus(today, h.id); return `<button class="btn ${st === true ? 'on' : st === false ? 'off' : ''}" data-act="habit" data-id="${h.id}" aria-label="${E(h.name)}：${st === true ? 'した' : st === false ? 'しなかった' : '未記録'}（押すと切り替え）">${E(h.name)}${st === true ? ' ✓' : st === false ? ' ×' : ''}</button>`; };
  const bar = (n, c, v, max, txt) => `<div class="bar"><span>${n}</span><div class="meter" role="img" aria-label="${n} ${txt}"><i style="--c:${c};width:${Math.max(0, Math.min(100, (v / max) * 100))}%"></i></div><b>${txt}</b></div>`;
  const wake = st.wake_at ? new Date(st.wake_at) : null, bed = st.bed_at ? new Date(st.bed_at) : null;
  const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const custom = habits.filter((h) => h.kind === 'custom');
  return `<section class="win stat ${cls}"><span class="tag">${T('status')}</span>
    <div class="hero"><img class="sprite" src="${sprite()}" alt="あなたの旅人">
      <div><div><span class="lv">Lv ${lv}</span> <span class="meta">作業経験 ${dur(exp)}</span></div>
      <div class="bars">
        ${bar('睡眠', 'var(--hp)', st.sleep_hours || 0, I.sleep_hours, st.sleep_hours != null ? st.sleep_hours + '/' + I.sleep_hours + 'h' : '未記録')}
        ${bar('元気', 'var(--mp)', st.energy || 0, 5, st.energy ? st.energy + '/5' : '未記録')}
        ${bar('食事', 'var(--food)', mealsDone, Math.max(1, meals.length), ms.known ? D.mealText(ms) : '未記録')}
        ${bar('運動', 'var(--grass)', exDone ? 1 : 0, 1, exSt === true ? '済' : exSt === false ? 'なし' : '未記録')}
      </div></div></div>
    <div class="quick">
      <button class="btn ${wake ? 'on' : ''}" data-act="${wake ? 'undoWake' : 'wake'}" aria-pressed="${!!wake}">${wake ? '起床 ' + hm(wake) : '起きた'}</button>
      ${meals.map(hb).join('')}${ex ? hb(ex) : ''}${custom.map(hb).join('')}
      <button class="btn" data-act="rest">休憩した${st.rest_count ? '（' + st.rest_count + '）' : ''}</button>
      <button class="btn ${bed ? 'on' : ''}" data-act="${bed ? 'undoBed' : 'bed'}" aria-pressed="${!!bed}">${bed ? '就寝 ' + hm(bed) : '寝る'}</button>
    </div>
    ${st.wake_at && st.sleep_hours == null ? `<p class="meta read" style="margin:10px 0 0">睡眠時間：前日の「寝る」が未記録のため計算できません。<button class="btn small ghost" data-act="sheet" data-v="sleep">入力する</button></p>` : ''}
  </section>`;
}

function questWin(D) {
  const n = D.nextAction();
  if (n.mode === 'none') return D.tasks().length
    ? `<section class="win quest"><span class="tag">${T('next')}</span><h2>${T('none')}</h2><p class="meta read">自由時間を楽しみましょう。</p><div class="row start"><button class="btn" data-act="sheet" data-v="task">＋ ${T('add')}</button></div></section>`
    : `<section class="win quest"><span class="tag">${T('next')}</span><h2>${game ? 'まだクエストがありません' : 'まだタスクがありません'}</h2><p class="meta read">取り組みたい仕事を登録すると、空き時間に入れて「次にやること」を表示します。</p><div class="row start"><button class="btn go" data-act="sheet" data-v="task">＋ ${T('add')}</button></div></section>`;
  const t = n.task, b = n.block, h = D.handoff(t.id), proj = D.project(t.project_id);
  const when = b ? `${fmt(b.start_min)} 開始予定 ／ ${dur(b.dur)}` : '時間割には入っていません';
  return `<section class="win quest" aria-label="NEXT ACTION"><span class="tag">${T('next')} ─ NEXT ACTION</span>
    <div class="meta">${when}${proj ? ' ／ ' + E(proj.name) : ''}${n.late ? ' <span class="late">（予定時刻を過ぎています）</span>' : ''}</div>
    <h2>${E(t.title)}</h2>
    <div class="goal">今回：${E(t.goal || '未設定')}</div>
    ${h ? `<div class="save"><p class="meta">${T('save')}</p>${h.progress ? `<p>${E(h.progress)}</p>` : ''}${h.next_step ? `<p class="next">${E(h.next_step)}</p>` : ''}</div>` : `<div class="save"><p class="meta">${T('first')}</p></div>`}
    <div class="row start"><button class="btn go" data-act="open-start" data-id="${t.id}" data-block="${b ? b.id : ''}">▶ ${n.mode === 'resume' ? '続きから再開' : T('start')}</button></div>
  </section>`;
}

export function routeWin(D, opts = {}) {
  const tl = D.timeline();
  return `<section class="win full"><span class="tag">${T('route')}</span>
    ${tl.length ? `<ol class="route">${tl.map((b) => `<li class="${b.state}" style="--c:${KC[b.kind] || '#5d6f68'}"><span class="t">${fmt(b.start_min)}</span><span class="node"></span>
      <button class="lbl" data-act="sheet" data-v="block" data-id="${b.id}" aria-label="${E(b.label)}（${fmt(b.start_min)}から${dur(b.dur)}）を編集">${E(b.label)}${b.fixed ? '<span class="fixed">固定</span>' : ''}<span class="dur">${dur(b.dur)}</span></button>
      ${!b.fixed && b.status === 'planned' && b.state !== 'active' ? `<span class="mv"><button data-act="shift" data-id="${b.id}" data-n="-15" aria-label="${E(b.label)}を15分早める">−15</button><button data-act="shift" data-id="${b.id}" data-n="15" aria-label="${E(b.label)}を15分遅らせる">+15</button></span>` : '<span></span>'}</li>`).join('')}</ol>`
    : `<p class="meta read">今日の予定はまだありません。</p>`}
    <div class="row"><button class="btn small ghost" data-act="replan">空き時間にタスクを入れ直す</button><button class="btn small" data-act="sheet" data-v="block">予定を追加</button></div>
  </section>`;
}

function tipWin(D) { const t = D.tip(); return `<section class="win tip"><span class="tag">${T('hint')}</span><p><span class="label ${t.kind === '実験' ? 'exp' : 'ai'}">${t.kind}</span>${E(t.text)}</p><p class="meta read">${E(t.basis)}</p></section>`; }

function proposalWin(D) {
  return D.proposalsToday().map((p) => {
    const pl = p.payload || {};
    if (p.kind === 'reschedule') return `<section class="win propose full" role="alert"><span class="tag blue">続きの再配置の提案</span>
      <p><span class="label ai">提案</span>${E(p.text)}</p><p class="meta read">${E(p.basis || '')}。固定予定は動かしません。</p>
      <div class="row"><button class="btn ghost" data-act="rejectProposal" data-id="${p.id}">入れない</button><button class="btn go" data-act="acceptProposal" data-id="${p.id}">時間割に入れる</button></div></section>`;
    return `<section class="win propose full" role="alert"><span class="tag blue">予定変更の提案</span>
    <p><span class="label ai">提案</span>${E(p.text)}</p>
    <ul>${(pl.moves || []).map((m) => `<li>${E(m.label)}：${fmt(m.from)} → ${fmt(m.to)}</li>`).join('')}</ul>
    ${pl.fixed && pl.fixed.length ? `<p class="meta">固定予定（${pl.fixed.map(E).join('、')}）は動かしません。</p>` : ''}
    ${pl.conflicts && pl.conflicts.length ? `<p class="bad">固定予定と重なります：${pl.conflicts.map(E).join('、')}</p>` : ''}
    <div class="row"><button class="btn ghost" data-act="rejectProposal" data-id="${p.id}">このままにする</button><button class="btn go" data-act="acceptProposal" data-id="${p.id}">ずらす</button></div></section>`;
  }).join('');
}

export function home(D) { return `<div class="grid home">${proposalWin(D)}${questWin(D)}${statusWin(D)}${tipWin(D)}${routeWin(D)}</div>`; }

// ---------------- 生活習慣 ----------------
export function habits(D) {
  const st = D.state() || {}, I = D.idealOrDefault(), a = D.analysis(7), hs = D.habits();
  const scale = (name, field, cur) => `<div><div class="meta">${name}</div><div class="dots" style="margin:4px 0 12px">${[1, 2, 3, 4, 5].map((n) => `<button class="btn ${cur === n ? 'on' : ''}" data-act="scale" data-f="${field}" data-n="${n}" aria-pressed="${cur === n}">${n}</button>`).join('')}</div></div>`;
  const idealWake = toMin(I.wake_time);
  return `<div class="grid">${statusWin(D)}
    <section class="win"><span class="tag">きょうの調子</span>${scale('元気・体調（1〜5）', 'energy', st.energy)}${scale('1日の充実度（1〜5）', 'fulfill', st.fulfill)}
      <label class="fld"><span>ひとこと（任意）</span><input id="f-note" value="${E(st.note || '')}" placeholder="例：午後は眠かった"></label><div class="row"><button class="btn small" data-act="saveNote">保存</button></div></section>
    <section class="win"><span class="tag">理想と実績（直近7日）</span><div class="scroll"><table class="wide">
      <tr><th>日付</th><th>起床</th><th>睡眠</th><th>食事</th><th>運動</th><th>元気</th><th>充実</th></tr>
      ${a.rows.map((r) => `<tr><td>${md(r.date)}</td><td class="${r.wake == null ? '' : r.wake - idealWake <= 15 ? 'good' : 'bad'}">${r.wake == null ? '−' : fmt(r.wake)}</td><td class="${r.sleep == null ? '' : r.sleep >= I.sleep_hours ? 'good' : ''}">${r.sleep == null ? '−' : r.sleep + 'h'}</td><td>${D.mealText(r.meal)}</td><td>${r.exercise === true ? '◯' : r.exercise === false ? '×' : '−'}</td><td>${r.energy ?? '−'}</td><td>${r.fulfill ?? '−'}</td></tr>`).join('')}
      <tr><th>理想</th><th>${E(I.wake_time)}</th><th>${I.sleep_hours}h</th><th>${(I.meals || []).length}</th><th>${I.exercise_min ? '毎日' : '−'}</th><th></th><th></th></tr></table></div>
      <p class="meta read" style="margin:8px 0 4px">「−」は未記録。食事の「未2」は2食分が未記録、運動の × はしなかった日です。習慣のボタンは押すたびに「した → しなかった → 未記録」と切り替わります。</p>
      <p class="meta read" style="margin:0">起床の達成 ${a.wakeOk}/${a.wakeN}日 ・ 運動 ${a.exerciseDays}日（記録${a.exerciseKnown}日中） ・ 平均睡眠 ${a.sleep ?? '−'}時間（<span class="label rec">記録</span>）</p></section>
    <section class="win"><span class="tag">習慣の項目</span>
      ${hs.map((h) => `<div class="item"><div class="head"><span>${E(h.name)} <span class="meta">${E(h.target || '')}</span></span>${h.kind === 'custom' ? `<button class="btn small ghost" data-act="hideHabit" data-id="${h.id}">外す</button>` : ''}</div></div>`).join('')}
      <div class="row start" style="align-items:end"><label class="fld" style="flex:1;min-width:160px;margin:0"><span>習慣を追加（ふつうの名前で）</span><input id="f-habit" placeholder="例：ストレッチ"></label><button class="btn" data-act="addHabit">追加</button></div></section>
    <section class="win"><span class="tag">設定</span>
      <div class="row start"><button class="btn" data-act="tab" data-v="setup">理想の生活・固定予定を設定</button><button class="btn ghost" data-act="terms">呼び名：${game ? '冒険' : 'ふつう'}（切替）</button></div></section>
  </div>`;
}

// ---------------- タスク ----------------
export function tasks(D) {
  const open = D.openTasks(), done = D.tasks().filter((t) => t.status === 'done').sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || '')).slice(0, 10), running = D.running();
  const row = (t) => { const h = D.handoff(t.id), p = D.project(t.project_id), s = D.sessionsOf(t.id);
    return `<div class="item"><div class="head"><span>${t.status === 'done' ? '✓ ' : ''}${E(t.title)} ${p ? `<span class="meta">${E(p.name)}</span>` : ''}${t.due_date ? ` <span class="meta">締切 ${md(t.due_date)}</span>` : ''}${t.priority === 1 ? ' <span class="label ai" style="color:var(--hp)">優先</span>' : ''}</span>
      <span class="meta">予定 ${dur(t.estimate_min)} ／ 実績 ${dur(D.workedMin(t.id))}（${s.length}回）</span></div>
      ${h && h.next_step ? `<div class="meta read">次：${E(h.next_step)}</div>` : ''}
      <div class="row start">${t.status !== 'done' && !running ? `<button class="btn small" data-act="open-start" data-id="${t.id}">${s.length ? '再開' : '開始'}</button>` : ''}<button class="btn small ghost" data-act="sheet" data-v="task" data-id="${t.id}">詳細・編集</button></div></div>`; };
  const rec = D.recurringTasks();
  const recWin = rec.length ? `<section class="win"><span class="tag">定例の作業（週の型）</span><p class="meta read" style="margin-top:0">時間割の作業枠と結びついた作業です。「完了」にしても次の枠に残ります。</p>
    ${rec.map((t) => { const h = D.handoff(t.id); return `<div class="item"><div class="head"><span>${E(t.title)}</span><span class="meta">実績 ${dur(D.workedMin(t.id))}（${D.sessionsOf(t.id).length}回）</span></div>${h && h.next_step ? `<div class="meta read">次：${E(h.next_step)}</div>` : ''}<div class="row start">${!running ? `<button class="btn small" data-act="open-start" data-id="${t.id}">開始</button>` : ''}</div></div>`; }).join('')}</section>` : '';
  return `<div class="grid two">${recWin}<section class="win"><span class="tag">${T('list')}</span>
      ${open.length ? open.map(row).join('') : '<p class="meta read">未完了のタスクはありません。</p>'}
      <div class="row start"><button class="btn go" data-act="sheet" data-v="task">＋ ${T('add')}</button></div>
      ${done.length ? `<details style="margin-top:12px"><summary class="meta">完了したタスク（最近10件）</summary>${done.map(row).join('')}</details>` : ''}</section>
    ${routeWin(D)}</div>`;
}

// ---------------- 分析・成長 ----------------
export function growth(D, V) {
  const days = V.period || 7, a = D.analysis(days), I = D.idealOrDefault();
  const spark = (k, max, c) => `<div class="spark" role="img" aria-label="${k}の推移">${a.rows.map((r) => (r[k] == null ? `<i class="none" title="${md(r.date)} 記録なし"></i>` : `<i style="--c:${c};height:${Math.max(4, (r[k] / max) * 100)}%" title="${md(r.date)} ${r[k]}"></i>`)).join('')}</div>`;
  const exps = D.experiments(), st = D.stability();
  const fb = a.focusBy;
  return `<div class="grid">
    <div class="seg" role="group" aria-label="期間">${[[7, '7日'], [28, '4週間'], [90, '90日']].map(([n, l]) => `<button class="btn small ${days === n ? '' : 'ghost'}" data-act="period" data-n="${n}" aria-pressed="${days === n}">${l}</button>`).join('')}</div>
    <section class="win"><span class="tag">現状（${days}日・<span style="color:var(--grass)">記録</span>）</span>
      <div class="stat-grid"><div><span class="meta">記録した日</span><b>${a.n}日</b></div><div><span class="meta">平均睡眠</span><b>${a.sleep != null ? a.sleep + 'h' : '−'}</b></div><div><span class="meta">起床達成</span><b>${a.wakeOk}/${a.wakeN}</b></div><div><span class="meta">運動</span><b>${a.exerciseDays}日</b></div><div><span class="meta">作業時間</span><b>${dur(a.workMin)}</b></div><div><span class="meta">完了タスク</span><b>${a.completed}</b></div></div>
      <div class="two grid" style="gap:12px;margin-top:12px"><div><div class="meta">充実度（平均 ${a.fulfill ?? '−'}）</div>${spark('fulfill', 5, 'var(--gold)')}</div><div><div class="meta">睡眠時間（理想 ${I.sleep_hours}h）</div>${spark('sleep', 10, 'var(--hp)')}</div></div>
      <p class="meta read" style="margin:10px 0 0">時間帯別の集中度：午前 ${fb.am.avg ?? '−'}（${fb.am.n}回）／午後 ${fb.pm.avg ?? '−'}（${fb.pm.n}回）／夜 ${fb.night.avg ?? '−'}（${fb.night.n}回）</p></section>
    <section class="win"><span class="tag">課題と改善案</span>
      ${a.hypotheses.length ? a.hypotheses.map((h) => `<div class="item"><p class="read" style="margin:0"><span class="label ai">仮説</span>${E(h.text)}</p><p class="meta read" style="margin:0">${E(h.basis)}。相関であり、原因とは断定できません。</p>
        <p class="read" style="margin:0"><span class="label ai">提案</span>${E(h.action)}</p>${exps.some((e) => e.status === 'running' && e.title === h.action) ? '<span class="meta">実験中</span>' : `<div class="row start"><button class="btn small" data-act="experiment" data-key="${h.key}">1週間試す</button></div>`}</div>`).join('')
        : `<p class="meta read">まだ傾向を言えるだけの記録がありません。同じ条件の記録が3日分以上（作業の集中度は時間帯ごとに3回以上）たまると、仮説と改善案を表示します。</p>`}</section>
    <section class="win"><span class="tag">改善実験</span>
      ${exps.length ? exps.map((e) => { const r = D.result(e.id), di = D.dayIndex(e.start_date);
        return `<div class="item"><div class="head"><span>${E(e.title)}</span><span class="meta">${md(e.start_date)}から${e.days}日 ／ ${e.status === 'running' ? `${Math.min(di + 1, e.days)}日目` : { keep: '続ける', revert: '元に戻す', other: '別案へ' }[e.decision] || '終了'}</span></div>
          ${r ? `<p class="meta read" style="margin:0"><span class="label rec">結果</span>${E(r.summary)}</p>` : ''}
          ${e.status === 'running' ? `<div class="row start"><button class="btn small" data-act="evaluate" data-id="${e.id}">${di + 1 >= e.days ? '結果を確認' : '途中経過を見る'}</button>${r ? `<button class="btn small" data-act="decide" data-id="${e.id}" data-v="keep">続ける</button><button class="btn small ghost" data-act="decide" data-id="${e.id}" data-v="revert">元に戻す</button><button class="btn small ghost" data-act="decide" data-id="${e.id}" data-v="other">別案を試す</button>` : ''}</div>` : ''}</div>`; }).join('')
        : '<p class="meta read">改善案を「1週間試す」と、ここで効果を確認できます。</p>'}</section>
    <section class="win"><span class="tag">予定時間と実績</span>${a.sessions.length ? `<div class="scroll"><table class="wide"><tr><th>日付</th><th>タスク</th><th>予定</th><th>実績</th><th>開始のずれ</th><th>状態</th><th>集中</th><th>体調</th></tr>
      ${a.sessions.slice(0, 30).map((s) => `<tr><td>${md(s.date)}</td><td>${E(s.task || '')}</td><td>${s.plan ? s.plan + '分' : '−'}</td><td>${s.minutes}分</td><td>${s.startGap == null ? '−' : (s.startGap > 0 ? '+' : '') + s.startGap + '分'}</td><td>${E(s.status || '')}</td><td>${s.focus ?? '−'}</td><td>${s.energy ?? '−'}</td></tr>`).join('')}</table></div>` : '<p class="meta read">作業の記録はまだありません。</p>'}
      ${D.paceRatio() ? `<p class="meta read">見積もり補正：実績は予定の平均${D.paceRatio().ratio}倍（${D.paceRatio().n}回分）。自動で予定を組むときに反映しています。</p>` : ''}</section>
    <section class="win"><span class="tag">新しい挑戦</span>
      ${st.ok ? `<p class="read" style="margin:0 0 8px"><span class="label ai">提案</span>生活が安定しています。今の充実を崩さない範囲で、挑戦の候補です。</p>${D.challenges().map((c) => `<div class="item"><div class="head"><span class="read">${E(c)}</span><button class="btn small" data-act="addChallenge" data-v="${E(c)}">習慣に追加</button></div></div>`).join('')}`
        : `<p class="meta read">今は生活の安定を優先します。安定してきたら、新しい挑戦を提案します。（${E(st.reason)}）</p>`}</section>
  </div>`;
}

// ---------------- AI相談 ----------------
export function ai(D, V) {
  const days = V.cDays || 14, free = V.cFree !== false, txt = D.consultText(days, free);
  return `<div class="grid"><section class="win"><span class="tag">${game ? '賢者に相談' : 'AI相談'}（Claude Codeで）</span>
    <p class="read" style="margin-top:0">相談は Claude Code で行います（アプリ内のAI接続は見送り中）。下の記録をコピーして Claude Code に貼り付け、続けて相談したいことを書いてください。</p>
    <p class="meta read">例：「最近午後に集中できないのはなぜ？」「来週の予定の組み方を提案して」「この記録を見て、アプリに足りない機能は？」</p>
    <div class="seg" role="group" aria-label="期間">${[[7, '7日'], [14, '14日'], [28, '4週間']].map(([n, l]) => `<button class="btn small ${days === n ? '' : 'ghost'}" data-act="cDays" data-n="${n}" aria-pressed="${days === n}">${l}</button>`).join('')}</div>
    <label class="fld" style="display:flex;gap:8px;align-items:center;margin-top:10px"><input id="c-free" type="checkbox" style="width:auto;min-height:0" ${free ? 'checked' : ''}><span style="color:var(--text)">自由記述（ひとこと・次に始める場所・問題点）も含める</span></label>
    <label class="fld"><span>書き出した記録（記録された事実のみ。内容を確認してから使ってください）</span><textarea id="c-text" rows="12" readonly>${E(txt)}</textarea></label>
    <div class="row"><button class="btn go" data-act="copyConsult">記録をコピー</button></div></section></div>`;
}

// ---------------- 理想の設定 ----------------
export function setup(D, V) {
  const I = D.idealOrDefault(), ev = V.events || D.fixedEvents(), tplN = D.db.all('recurring_events').filter((e) => e.active !== false && (e.kind || 'fixed') !== 'fixed').length;
  const f = (id, label, val, type = 'time', extra = '') => `<label class="fld"><span>${label}</span><input id="${id}" type="${type}" value="${E(val ?? '')}" ${extra}></label>`;
  const first = !D.onboarded();
  return `<div class="grid">
    ${first ? `<section class="win"><span class="tag">ようこそ</span><p class="read" style="margin:0">最初に「理想の1日」を決めます。あとからいつでも変えられます。完璧でなくて大丈夫です。実際の記録を見ながら少しずつ直していきます。</p></section>` : ''}
    <section class="win"><span class="tag">理想の生活リズム</span><div class="fields">
      ${f('i-wake', '起床', I.wake_time)}${f('i-bed', '就寝', I.bed_time)}${f('i-sleep', '睡眠（時間）', I.sleep_hours, 'number', 'step="0.5" min="3" max="12" inputmode="decimal"')}</div>
      <div class="meta" style="margin:6px 0">食事</div>
      ${(I.meals || []).map((m, i) => `<div class="fields">${f('i-meal-n' + i, '名前', m.name, 'text')}${f('i-meal-t' + i, '時刻', m.time)}${f('i-meal-d' + i, '分', m.dur, 'number', 'min="5" max="180" inputmode="numeric"')}</div>`).join('')}
      <div class="fields">${f('i-ex-t', '運動の時刻', I.exercise_time)}${f('i-ex-m', '運動（分）', I.exercise_min, 'number', 'min="0" max="240" inputmode="numeric"')}${f('i-free-t', '自由時間の開始', I.free_time)}${f('i-free-m', '自由時間（分）', I.free_min, 'number', 'min="0" max="600" inputmode="numeric"')}</div></section>
    <section class="win"><span class="tag">大学・仕事</span><div class="fields">
      ${f('i-ws', '作業できる時間（開始）', I.work_start)}${f('i-we', '作業できる時間（終了）', I.work_end)}${f('i-rest', 'タスク後の休憩（分）', I.rest_min, 'number', 'min="0" max="60" inputmode="numeric"')}
      <label class="fld"><span>集中しやすい時間帯</span><select id="i-focus">${[['am', '午前'], ['pm', '午後'], ['night', '夜']].map(([v, l]) => `<option value="${v}" ${I.focus_period === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
      ${tplN ? `<p class="meta read" style="margin:6px 0">曜日ごとの時間割（週の型・試行版）が登録されています（${tplN}件）。登録した曜日は、下の理想の時刻ではなく週の型どおりに時間割を作ります。週の型の変更は Claude Code に依頼してください。</p>` : ''}
      <div class="meta" style="margin:6px 0">毎週の固定予定（授業・アルバイトなど）</div>
      ${ev.map((e, i) => `<div class="item" data-ev="${i}"><div class="fields">${f('e-title' + i, '名前', e.title, 'text')}${f('e-start' + i, '開始', fmt(e.start_min))}${f('e-end' + i, '終了', fmt(e.start_min + e.dur))}</div>
        <div class="wds">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<label><input type="checkbox" id="e-wd${i}-${d}" ${(e.weekdays || []).includes(d) ? 'checked' : ''}>${WD[d]}</label>`).join('')}<button class="btn small danger" data-act="evDel" data-i="${i}" style="margin-left:auto">削除</button></div></div>`).join('')}
      <div class="row start"><button class="btn small" data-act="evAdd">＋ 固定予定を追加</button></div></section>
    <section class="win"><span class="tag">目標と優先順位</span>
      <label class="fld"><span>目標（1行に1つ）</span><textarea id="i-goals" rows="3" placeholder="例：英語を話せるようになる">${E((I.goals || []).join('\n'))}</textarea></label>
      <label class="fld"><span>大切にしたいこと・優先順位（1行に1つ）</span><textarea id="i-prio" rows="3" placeholder="例：睡眠を削らない">${E((I.priorities || []).join('\n'))}</textarea></label></section>
    <div class="row">${first ? '' : '<button class="btn ghost" data-act="tab" data-v="habits">戻る</button>'}<button class="btn go" data-act="saveIdeal">${first ? 'この内容で冒険を始める' : '保存する'}</button></div>
  </div>`;
}

// ---------------- シート・作業中 ----------------
export function startSheet(D, V) {
  const t = D.task(V.id); if (!t) return '';
  const h = D.handoff(t.id), ss = D.sessionsOf(t.id), pace = D.paceRatio();
  return `<div class="overlay" role="dialog" aria-modal="true" aria-label="${T('startChk')}"><div class="win"><span class="tag">${T('startChk')}</span>
    <h2 style="font-size:22px">${E(t.title)}</h2>
    <dl class="kv"><dt>今回やること</dt><dd>${E(t.goal || '未設定')}</dd><dt>完了条件</dt><dd>${E(t.done_when || '未設定')}</dd><dt>予定時間</dt><dd>${dur(t.estimate_min)}${ss.length ? `（これまで ${ss.length}回・計${dur(D.workedMin(t.id))}）` : ''}${pace ? `<br><span class="meta">見積もりの実績：予定の平均${pace.ratio}倍</span>` : ''}</dd>
      ${h ? `<dt>前回の結果</dt><dd>${E(h.progress || '記録なし')}</dd><dt>残ったこと</dt><dd>${E(h.remaining || '記録なし')}</dd><dt>次に始める</dt><dd style="color:var(--gold)">▶ ${E(h.next_step || '記録なし')}</dd>` : `<dt>前回</dt><dd>${T('first')}</dd>`}</dl>
    <p class="meta read">開始を押した時刻を自動で記録します。</p>
    <div class="row"><button class="btn ghost" data-act="close">やめる</button><button class="btn go" data-act="start">▶ 開始</button></div></div></div>`;
}

export function endSheet(D, V) {
  const s = D.running(); if (!s) return '';
  const t = D.task(s.task_id) || {}, mins = Math.round(D.elapsedMs(s) / 60000), h = D.handoff(s.task_id);
  const opts = (name, list, cur) => list.map((o) => `<label><input type="radio" name="${name}" value="${o}" ${o === cur ? 'checked' : ''}>${o}</label>`).join('');
  const st = new Date(s.started_at);
  return `<div class="overlay" role="dialog" aria-modal="true" aria-label="${T('saveTitle')}"><div class="win"><span class="tag">${T('saveTitle')}</span>
    <p class="meta">${E(t.title)} ／ ${String(st.getHours()).padStart(2, '0')}:${String(st.getMinutes()).padStart(2, '0')} 開始 ／ 実作業 ${dur(mins)}（自動記録）</p>
    <div class="menu">${opts('status', ['完了', '継続', '中断', '問題発生'], V.status || '継続')}</div>
    <label class="fld key"><span>次回どこから始めるか（いちばん大事）</span><input id="f-next" placeholder="例：3ページ目の図表から" value="${E(V.keepNext ? (h && h.next_step) || '' : '')}"></label>
    <label class="fld"><span>今回進んだこと（任意）</span><input id="f-progress"></label>
    <label class="fld"><span>残っていること（任意）</span><input id="f-remaining"></label>
    <div class="meta">集中度（任意）</div><div class="menu dots">${opts('focus', ['1', '2', '3', '4', '5'], '')}</div>
    <div class="meta">エネルギー・状態（任意）</div><div class="menu dots">${opts('energy', ['1', '2', '3', '4', '5'], '')}</div>
    <label class="fld"><span>問題点（任意）</span><input id="f-problem"></label>
    <div class="row"><button class="btn ghost" data-act="close">戻る</button><button class="btn go" data-act="end">${T('saveBtn')}</button></div></div></div>`;
}

export function battle(D) {
  const s = D.running(), t = D.task(s.task_id) || { title: '（削除されたタスク）' }, p = !!s.paused_at, st = new Date(s.started_at);
  return `<div class="battle"><section class="win"><span class="tag">${T('doing')}</span>
    <h2 style="font-size:22px">${E(t.title)}</h2><p class="meta goal">今回：${E(t.goal || '未設定')}</p>
    <div class="timer" data-elapsed>${elapsedClock(D.elapsedMs(s))}</div>
    <p class="meta">${p ? '一時停止中' : `${String(st.getHours()).padStart(2, '0')}:${String(st.getMinutes()).padStart(2, '0')} から作業中`}</p>
    <label class="fld" style="text-align:left"><span>メモ（任意）</span><textarea id="f-memo">${E(s.memo || '')}</textarea></label>
    <div class="row" style="justify-content:center">${p ? '<button class="btn" data-act="resume">再開</button>' : '<button class="btn" data-act="pause">一時停止</button>'}
      <button class="btn" data-act="open-end" data-status="中断">中断</button><button class="btn go" data-act="open-end" data-status="継続">終了</button></div>
    <div class="foot" style="justify-content:center;margin-top:14px"><button data-act="mini">ホームを見る</button><button data-act="cancelSession">開始を取り消す</button></div>
  </section></div>`;
}
export const fmtMin = (m) => fmt(m);
export const elapsedClock = (ms) => { const s = Math.floor(ms / 1000), p = (n) => String(n).padStart(2, '0'); return (s >= 3600 ? Math.floor(s / 3600) + ':' : '') + p(Math.floor(s / 60) % 60) + ':' + p(s % 60); };

export function taskSheet(D, V) {
  const t = V.id ? D.task(V.id) || D.db.raw('tasks', V.id) : null, p = t && D.project(t.project_id);
  const ss = t ? D.sessionsOf(t.id).slice().reverse() : [], hs = t ? D.db.all('handoffs').filter((h) => h.task_id === t.id).sort((a, b) => b.updated_at.localeCompare(a.updated_at)) : [];
  return `<div class="overlay" role="dialog" aria-modal="true" aria-label="タスク"><div class="win"><span class="tag">${t ? 'タスクの編集' : T('add')}</span>
    <label class="fld"><span>タスク名（必須）</span><input id="t-title" value="${E(t ? t.title : '')}" placeholder="例：企画資料の修正"></label>
    <label class="fld"><span>プロジェクト（任意）</span><input id="t-project" list="t-projects" value="${E(p ? p.name : '')}"><datalist id="t-projects">${D.projects().map((x) => `<option value="${E(x.name)}">`).join('')}</datalist></label>
    <label class="fld"><span>今回やること</span><input id="t-goal" value="${E(t ? t.goal || '' : '')}"></label>
    <label class="fld"><span>完了条件</span><input id="t-done" value="${E(t ? t.done_when || '' : '')}"></label>
    <div class="fields"><label class="fld"><span>予定時間（分）</span><input id="t-est" type="number" min="5" max="600" inputmode="numeric" value="${t ? t.estimate_min : 30}"></label>
      <label class="fld"><span>優先度</span><select id="t-prio">${[[1, '高'], [2, '中'], [3, '低']].map(([v, l]) => `<option value="${v}" ${(t ? t.priority : 2) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="fld"><span>締切（任意）</span><input id="t-due" type="date" value="${E(t ? t.due_date || '' : '')}"></label></div>
    <p class="err" id="t-err" hidden>タスク名を入力してください。</p>
    <div class="row">${t ? `<button class="btn danger" data-act="deleteTask" data-id="${t.id}">削除</button>${t.status === 'done' ? `<button class="btn ghost" data-act="reopenTask" data-id="${t.id}">未完了に戻す</button>` : ''}` : ''}<button class="btn ghost" data-act="close">閉じる</button><button class="btn go" data-act="saveTask" data-id="${t ? t.id : ''}">保存</button></div>
    ${t && (ss.length || hs.length) ? `<div style="margin-top:14px"><div class="meta">作業の履歴</div>${ss.map((s) => { const h = hs.find((x) => x.session_id === s.id); const d = new Date(s.started_at); return `<div class="item read"><div class="head"><span>${md(logicalDate(d))} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}〜 ${dur(s.minutes)}</span><span class="meta">${E(s.status || '')}${s.focus ? ' ・集中' + s.focus : ''}</span></div>${h ? `<div class="meta">進んだ：${E(h.progress || '−')} ／ 残り：${E(h.remaining || '−')} ／ 次：${E(h.next_step || '−')}</div>` : ''}${s.problem ? `<div class="bad">問題：${E(s.problem)}</div>` : ''}</div>`; }).join('')}</div>` : ''}
  </div></div>`;
}

export function blockSheet(D, V) {
  const b = V.id ? D.db.get('schedule_blocks', V.id) : null;
  const kinds = Object.entries(KIND).filter(([k]) => k !== 'task' || !b || b.kind === 'task');
  const label = b ? D.blockLabel(b) : '';
  return `<div class="overlay" role="dialog" aria-modal="true" aria-label="予定"><div class="win"><span class="tag">${b ? '予定の変更' : '予定を追加'}</span>
    ${b && b.kind === 'task' ? `<p class="read" style="margin:0 0 8px">タスク：${E(label)}</p>` : `<label class="fld"><span>名前</span><input id="b-title" value="${E(b ? b.title || '' : '')}" placeholder="例：買い物"></label>
    <label class="fld"><span>種類</span><select id="b-kind">${kinds.filter(([k]) => k !== 'task').map(([k, l]) => `<option value="${k}" ${(b ? b.kind === k : k === 'habit') ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`}
    ${!b ? `<label class="fld"><span>またはタスクを入れる</span><select id="b-task"><option value="">（タスクではない）</option>${D.openTasks().map((t) => `<option value="${t.id}">${E(t.title)}</option>`).join('')}</select></label>` : ''}
    <div class="fields"><label class="fld"><span>開始</span><input id="b-start" type="time" value="${b ? fmt(b.start_min) : fmt(Math.ceil((new Date().getHours() * 60 + new Date().getMinutes()) / 15) * 15)}"></label>
      <label class="fld"><span>長さ（分）</span><input id="b-dur" type="number" min="5" max="720" inputmode="numeric" value="${b ? b.dur : 30}"></label></div>
    <label class="fld" style="display:flex;gap:8px;align-items:center"><input id="b-fixed" type="checkbox" style="width:auto;min-height:0" ${b && b.fixed ? 'checked' : ''}><span style="color:var(--text)">固定予定にする（自動調整で動かさない）</span></label>
    ${b && b.fixed ? '<p class="meta read">固定予定です。変更は手動でのみ行えます。</p>' : ''}
    <div class="row">${b ? `<button class="btn danger" data-act="deleteBlock" data-id="${b.id}">削除</button>` : ''}<button class="btn ghost" data-act="close">閉じる</button><button class="btn go" data-act="saveBlock" data-id="${b ? b.id : ''}">保存</button></div></div></div>`;
}

export function sleepSheet(D) {
  const st = D.state() || {};
  return `<div class="overlay" role="dialog" aria-modal="true" aria-label="睡眠時間"><div class="win"><span class="tag">睡眠時間</span>
    <p class="meta read">昨夜の就寝が記録されていないため、睡眠時間を入力してください。自動で推測はしません。</p>
    <label class="fld"><span>睡眠（時間）</span><input id="s-hours" type="number" min="0" max="16" step="0.5" inputmode="decimal" value="${E(st.sleep_hours ?? '')}"></label>
    <div class="row"><button class="btn ghost" data-act="close">閉じる</button><button class="btn go" data-act="saveSleep">保存</button></div></div></div>`;
}

export function authView(V) {
  return `<div class="auth"><h1>冒険の書</h1>
    <section class="win"><span class="tag">${V.signup ? 'はじめての登録' : 'ログイン'}</span>
      <p class="meta read" style="margin-top:0">PCとiPhoneで同じ記録を使うために、メールアドレスでログインします。</p>
      <label class="fld"><span>メールアドレス</span><input id="a-email" type="email" autocomplete="email" inputmode="email" value="${E(V.email || '')}"></label>
      <label class="fld"><span>パスワード（8文字以上）</span><input id="a-pass" type="password" autocomplete="${V.signup ? 'new-password' : 'current-password'}"></label>
      ${V.authMsg ? `<p class="${V.authErr ? 'err' : 'meta'} read">${E(V.authMsg)}</p>` : ''}
      <div class="row"><button class="btn ghost" data-act="authMode">${V.signup ? 'ログインに戻る' : 'はじめて使う'}</button><button class="btn go" data-act="${V.signup ? 'signup' : 'login'}" ${V.busy ? 'disabled' : ''}>${V.signup ? '登録する' : 'ログイン'}</button></div>
    </section></div>`;
}
