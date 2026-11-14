// 日付・時刻・文字列の小さな道具
export const DAY_START_HOUR = 4; // 4時までは前日として扱う（夜ふかし対策）
export const pad = (n) => String(n).padStart(2, '0');
const ymd = (x) => `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
export const logicalDate = (d = new Date()) => ymd(new Date(d.getTime() - DAY_START_HOUR * 3600e3));
export const addDays = (ds, n) => { const [y, m, d] = ds.split('-').map(Number); return ymd(new Date(y, m - 1, d + n)); };
export const weekday = (ds) => { const [y, m, d] = ds.split('-').map(Number); return new Date(y, m - 1, d).getDay(); };
export const md = (ds) => `${+ds.slice(5, 7)}/${+ds.slice(8, 10)}`;
export const WD = '日月火水木金土';
export const toMin = (t) => { if (!t) return null; const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
export const fmt = (m) => { m = Math.round(m); const x = ((m % 1440) + 1440) % 1440; return pad(Math.floor(x / 60)) + ':' + pad(x % 60); };
// 論理日の0時からの分（4時前は+1440）
export const nowMin = (d = new Date()) => { let m = d.getHours() * 60 + d.getMinutes(); if (d.getHours() < DAY_START_HOUR) m += 1440; return m; };
export const clock = (d = new Date()) => pad(d.getHours()) + ':' + pad(d.getMinutes());
export const dur = (min) => { min = Math.max(0, Math.round(min || 0)); const h = Math.floor(min / 60), m = min % 60; return h ? (m ? `${h}時間${m}分` : `${h}時間`) : `${m}分`; };
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => ((Math.random() * 16) | 0).toString(16)));
// 同じ入力から同じIDを作る（複数端末で同じ日の予定を自動生成しても重複しない）
export const detId = (...parts) => {
  const s = parts.join('|'); let hex = '';
  for (let seed = 0; seed < 4; seed++) { let h = 0x811c9dc5 ^ (seed * 0x9e3779b1); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } hex += h.toString(16).padStart(8, '0'); }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
export const avg = (arr) => (arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : null);
export const tsMin = (ts, date) => { const d = new Date(ts); let m = d.getHours() * 60 + d.getMinutes(); if (date && logicalDate(d) === date && d.getHours() < DAY_START_HOUR) m += 1440; return m; };
