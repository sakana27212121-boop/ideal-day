// ドット絵の世界観に合わせた効果音（Web Audioで生成。音声ファイルは使わない）
// 鳴るのはアプリを開いているときだけ。iPhoneは消音モードでは鳴らない
let ctx = null;
const NOTES = { C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880, B5: 987.77, C6: 1046.5, E6: 1318.5, G4: 392 };
const SEQ = {
  tap: [['E6', 0.05]],
  start: [['C5', 0.08], ['E5', 0.08], ['G5', 0.14]],
  save: [['G5', 0.08], ['C6', 0.16]],
  complete: [['C5', 0.08], ['E5', 0.08], ['G5', 0.08], ['C6', 0.1], ['G5', 0.08], ['C6', 0.28]],
  timeup: [['A5', 0.12], ['E5', 0.12], ['A5', 0.12], ['E5', 0.12], ['A5', 0.24]],
  cancel: [['E5', 0.08], ['G4', 0.18]],
};
export function unlock() { // ユーザー操作の中で呼ぶと、以降の再生が許可される
  try { if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === 'suspended') ctx.resume(); } catch (e) { ctx = null; }
}
export function play(name, enabled = true) {
  if (!enabled || !SEQ[name]) return;
  unlock(); if (!ctx) return;
  let t = ctx.currentTime + 0.01;
  for (const [n, d] of SEQ[name]) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square'; o.frequency.value = NOTES[n];
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + d + 0.02); t += d;
  }
  window.__lastSound = name; // 検証用
}
