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
    this.volume = 0.34;
    this.proximity = 1;          // 1 = 就在车里，0 = 离得听不见
    this.muted = false;
    this.available = [];               // 每首歌是否找到文件
    this.index = -1;
    this.usingSynth = false;
    this.started = false;
    this.drift = 0;
    this.nextDriftAt = 0;
    this.synthTimer = null;

    this.enabled = true;         // 收音机电源
    this.padTimer = 0;           // 「听不见了」持续了几秒
    this.ambientGain = null;     // 氛围垫音（第二层，很小）
    this.ambientVoices = null;
    this.ambientLfo = null;
    this.ambientLevel = 0.115;
    this.synthVoices = null;
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
    // 中途加载失败（404 / 解码错误）也要能兜住
    this.audio.addEventListener('error', () => {
      if (this.usingSynth) return;
      this.usingSynth = true;
      this.startSynth();
      this.onState(this.state());
    });

    this.input = c.createGain();
    this.input.gain.value = 1.0;

    // 只留一点点暖色。之前那套「小喇叭」窄带 + 削波虽然像收音机，
    // 但把歌压得又薄又刺，听起来比不放还差 —— 现在只做温和的去直流和柔化。
    this.hp = c.createBiquadFilter();
    this.hp.type = 'highpass'; this.hp.frequency.value = 52; this.hp.Q.value = 0.7;

    this.lp = c.createBiquadFilter();
    this.lp.type = 'lowpass'; this.lp.frequency.value = 15000; this.lp.Q.value = 0.62;

    this.pre = c.createGain(); this.pre.gain.value = 1.0;

    this.out = c.createGain();
    this.out.gain.value = 0;                 // 由 fadeIn 拉起
    this.out.connect(this.dest);

    this.input.connect(this.hp);
    this.hp.connect(this.lp);
    this.lp.connect(this.pre);
    this.pre.connect(this.out);

    // 电源哼声（滤过之后才加，才不会被高通削掉）
    const hum = c.createOscillator();
    hum.type = 'sine'; hum.frequency.value = 100;
    const humG = c.createGain(); humG.gain.value = 0.0016;
    hum.connect(humG); humG.connect(this.out); hum.start();
    this.hum = hum; this.humG = humG;

    // 常驻底噪：带通噪声像调不准的载波
    const noise = c.createBufferSource();
    noise.buffer = this._noiseBuf || this._makeNoise();
    noise.loop = true;
    const nb = c.createBiquadFilter();
    nb.type = 'bandpass'; nb.frequency.value = 2350; nb.Q.value = 0.62;
    const ng = c.createGain(); ng.gain.value = 0.0045;
    noise.connect(nb); nb.connect(ng); ng.connect(this.input);
    noise.start();
    this.noiseBp = nb; this.noiseGain = ng;

    this.srcNode = c.createMediaElementSource(this.audio);
    this.srcNode.connect(this.input);

    // 电平探针（接在输出上，只做分析，不影响声音）
    this.analyser = c.createAnalyser();
    this.analyser.fftSize = 2048;
    this.out.connect(this.analyser);
    this._buf = new Float32Array(this.analyser.fftSize);

    this.started = true;
  }

  /** 当前输出电平（RMS）。0 表示完全没声。 */
  level() {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this._buf);
    let s = 0;
    for (let i = 0; i < this._buf.length; i++) s += this._buf[i] * this._buf[i];
    return Math.sqrt(s / this._buf.length);
  }

  async ensureRunning() {
    if (!this.ctx) return false;
    if (this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch (e) { /* 需要用户手势 */ }
    }
    return this.ctx.state === 'running';
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
  _audioType(ct) {
    const s = (ct || '').toLowerCase();
    return s.startsWith('audio/') || s.startsWith('video/') || s === 'application/octet-stream';
  }

  /** HEAD 优先，服务器不支持 HEAD 时退到 Range GET。
   *  每个请求都带超时：探测请求挂住会让整条播放流程卡死。 */
  async _probe(url, timeoutMs = 4000) {
    const timeout = (p) => new Promise((resolve) => {
      let done = false;
      const timer = setTimeout(() => { if (!done) { done = true; resolve(null); } }, timeoutMs);
      p.then(v => { if (!done) { done = true; clearTimeout(timer); resolve(v); } })
        .catch(() => { if (!done) { done = true; clearTimeout(timer); resolve(null); } });
    });

    const head = await timeout(fetch(url, { method: 'HEAD', cache: 'no-store' }));
    if (head && head.ok) {
      const ct = head.headers.get('content-type');
      if (!ct || this._audioType(ct)) return true;
    }
    // 明确说不存在就别再试 GET；只有服务器不认 HEAD 才退到 GET
    if (head && head.status !== 405 && head.status !== 501) return false;

    const get = await timeout(fetch(url, { method: 'GET', headers: { Range: 'bytes=0-1' }, cache: 'no-store' }));
    if (get && (get.ok || get.status === 206) && this._audioType(get.headers.get('content-type'))) return true;
    return false;
  }

  /** 并发受限地探测一串候选：最多同时 3 个，命中即停 */
  async _probeFirst(cands, limit = 3) {
    let cursor = 0;
    let hit = null;
    const worker = async () => {
      while (cursor < cands.length) {
        if (hit) return;
        const url = cands[cursor++];
        const ok = await this._probe(url).catch(() => false);
        if (ok && !hit) { hit = url; return; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, cands.length) }, () => worker()));
    return hit;
  }

  /**
   * 轻量探测：每首只试最可能的几个路径，而且并行发出去 ——
   * 串行探测在网络差的时候会慢到不可用。
   */
  async detect() {
    const out = new Array(PLAYLIST.length).fill(null);
    let cursor = 0;
    const worker = async () => {
      while (cursor < PLAYLIST.length) {
        const i = cursor++;
        const url = `music/${PLAYLIST[i].slug}.mp3`;
        out[i] = (await this._probe(url).catch(() => false)) ? url : null;
      }
    };
    // 3 路并发：够快，又不会把服务器和 GPU 一起顶崩
    await Promise.all([worker(), worker(), worker()]);
    this.available = out;
    this.onState(this.state());
    return this.available;
  }

  /** 点歌时补齐探测：并行试所有候选，谁先命中用谁 */
  async resolve(i) {
    const s = PLAYLIST[i];
    if (!s) return null;
    if (this.available[i]) return this.available[i];

    const cands = [];
    for (const e of ['mp3', 'm4a', 'wav', 'ogg']) {
      cands.push(`music/${s.slug}.${e}`);
      cands.push(`music/${encodeURIComponent(s.raw)}.${e}`);
    }
    cands.push(`music/${s.n}.mp3`);
    cands.push(`music/${s.n}.m4a`);

    const hit = await this._probeFirst(cands, 3);
    if (hit) {
      this.available[i] = hit;
      this.onState(this.state());
    }
    return hit;
  }

  /** 用户在界面里直接选本地文件（不经过服务器，绕开目录探测） */
  setLocalFiles(fileList) {
    const files = Array.from(fileList || []).filter(f =>
      /^audio\//.test(f.type) || /\.(mp3|m4a|ogg|wav|flac|opus|aac|mp4)$/i.test(f.name)
    );
    if (!files.length) return 0;

    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
    let matched = 0;

    files.forEach((f, k) => {
      const base = norm(f.name.replace(/\.[^.]+$/, ''));
      let idx = PLAYLIST.findIndex(s => norm(s.slug) === base || norm(s.raw) === base);
      if (idx < 0) idx = PLAYLIST.findIndex(s => base.includes(norm(s.raw)) || norm(s.raw).includes(base));
      if (idx < 0) idx = files.length === 1 ? (this.index >= 0 ? this.index : 0) : k;
      if (idx < 0 || idx >= PLAYLIST.length) return;

      if (this.available[idx] && this.available[idx].startsWith('blob:')) {
        try { URL.revokeObjectURL(this.available[idx]); } catch (e) {}
      }
      this.available[idx] = URL.createObjectURL(f);
      matched++;
    });

    this.onState(this.state());
    return matched;
  }

  /** 离车距离：1 = 就在车里，0 = 完全听不见 */
  setProximity(p) {
    this.proximity = Math.max(0, Math.min(1, p));
  }

  _targetGain() {
    if (!this.enabled || this.muted) return 0;
    return this.volume * this.proximity;
  }

  state() {
    const s = PLAYLIST[this.index] || null;
    return {
      index: this.index,
      track: s,
      available: this.available.slice(),
      muted: this.muted,
      enabled: this.enabled,
      usingSynth: this.usingSynth,
      playing: this.started && this.out && this.out.gain.value > 0.001,
      volume: this.volume,
    };
  }

  /** 播放一个具体的音频 URL；任何失败都退回垫音 */
  async _playFile(url) {
    this.stopSynth();
    this.usingSynth = false;
    try {
      if (this.audio.src !== url) this.audio.src = url;
      this.audio.currentTime = 0;
      this.audio.volume = 1;
      await this.audio.play();
      return true;
    } catch (e) {
      console.warn('radio: 原曲放不出来，改用垫音', e && e.message);
      this.usingSynth = true;
      try { this.startSynth(); } catch (e2) {}
      this.onState(this.state());
      return false;
    }
  }

  /* ---------- 播放 / 切台 ---------- */
  async play(i, opts = {}) {
    if (!this.started) this.init();
    if (!this.ctx) return false;

    const idx = ((i % PLAYLIST.length) + PLAYLIST.length) % PLAYLIST.length;
    let running = true;
    try {
      running = await this.ensureRunning();
    } catch (e) { /* 忽略 */ }

    try {
      this.tuneSweep();
    } catch (e) {
      console.warn('radio: tuneSweep 失败', e);
    }

    this.index = idx;
    this.onState(this.state());          // 指针先动，不等音频

    const known = (this.available && this.available[idx]) || null;

    if (known) {
      await this._playFile(known);
    } else {
      // 没有已知文件：先把垫音放起来（点一下立刻有声），
      // 后台再去找文件，找到就切过去 —— 绝不把播放卡在探测上。
      if (this.audio) { try { this.audio.pause(); } catch (e) {} }
      this.usingSynth = true;
      this.startSynth();

      if (!opts.skipProbe) {
        this.resolve(idx).then((url) => {
          if (!url || this.index !== idx) return;
          this._playFile(url);
        }).catch(() => { /* 探测失败就继续垫音 */ });
      }
    }

    // 扫台之后把输出拉回正常。
    // 这里必须显式打一个 setValueAtTime 锚点：只靠 cancelAndHoldAtTime 的话，
    // 后面的 linearRamp 在 Chromium 上可能没有起点，增益会一直卡在压台值上。
    const t = this.ctx.currentTime;
    const target = this._targetGain();
    const g = this.out.gain;
    if (typeof g.cancelAndHoldAtTime === 'function') {
      g.cancelAndHoldAtTime(t);
    } else {
      g.cancelScheduledValues(t);
    }
    g.setValueAtTime(Math.max(0.0001, g.value), t);
    g.linearRampToValueAtTime(target, t + 0.8);
    this._holdUntil = t + 0.85;

    this.onState(this.state());
    return running;
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
    this._holdUntil = t + 0.1;

    setTimeout(() => { try { src.disconnect(); bp.disconnect(); g.disconnect(); } catch (e) {} }, 900);
  }

  /* ---------- 合成垫音（无音频文件时的兜底） ---------- */
  startSynth() {
    this.stopSynth();
    const c = this.ctx;
    if (!c) return;

    // Am – F – C – G，缓慢循环；整组放在 220–660 Hz，正好落在小喇叭的通带里
    // （再低就会被 178 Hz 高通吃掉，垫音就几乎听不见了）
    const chords = [
      [220.00, 329.63, 523.25],
      [174.61, 261.63, 440.00],
      [261.63, 392.00, 659.26],
      [196.00, 293.66, 493.88],
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
        layer.push(voice(f, k === 2 ? 'triangle' : 'sine', (Math.random() - 0.5) * 9, 0.19 / (1 + k * 0.5)));
      });
      // 低音层：用根音本身（再低会被 52 Hz 高通吃掉）
      layer.push(voice(ch[0], 'triangle', -6, 0.13));

      const dur = 7.4;
      layer.forEach((v) => {
        v.g.gain.setValueAtTime(0.0001, t);
        v.g.gain.linearRampToValueAtTime(v.base, t + 1.9);
        v.g.gain.setValueAtTime(v.base, t + dur - 1.7);
        v.g.gain.linearRampToValueAtTime(0.0001, t + dur);
      });

      this.synthVoices = layer;
      setTimeout(() => {
        layer.forEach((v) => { try { v.o.stop(); v.o.disconnect(); v.g.disconnect(); } catch (e) {} });
        if (this.synthVoices === layer) this.synthVoices = null;
      }, (dur + 0.4) * 1000);

      step++;
      this.synthTimer = setTimeout(play, dur * 1000 * 0.86);
    };
    play();
  }

  stopSynth() {
    if (this.synthTimer) { clearTimeout(this.synthTimer); this.synthTimer = null; }
    // 正在响的那一批快速淡出，避免关机/重开时两批垫音叠在一起
    if (this.synthVoices && this.synthVoices.length && this.ctx) {
      const t = this.ctx.currentTime;
      const vs = this.synthVoices;
      this.synthVoices = null;
      vs.forEach((v) => {
        try {
          v.g.gain.cancelScheduledValues(t);
          v.g.gain.setTargetAtTime(0, t, 0.10);
        } catch (e) {}
      });
      setTimeout(() => {
        vs.forEach((v) => { try { v.o.stop(); v.o.disconnect(); v.g.disconnect(); } catch (e) {} });
      }, 800);
    }
  }

  /* ---------- 氛围垫音：人走远了以后补一层很轻的底 ---------- */
  startAmbient() {
    if (this.ambientGain || !this.ctx || !this.enabled) return;
    const c = this.ctx, t = c.currentTime;

    const g = c.createGain();
    g.gain.value = 0;
    g.connect(this.dest);

    const lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 2400; lp.Q.value = 0.4;
    lp.connect(g);

    // 三个很轻的高音，缓慢起伏，不抢环境音
    const voices = [329.63, 440.00, 493.88].map((f, i) => {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.detune.value = (Math.random() - 0.5) * 14;
      const vg = c.createGain();
      vg.gain.value = 0.34 / (i + 1.8);
      o.connect(vg); vg.connect(lp);
      o.start();
      return o;
    });

    const lfo = c.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.043;
    const lg = c.createGain();
    lg.gain.value = 0.011;
    lfo.connect(lg); lg.connect(g.gain);
    lfo.start();

    g.gain.setTargetAtTime(this.ambientLevel, t, 2.4);   // 慢慢浮上来

    this.ambientGain = g;
    this.ambientVoices = voices;
    this.ambientLfo = lfo;
  }

  stopAmbient() {
    if (!this.ambientGain) return;
    const g = this.ambientGain, voices = this.ambientVoices, lfo = this.ambientLfo;
    const t = this.ctx ? this.ctx.currentTime : 0;
    this.ambientGain = null;
    this.ambientVoices = null;
    this.ambientLfo = null;
    try { g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(0, t, 0.9); } catch (e) {}
    setTimeout(() => {
      try {
        voices && voices.forEach(o => { try { o.stop(); o.disconnect(); } catch (e) {} });
        lfo && (lfo.stop(), lfo.disconnect());
        g.disconnect();
      } catch (e) {}
    }, 3500);
  }

  /* ---------- 每帧：信号漂移 / 偶发失谐 ---------- */
  update(dt) {
    if (!this.started || !this.ctx) return;
    const t = this.ctx.currentTime;

    // 保险：输出增益如果莫名停在低位（自动化事件没接上），把它拉回来。
    // 扫台和跌落有自己的时间窗，窗口内不动。
    // 每帧按「离车距离」平滑收放；同时也兜住增益被自动化锁死的异常
    if (t > (this._holdUntil || 0)) {
      const want = this._targetGain();
      if (Math.abs(want - this.out.gain.value) > 0.012) {
        this.out.gain.setTargetAtTime(want, t, 0.2);
      }
    }

    // 氛围垫音：收音机开着、但已经完全听不见了，持续 5 秒后才补一层底。
    // 一走近（proximity 回升）立刻撤掉。
    if (this.enabled && this.proximity < 0.10) {
      this.padTimer += dt || 0;
      if (this.padTimer > 5 && !this.ambientGain) this.startAmbient();
    } else {
      this.padTimer = 0;
      if (this.ambientGain) this.stopAmbient();
    }

    if (t > this.nextDriftAt) {
      this.nextDriftAt = t + 0.25 + Math.random() * 0.5;
      this.drift += (Math.random() - 0.5) * 0.28;
      this.drift = clamp(this.drift * 0.94, -1, 1);

      this.lp.frequency.setTargetAtTime(15000 + this.drift * 1400, t, 0.8);
      this.hp.frequency.setTargetAtTime(52 + this.drift * 7, t, 0.8);
      this.humG.gain.setTargetAtTime(0.0016 + Math.abs(this.drift) * 0.0009, t, 0.9);

      // 偶发的信号跌落
      if (Math.random() < 0.004) this.dropout();
    }
  }

  dropout() {
    const c = this.ctx, t = c.currentTime;
    const target = this._targetGain();
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(Math.max(0.0001, this.out.gain.value), t);
    this.out.gain.linearRampToValueAtTime(target * 0.16, t + 0.09);
    const back = 0.16 + Math.random() * 0.42;
    this.out.gain.linearRampToValueAtTime(target * 0.55, t + back);
    this.out.gain.linearRampToValueAtTime(target, t + back + 0.30);
    this._holdUntil = t + back + 0.35;
  }

  /** 电源开关。关掉 = 没有音乐也没有垫音，只剩环境音。 */
  setEnabled(on) {
    this.enabled = !!on;
    if (!this.ctx) { this.onState(this.state()); return; }

    if (!this.enabled) {
      if (this.audio) { try { this.audio.pause(); } catch (e) {} }
      this.stopSynth();
      this.stopAmbient();
      this.padTimer = 0;
      this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.22);
    } else {
      // 开机：记住的台就继续，没有就停在「未选台」放垫音
      if (this.index >= 0) {
        this.play(this.index, { skipProbe: true });
      } else {
        this.standby();
      }
      this.out.gain.setTargetAtTime(this._targetGain(), this.ctx.currentTime, 0.5);
    }
    this.onState(this.state());
  }

  /** 开机但没选台：只放垫音（音量和其他音乐一样大） */
  async standby() {
    if (!this.started) this.init();
    if (!this.ctx) return;
    await this.ensureRunning();
    this.index = -1;
    if (this.audio) { try { this.audio.pause(); } catch (e) {} }
    this.usingSynth = true;
    this.startSynth();
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(Math.max(0.0001, this.out.gain.value), t);
    this.out.gain.linearRampToValueAtTime(this._targetGain(), t + 1.2);
    this._holdUntil = t + 1.25;
    this.onState(this.state());
  }

  setMuted(m) {
    this.muted = m;
    if (this.out && this.ctx) {
      this.out.gain.setTargetAtTime(this._targetGain(), this.ctx.currentTime, 0.18);
    }
    this.onState(this.state());
  }

  setVolume(v) {
    this.volume = clamp(v, 0, 1);
    if (this.out && this.ctx && !this.muted) {
      this.out.gain.setTargetAtTime(this._targetGain(), this.ctx.currentTime, 0.15);
    }
    this.onState(this.state());
  }

  fadeIn() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(0.0001, t);
    this.out.gain.linearRampToValueAtTime(this._targetGain(), t + 2.6);
    this._holdUntil = t + 2.7;   // 别让 update 的兜底抢在渐入之前
  }
}
