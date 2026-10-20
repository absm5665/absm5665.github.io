/* ============================================================
   老收音机 · Radio

   设计说明
   ----------
   1. 播放列表是用户给的那七首。音频文件本身不在仓库里（版权原因），
      页面会去 music/ 目录找同名文件；找到就用，找不到就退回到
      一段程序生成的「深夜电台」垫音 —— 这样打开永远有声音。
   2. 所有声音都过一条模拟老收音机的信号链：
      窄带（小喇叭）→ 中频凸起 → 软削波 → 电源哼声 + 嘶声 →
      随机的信号漂移与瞬间失谐。
   3. 每首歌占一个「电台频率」，切歌时会有一次扫台噪声。
   ============================================================ */

export const PLAYLIST = [
  { n: '01', freq: 96.4,  title: 'Summer Vibe (Album Version)', artist: 'Walk off the Earth',      slug: '01-summer-vibe',                      raw: 'Summer Vibe (Album Version)' },
  { n: '02', freq: 101.7, title: 'Mystery of Love',             artist: 'Sufjan Stevens',          slug: '02-mystery-of-love',                  raw: 'Mystery of Love' },
  { n: '03', freq: 88.9,  title: 'The Hell Song',               artist: 'Dream Tunes',             slug: '03-the-hell-song',                    raw: 'The Hell Song' },
  { n: '04', freq: 104.3, title: 'Chemtrails Over The Country Club', artist: 'Lana Del Rey',       slug: '04-chemtrails-over-the-country-club', raw: 'Chemtrails Over The Country Club' },
  { n: '05', freq: 92.1,  title: 'So Far Away (Acoustic)',      artist: 'Adam Christopher',        slug: '05-so-far-away-acoustic',             raw: 'So Far Away (Acoustic)' },
  { n: '06', freq: 99.5,  title: 'Closure',                     artist: 'Sarcastic Sounds / Birdy', slug: '06-closure',                         raw: 'Closure' },
  { n: '07', freq: 107.1, title: 'Things You Said',             artist: 'Cody Fry / Abby Cates',   slug: '07-things-you-said',                  raw: 'Things You Said' },
];

const EXTS = ['mp3', 'm4a', 'ogg', 'wav', 'flac', 'opus', 'aac'];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* 软削波曲线：模拟纸盆喇叭过载 */
function softClipCurve(amount = 1.8, n = 1024) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return c;
}

export class Radio {
  constructor(opts = {}) {
    this.ctx = opts.ctx;
    this.dest = opts.destination;      // 通常是 Sound.master
    this.onState = opts.onState || (() => {});
    this.volume = 0.62;
    this.muted = false;
    this.available = [];               // 每首歌是否找到文件
    this.index = -1;
    this.usingSynth = false;
    this.started = false;
    this.drift = 0;
    this.nextDriftAt = 0;
    this.synthTimer = null;
  }

  /* ---------- 初始化信号链 ---------- */
  attach(ctx, dest) {
    this.ctx = ctx;
    this.dest = dest;
    this.init();
  }

  init() {
    if (this.started || !this.ctx) return;
    const c = this.ctx;

    this.audio = new Audio();
    this.audio.loop = true;
    this.audio.preload = 'auto';

    this.input = c.createGain();
    this.input.gain.value = 1.0;

    this.hp = c.createBiquadFilter();
    this.hp.type = 'highpass'; this.hp.frequency.value = 178; this.hp.Q.value = 0.70;

    this.lp = c.createBiquadFilter();
    this.lp.type = 'lowpass'; this.lp.frequency.value = 3480; this.lp.Q.value = 1.05;

    // 中频凸起：老喇叭最典型的一笔
    this.pk = c.createBiquadFilter();
    this.pk.type = 'peaking'; this.pk.frequency.value = 1380; this.pk.Q.value = 0.85; this.pk.gain.value = 7.5;

    this.pre = c.createGain(); this.pre.gain.value = 0.5;

    this.shaper = c.createWaveShaper();
    this.shaper.curve = softClipCurve(1.7);
    this.shaper.oversample = '2x';

    this.out = c.createGain();
    this.out.gain.value = 0;                 // 由 fadeIn 拉起
    this.out.connect(this.dest);

    this.input.connect(this.hp);
    this.hp.connect(this.lp);
    this.lp.connect(this.pk);
    this.pk.connect(this.pre);
    this.pre.connect(this.shaper);
    this.shaper.connect(this.out);

    // 电源哼声（滤过之后才加，才不会被高通削掉）
    const hum = c.createOscillator();
    hum.type = 'sine'; hum.frequency.value = 100;
    const humG = c.createGain(); humG.gain.value = 0.0045;
    hum.connect(humG); humG.connect(this.out); hum.start();
    this.hum = hum; this.humG = humG;

    // 常驻底噪：带通噪声像调不准的载波
    const noise = c.createBufferSource();
    noise.buffer = this._noiseBuf || this._makeNoise();
    noise.loop = true;
    const nb = c.createBiquadFilter();
    nb.type = 'bandpass'; nb.frequency.value = 2350; nb.Q.value = 0.62;
    const ng = c.createGain(); ng.gain.value = 0.016;
    noise.connect(nb); nb.connect(ng); ng.connect(this.input);
    noise.start();
    this.noiseBp = nb; this.noiseGain = ng;

    this.srcNode = c.createMediaElementSource(this.audio);
    this.srcNode.connect(this.input);

    this.started = true;
  }

