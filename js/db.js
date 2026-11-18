// 保存処理はこのファイルに集約する。
// 端末内（localStorage）に全データを持ち、変更は即保存 → Supabase と差分同期する。
// オフラインでも使え、つながったときに送受信する。新旧は updated_at（最後に書いた方が勝つ）で判定。
import { uid } from './util.js';

export const TABLES = ['user_settings', 'ideal_life', 'habits', 'habit_logs', 'daily_states', 'recurring_events', 'schedule_blocks',
  'projects', 'tasks', 'work_sessions', 'handoffs', 'improvement_proposals', 'experiments', 'experiment_results', 'ai_messages'];

export class DB {
  constructor() { this.uid = null; this.data = {}; this.dirty = new Set(); this.cursor = {}; this.listeners = []; this.client = null;
    this.status = { state: 'local', at: null, error: null }; this._timer = null; this.syncing = false; }

  key() { return 'ideal-day:data:' + (this.uid || 'local'); }

  load(userId) {
    this.uid = userId; this.data = {}; this.dirty = new Set(); this.cursor = {};
    try { const s = JSON.parse(localStorage.getItem(this.key()) || 'null'); if (s) { this.data = s.data || {}; this.dirty = new Set(s.dirty || []); this.cursor = s.cursor || {}; } } catch (e) { /* 読めない場合は空から */ }
    TABLES.forEach((t) => { this.data[t] = this.data[t] || {}; });
  }

  persist() {
    try { localStorage.setItem(this.key(), JSON.stringify({ data: this.data, dirty: [...this.dirty], cursor: this.cursor })); }
    catch (e) { this.status = { ...this.status, error: '端末の保存領域がいっぱいです' }; }
  }

  on(fn) { this.listeners.push(fn); }
  emit(source) { this.listeners.forEach((f) => f(source)); }

  all(t) { return Object.values(this.data[t] || {}).filter((r) => !r.deleted); }
  get(t, id) { const r = this.data[t] && this.data[t][id]; return r && !r.deleted ? r : null; }
  raw(t, id) { return this.data[t] && this.data[t][id]; }

  put(t, row, opts = {}) {
    const id = row.id || uid();
    const r = { ...(this.data[t][id] || {}), ...row, id, updated_at: new Date().toISOString() };
    if (this.uid && this.uid !== 'local') r.user_id = this.uid;
    this.data[t][id] = r; this.dirty.add(t + ':' + id);
    if (!opts.batch) { this.persist(); this.emit('local'); this.scheduleSync(); }
    return r;
  }
  remove(t, id, opts) { if (this.data[t][id]) return this.put(t, { id, deleted: true }, opts); }
  commit() { this.persist(); this.emit('local'); this.scheduleSync(); }

  // ---- 同期 ----
  attach(client) { this.client = client; this.status = { state: 'idle', at: null, error: null }; }
  scheduleSync(ms = 800) { if (!this.client) return; clearTimeout(this._timer); this._timer = setTimeout(() => this.sync(), ms); }

  async sync() {
    if (!this.client || !this.uid || this.uid === 'local') return;
    // 実行中なら、その完了後にもう一度同期する（呼んだ時点までの変更が必ず送られる）
    if (this.syncing) { this._again = true; return this._next || (this._next = this._p.then(() => { this._next = null; this._again = false; return this.sync(); })); }
    this._p = this._run(); return this._p;
  }

  async _run() {
    this.syncing = true; this.status = { ...this.status, state: 'syncing' }; this.emit('status');
    try {
      await this.push();
      const changed = await this.pull();
      this.status = { state: 'ok', at: new Date(), error: null };
      this.persist();
      if (changed) this.emit('remote');
    } catch (e) {
      this.status = { state: navigator.onLine === false ? 'offline' : 'error', at: this.status.at, error: String(e && e.message || e) };
    } finally {
      this.syncing = false; this.emit('status');
      if (this._again && !this._next) { this._again = false; this.scheduleSync(300); }
    }
  }

  async push() {
    const byTable = {};
    [...this.dirty].forEach((k) => { const i = k.indexOf(':'); (byTable[k.slice(0, i)] = byTable[k.slice(0, i)] || []).push(k.slice(i + 1)); });
    for (const t of Object.keys(byTable)) {
      const rows = byTable[t].map((id) => this.data[t][id]).filter(Boolean).map((r) => { const { synced_at, ...rest } = r; return { ...rest, user_id: this.uid }; });
      if (!rows.length) continue;
      // 項目の組み合わせが同じ行ごとに送る。まとめて送ると、ほかの行にしかない項目が空（NULL）として扱われ、
      // 「空にできない項目」で全体が失敗する（11/17：新しい日の記録に回復の時間の項目がなく、同期が止まった）
      const groups = {};
      rows.forEach((r) => { const k = Object.keys(r).sort().join(','); (groups[k] = groups[k] || []).push(r); });
      for (const g of Object.values(groups)) {
        const snap = g.map((r) => [r.id, r.updated_at]);
        const { error } = await this.client.from(t).upsert(g);
        if (error) throw new Error(t + ': ' + error.message);
        snap.forEach(([id, u]) => { if (this.data[t][id] && this.data[t][id].updated_at === u) this.dirty.delete(t + ':' + id); });
      }
    }
  }

  async pull() {
    let changed = false;
    const results = await Promise.all(TABLES.map(async (t) => {
      const out = []; let cur = this.cursor[t];
      for (let page = 0; page < 20; page++) {
        let q = this.client.from(t).select('*').order('synced_at', { ascending: true }).limit(1000);
        if (cur) q = q.gte('synced_at', cur); // 同じ時刻の行を取りこぼさないよう境目を含める（変化のない行は下で読み飛ばす）
        const { data, error } = await q;
        if (error) throw new Error(t + ': ' + error.message);
        out.push(...data); if (data.length) cur = data[data.length - 1].synced_at;
        if (data.length < 1000) break;
      }
      return [t, out, cur];
    }));
    for (const [t, rows, cur] of results) {
      for (const r of rows) {
        const local = this.data[t][r.id];
        if (local && this.dirty.has(t + ':' + r.id) && local.updated_at > r.updated_at) continue; // 端末側の方が新しい
        if (local && JSON.stringify(local) === JSON.stringify(r)) continue;
        this.data[t][r.id] = r; this.dirty.delete(t + ':' + r.id); changed = true;
      }
      if (cur) this.cursor[t] = cur;
    }
    return changed;
  }
}
