// Procedural audio. Every sound is synthesized with the Web Audio API —
// noise bursts, filters and envelopes. No sound files exist.

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this.ambientNodes = null;
  }

  // Must be called from a user gesture (click) before anything can play.
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(this.ctx.destination);

    // Shared 2s white-noise buffer, reused by almost every effect.
    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this.startAmbient();
  }

  get ok() {
    return !!this.ctx && this.ctx.state === "running";
  }

  now() { return this.ctx.currentTime; }

  envGain(peak, attack, decay, when = 0) {
    const g = this.ctx.createGain();
    const t = this.now() + when;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }

  noiseSource(duration, when = 0) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const t = this.now() + when;
    src.start(t);
    src.stop(t + duration);
    return src;
  }

  // Distant sounds get quieter and darker.
  distanceChain(dist, maxDist = 60) {
    const g = this.ctx.createGain();
    const k = Math.max(0.04, 1 - dist / maxDist);
    g.gain.value = k * k;
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 800 + k * 7000;
    g.connect(lp);
    lp.connect(this.master);
    return g;
  }

  // ---------------- Weapons ----------------

  gunshot(kind = "rifle", dist = 0) {
    if (!this.ok) return;
    const out = dist > 1 ? this.distanceChain(dist) : this.master;

    const profiles = {
      rifle:   { peak: 0.55, decay: 0.16, freq: 1200, thump: 90,  thumpPeak: 0.5 },
      pistol:  { peak: 0.42, decay: 0.10, freq: 1700, thump: 130, thumpPeak: 0.35 },
      shotgun: { peak: 0.75, decay: 0.30, freq: 700,  thump: 65,  thumpPeak: 0.7 },
      enemy:   { peak: 0.4,  decay: 0.14, freq: 1000, thump: 95,  thumpPeak: 0.4 },
    };
    const p = profiles[kind] || profiles.rifle;

    // Crack: filtered noise burst.
    const n = this.noiseSource(p.decay + 0.05);
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(p.freq * 2.2, this.now());
    bp.frequency.exponentialRampToValueAtTime(p.freq * 0.5, this.now() + p.decay);
    bp.Q.value = 0.7;
    const ng = this.envGain(p.peak, 0.002, p.decay);
    n.connect(bp); bp.connect(ng); ng.connect(out);

    // Thump: sine drop for body.
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(p.thump * 2.4, this.now());
    osc.frequency.exponentialRampToValueAtTime(p.thump * 0.6, this.now() + 0.12);
    const og = this.envGain(p.thumpPeak, 0.002, 0.14);
    osc.connect(og); og.connect(out);
    osc.start(); osc.stop(this.now() + 0.2);
  }

  dryFire() {
    if (!this.ok) return;
    this.click(1400, 0.05, 0.12);
  }

  click(freq, dur, peak, when = 0) {
    const osc = this.ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = freq;
    const g = this.envGain(peak, 0.001, dur, when);
    osc.connect(g); g.connect(this.master);
    const t = this.now() + when;
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  reload(kind = "rifle") {
    if (!this.ok) return;
    // mag out, mag in, bolt
    this.click(700, 0.04, 0.20, 0.00);
    this.click(500, 0.05, 0.24, kind === "shotgun" ? 0.35 : 0.55);
    this.click(1100, 0.05, 0.26, kind === "shotgun" ? 0.6 : 1.0);
  }

  weaponSwitch() {
    if (!this.ok) return;
    this.click(900, 0.04, 0.15, 0);
    this.click(1250, 0.03, 0.12, 0.09);
  }

  // ---------------- Feedback ----------------

  hitmarker(head) {
    if (!this.ok) return;
    const osc = this.ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = head ? 1750 : 1250;
    const g = this.envGain(0.22, 0.001, 0.07);
    osc.connect(g); g.connect(this.master);
    osc.start(); osc.stop(this.now() + 0.1);
  }

  impact(dist) {
    if (!this.ok) return;
    const out = this.distanceChain(dist, 40);
    const n = this.noiseSource(0.06);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 2400;
    const g = this.envGain(0.3, 0.001, 0.05);
    n.connect(lp); lp.connect(g); g.connect(out);
  }

  playerHurt() {
    if (!this.ok) return;
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(220, this.now());
    osc.frequency.exponentialRampToValueAtTime(70, this.now() + 0.18);
    const g = this.envGain(0.4, 0.003, 0.2);
    osc.connect(g); g.connect(this.master);
    osc.start(); osc.stop(this.now() + 0.25);
  }

  enemyDie(dist) {
    if (!this.ok) return;
    const out = this.distanceChain(dist, 70);
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(160 + Math.random() * 60, this.now());
    osc.frequency.exponentialRampToValueAtTime(40, this.now() + 0.4);
    const g = this.envGain(0.5, 0.005, 0.42);
    osc.connect(g); g.connect(out);
    osc.start(); osc.stop(this.now() + 0.5);
    // body drop
    const n = this.noiseSource(0.12, 0.28);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 500;
    const ng = this.envGain(0.35, 0.004, 0.1, 0.28);
    n.connect(lp); lp.connect(ng); ng.connect(out);
  }

  footstep(sprinting) {
    if (!this.ok) return;
    const n = this.noiseSource(0.07);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 380 + Math.random() * 160;
    const g = this.envGain(sprinting ? 0.16 : 0.10, 0.004, 0.06);
    n.connect(lp); lp.connect(g); g.connect(this.master);
  }

  jump() {
    if (!this.ok) return;
    this.click(300, 0.06, 0.1);
  }

  land() {
    if (!this.ok) return;
    const n = this.noiseSource(0.09);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 300;
    const g = this.envGain(0.25, 0.003, 0.08);
    n.connect(lp); lp.connect(g); g.connect(this.master);
  }

  waveStart() {
    if (!this.ok) return;
    const notes = [196, 262, 392];
    notes.forEach((f, i) => {
      const osc = this.ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = f;
      const g = this.envGain(0.22, 0.01, 0.5, i * 0.12);
      osc.connect(g); g.connect(this.master);
      const t = this.now() + i * 0.12;
      osc.start(t); osc.stop(t + 0.6);
    });
  }

  gameOver() {
    if (!this.ok) return;
    const notes = [330, 262, 196, 131];
    notes.forEach((f, i) => {
      const osc = this.ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = f;
      const g = this.envGain(0.18, 0.02, 0.6, i * 0.22);
      osc.connect(g); g.connect(this.master);
      const t = this.now() + i * 0.22;
      osc.start(t); osc.stop(t + 0.7);
    });
  }

  // Low looping wind bed so silence never feels dead.
  startAmbient() {
    if (this.ambientNodes) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 240;
    const g = this.ctx.createGain();
    g.gain.value = 0.045;
    // slow wind swell
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 0.02;
    lfo.connect(lfoGain); lfoGain.connect(g.gain);
    src.connect(lp); lp.connect(g); g.connect(this.master);
    src.start(); lfo.start();
    this.ambientNodes = { src, lfo };
  }
}