  _makeNoise() {
    const c = this.ctx;
    const len = Math.floor(c.sampleRate * 2.4);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = last * 0.30 + w * 0.70;      // 轻微低通，听起来更像电子噪声
      d[i] = last;
    }
    this._noiseBuf = buf;
    return buf;
  }

  /* ---------- 找 music/ 里的文件 ---------- */
  async detect() {
    this.available = [];
    for (let i = 0; i < PLAYLIST.length; i++) {
      const s = PLAYLIST[i];
      let found = null;
      const cands = [];
      for (const e of EXTS) cands.push(`music/${s.slug}.${e}`);
      for (const e of EXTS) cands.push(`music/${encodeURIComponent(s.raw)}.${e}`);
      for (const e of EXTS) cands.push(`music/${s.n}.${e}`);

      for (const url of cands) {
        try {
          const r = await fetch(url, { method: 'HEAD', cache: 'no-store' });
          if (r.ok) { found = url; break; }
        } catch (e) { /* 忽略：跨域或 file:// 都可能失败 */ }
      }
      this.available[i] = found;
    }
    this.onState(this.state());
    return this.available;
  }

  state() {
    const s = PLAYLIST[this.index] || null;
    return {
      index: this.index,
      track: s,
      available: this.available.slice(),
      muted: this.muted,
      usingSynth: this.usingSynth,
      playing: this.started && this.out && this.out.gain.value > 0.001,
      volume: this.volume,
    };
  }

  /* ---------- 播放 / 切台 ---------- */
  async play(i) {
    if (!this.started) this.init();
    if (!this.ctx) return;
    const idx = ((i % PLAYLIST.length) + PLAYLIST.length) % PLAYLIST.length;

    if (this.ctx.state === 'suspended') { try { await this.ctx.resume(); } catch (e) {} }

    this.tuneSweep();
    this.index = idx;

    const url = this.available && this.available[idx];
    if (url) {
      // 有文件：切到真实音频
      this.stopSynth();
      this.usingSynth = false;
      try {
        this.audio.src = url;
        this.audio.currentTime = 0;
        await this.audio.play();
      } catch (e) {
        // 自动播放被拦或解码失败 → 退到合成垫音
        this.usingSynth = true;
        this.startSynth();
      }
    } else {
      // 没文件：合成垫音
      try { this.audio.pause(); } catch (e) {}
      this.usingSynth = true;
      this.startSynth();
    }

    // 主输出在扫台后回到正常
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(Math.max(0.0001, this.out.gain.value), t);
    this.out.gain.linearRampToValueAtTime(this.muted ? 0 : this.volume, t + 0.75);

    this.onState(this.state());
  }

  next() { this.play(this.index + 1); }
  prev() { this.play(this.index - 1); }

  /* 扫台：一段飞过去的带通噪声 */
  tuneSweep() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this._noiseBuf || this._makeNoise();
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 5.5;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(4300, t + 0.40);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.10, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    src.connect(bp); bp.connect(g); g.connect(this.dest);
    src.start(t); src.stop(t + 0.62);

    // 输出的瞬间塌陷
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(Math.max(0.0001, this.out.gain.value), t);
    this.out.gain.linearRampToValueAtTime(0.10, t + 0.06);

    setTimeout(() => { try { src.disconnect(); bp.disconnect(); g.disconnect(); } catch (e) {} }, 900);
  }

  /* ---------- 合成垫音（无音频文件时的兜底） ---------- */
  startSynth() {
    this.stopSynth();
    const c = this.ctx;
    if (!c) return;

    // Am – F – C – G，缓慢循环；每层三个音，轻微失谐
    const chords = [
      [110.00, 164.81, 261.63],
      [87.31, 130.81, 220.00],
      [130.81, 196.00, 329.63],
      [98.00, 146.83, 246.94],
    ];
    let step = 0;

    const voice = (f, type, detune, gain) => {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = detune;
      const g = c.createGain();
      g.gain.value = 0;
      o.connect(g); g.connect(this.input);
      o.start();
      return { o, g, base: gain };
    };

    const play = () => {
      if (!this.usingSynth || !this.ctx) return;
      const t = c.currentTime;
      const ch = chords[step % chords.length];
      const layer = [];
      ch.forEach((f, k) => {
        layer.push(Object.assign(voice(f, k === 2 ? 'triangle' : 'sine', (Math.random() - 0.5) * 9, 0.09 / (k + 1)), {}));
      });
      // 低音
      layer.push(voice(ch[0] / 2, 'sine', 0, 0.13));

      const dur = 7.4;
      layer.forEach((v) => {
        v.g.gain.setValueAtTime(0.0001, t);
        v.g.gain.linearRampToValueAtTime(v.base, t + 1.9);
        v.g.gain.setValueAtTime(v.base, t + dur - 1.7);
        v.g.gain.linearRampToValueAtTime(0.0001, t + dur);
      });

      setTimeout(() => {
        layer.forEach((v) => { try { v.o.stop(); v.o.disconnect(); v.g.disconnect(); } catch (e) {} });
      }, (dur + 0.4) * 1000);

      step++;
      this.synthTimer = setTimeout(play, dur * 1000 * 0.86);
    };
    play();
  }

  stopSynth() {
    if (this.synthTimer) { clearTimeout(this.synthTimer); this.synthTimer = null; }
  }

  /* ---------- 每帧：信号漂移 / 偶发失谐 ---------- */
  update(dt) {
    if (!this.started || !this.ctx) return;
    const t = this.ctx.currentTime;

    if (t > this.nextDriftAt) {
      this.nextDriftAt = t + 0.25 + Math.random() * 0.5;
      this.drift += (Math.random() - 0.5) * 0.28;
      this.drift = clamp(this.drift * 0.94, -1, 1);

      this.lp.frequency.setTargetAtTime(3480 + this.drift * 620, t, 0.6);
      this.hp.frequency.setTargetAtTime(178 + this.drift * 34, t, 0.6);
      this.pk.gain.setTargetAtTime(7.5 + this.drift * 1.6, t, 0.7);
      this.humG.gain.setTargetAtTime(0.0045 + Math.abs(this.drift) * 0.0022, t, 0.8);

      // 偶发的信号跌落
      if (Math.random() < 0.018) this.dropout();
    }
  }

  dropout() {
    const c = this.ctx, t = c.currentTime;
    const target = this.muted ? 0 : this.volume;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(Math.max(0.0001, this.out.gain.value), t);
    this.out.gain.linearRampToValueAtTime(target * 0.16, t + 0.09);
    const back = 0.16 + Math.random() * 0.42;
    this.out.gain.linearRampToValueAtTime(target * 0.55, t + back);
    this.out.gain.linearRampToValueAtTime(target, t + back + 0.30);
  }

  setMuted(m) {
    this.muted = m;
    if (this.out && this.ctx) {
      this.out.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.18);
    }
    this.onState(this.state());
  }

  setVolume(v) {
    this.volume = clamp(v, 0, 1);
    if (this.out && this.ctx && !this.muted) {
      this.out.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.15);
    }
    this.onState(this.state());
  }

  fadeIn() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(0.0001, t);
    this.out.gain.linearRampToValueAtTime(this.muted ? 0 : this.volume, t + 2.6);
  }
}
