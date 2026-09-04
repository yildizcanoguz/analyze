// Procedural audio. No asset downloads: every sound is synthesised, which means
// the game can breathe with the player instead of playing a clip at them.
//
// The important one is `heart()`: while an irreversible decision is unresolved,
// a slow low pulse sits under the music and speeds up as the day approaches.

let ctx = null, master = null, musicGain = null, sfxGain = null;
let heartTimer = null, heartRate = 0, droneNodes = [];
let started = false;

export function initAudio() {
  if (ctx) return ctx;
  try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
  master = ctx.createGain(); master.gain.value = 0.55; master.connect(ctx.destination);
  musicGain = ctx.createGain(); musicGain.gain.value = 0.34; musicGain.connect(master);
  sfxGain = ctx.createGain(); sfxGain.gain.value = 0.9; sfxGain.connect(master);
  return ctx;
}
export function resumeAudio() {
  if (!ctx) initAudio();
  if (ctx?.state === 'suspended') ctx.resume();
  if (!started && ctx) { started = true; startDrone(); }
}
export function setVolume(v) { if (master) master.gain.value = v; }

function env(node, { a = 0.01, d = 0.2, s = 0, r = 0.3, peak = 1, t0 = 0 } = {}) {
  const t = ctx.currentTime + t0;
  const g = node.gain;
  g.cancelScheduledValues(t);
  g.setValueAtTime(0.0001, t);
  g.exponentialRampToValueAtTime(Math.max(0.0001, peak), t + a);
  g.exponentialRampToValueAtTime(Math.max(0.0001, peak * (s || 0.001)), t + a + d);
  g.exponentialRampToValueAtTime(0.0001, t + a + d + r);
}

function tone(freq, opts = {}) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = opts.type || 'sine';
  o.frequency.value = freq;
  if (opts.slide) o.frequency.exponentialRampToValueAtTime(opts.slide, ctx.currentTime + (opts.a || 0.01) + (opts.d || 0.2));
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = opts.cutoff || 4000;
  o.connect(f); f.connect(g); g.connect(opts.bus || sfxGain);
  env(g, opts);
  o.start(ctx.currentTime + (opts.t0 || 0));
  o.stop(ctx.currentTime + (opts.t0 || 0) + (opts.a || 0.01) + (opts.d || 0.2) + (opts.r || 0.3) + 0.05);
}

function noise(dur = 0.4, opts = {}) {
  if (!ctx) return;
  const n = ctx.createBufferSource();
  const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, opts.decay ?? 1.6);
  n.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = opts.filter || 'bandpass'; f.frequency.value = opts.freq || 900; f.Q.value = opts.q || 1;
  const g = ctx.createGain(); g.gain.value = opts.gain ?? 0.3;
  n.connect(f); f.connect(g); g.connect(opts.bus || sfxGain);
  n.start();
}

// --- ambience ---------------------------------------------------------------
function startDrone() {
  if (!ctx) return;
  for (const f of [55, 82.4, 110]) {
    const o = ctx.createOscillator();
    o.type = 'sine'; o.frequency.value = f;
    const g = ctx.createGain(); g.gain.value = 0.0001;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.04 + Math.random() * 0.06;
    const lg = ctx.createGain(); lg.gain.value = 0.028;
    lfo.connect(lg); lg.connect(g.gain);
    o.connect(g); g.connect(musicGain);
    g.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 6);
    o.start(); lfo.start();
    droneNodes.push({ o, g, lfo });
  }
}
/** Raise the floor of the world's sound when things are grim. */
export function setTension(t) {
  if (!ctx || !droneNodes.length) return;
  const now = ctx.currentTime;
  droneNodes.forEach((n, i) => {
    n.g.gain.cancelScheduledValues(now);
    n.g.gain.setTargetAtTime(0.05 + t * (i === 2 ? 0.10 : 0.05), now, 2.5);
    n.o.detune.setTargetAtTime(t * (i % 2 ? 14 : -14), now, 3);
  });
}

// --- the heartbeat ----------------------------------------------------------
export function heart(rate) {  // rate 0 = off, 1 = calm, 3 = about to know
  heartRate = rate;
  if (heartTimer) { clearInterval(heartTimer); heartTimer = null; }
  if (!rate || !ctx) return;
  const period = 1300 / rate;
  const beat = () => {
    tone(48, { type: 'sine', a: 0.006, d: 0.10, r: 0.08, peak: 0.42 * Math.min(1, rate / 2), cutoff: 200 });
    setTimeout(() => tone(42, { type: 'sine', a: 0.006, d: 0.13, r: 0.10, peak: 0.30 * Math.min(1, rate / 2), cutoff: 180 }), period * 0.22);
  };
  beat();
  heartTimer = setInterval(beat, period);
}

// --- named cues -------------------------------------------------------------
export const SFX = {
  click()      { tone(880, { type: 'triangle', a: 0.002, d: 0.04, r: 0.05, peak: 0.10, cutoff: 3000 }); },
  hover()      { tone(1400, { type: 'sine', a: 0.002, d: 0.02, r: 0.03, peak: 0.035, cutoff: 5000 }); },
  open()       { tone(260, { type: 'triangle', a: 0.01, d: 0.30, r: 0.4, peak: 0.16, cutoff: 1600 });
                 noise(0.5, { freq: 320, q: 0.7, gain: 0.10, filter: 'lowpass' }); },
  /** The sound of paying. Coins, and a door closing behind you. */
  commit()     { noise(0.35, { freq: 2400, q: 1.2, gain: 0.16 });
                 tone(160, { type: 'sine', a: 0.008, d: 0.5, r: 0.7, peak: 0.30, cutoff: 700 });
                 tone(80,  { type: 'sine', a: 0.02, d: 0.9, r: 1.4, peak: 0.24, cutoff: 300, t0: 0.10 }); },
  /** Something arrived while you were waiting. */
  whisper(tone_) {
    const f = tone_ === 'bad' ? 320 : tone_ === 'good' ? 640 : 480;
    tone(f, { type: 'sine', a: 0.02, d: 0.22, r: 0.5, peak: 0.09, cutoff: 2200 });
    noise(0.30, { freq: 3200, q: 2.4, gain: 0.045 });
  },
  /** The held breath before you know. */
  breath()     { tone(110, { type: 'sine', a: 1.4, d: 0.4, r: 0.9, peak: 0.30, cutoff: 420 });
                 noise(2.0, { freq: 180, q: 0.5, gain: 0.07, filter: 'lowpass', decay: 0.4 }); },
  good()       { for (const [i, f] of [261.6, 329.6, 392.0, 523.3].entries())
                   tone(f, { type: 'triangle', a: 0.02, d: 0.6, r: 1.4, peak: 0.16, cutoff: 3400, t0: i * 0.085 }); },
  bad()        { tone(110, { type: 'sawtooth', a: 0.01, d: 0.9, r: 1.8, peak: 0.24, cutoff: 700, slide: 82 });
                 tone(73.4, { type: 'sine', a: 0.02, d: 1.2, r: 2.2, peak: 0.28, cutoff: 260 });
                 noise(1.4, { freq: 140, q: 0.4, gain: 0.13, filter: 'lowpass', decay: 0.7 }); },
  /** A death in the family. */
  knell()      { for (const i of [0, 1, 2]) {
                   tone(98, { type: 'sine', a: 0.006, d: 1.6, r: 2.6, peak: 0.34, cutoff: 900, t0: i * 1.5 });
                   tone(196.5, { type: 'sine', a: 0.006, d: 1.1, r: 1.9, peak: 0.14, cutoff: 1800, t0: i * 1.5 }); } },
  war()        { noise(1.2, { freq: 90, q: 0.5, gain: 0.22, filter: 'lowpass', decay: 0.9 });
                 tone(65, { type: 'sawtooth', a: 0.05, d: 0.8, r: 1.2, peak: 0.22, cutoff: 400 }); },
  coin()       { for (let i = 0; i < 4; i++) tone(1800 + Math.random() * 900, { type: 'triangle', a: 0.001, d: 0.05, r: 0.09, peak: 0.07, cutoff: 6000, t0: i * 0.045 }); },
  page()       { noise(0.28, { freq: 2800, q: 0.8, gain: 0.10, decay: 2.2 }); },
};
