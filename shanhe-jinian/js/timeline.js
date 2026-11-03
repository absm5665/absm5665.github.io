/* ============================================================
   timeline.js — 底部时间轴：拖动、步进、播放
   ============================================================ */

const SPEEDS = [0.5, 1, 2, 4];
const BASE_MS = 1050;

export class Timeline {
  constructor(eras, { onChange } = {}) {
    this.eras = eras;
    this.onChange = onChange || (() => {});
    this.index = 0;
    this.playing = false;
    this.speed = 1;
    this._timer = null;
    this._el = {
      track: document.getElementById('track'),
      ticks: document.getElementById('ticks'),
      marks: document.getElementById('eraMarks'),
      fill: document.getElementById('railFill'),
      knob: document.getElementById('knob'),
      play: document.getElementById('btnPlay'),
      speed: document.getElementById('btnSpeed'),
      back: document.getElementById('btnStepBack'),
      fwd: document.getElementById('btnStepFwd'),
      yearBig: document.getElementById('yearBig'),
      yearLabel: document.getElementById('yearLabel'),
      eraCount: document.getElementById('eraCount'),
    };
    this._build();
    this._bind();
  }

  _pct(i) {
    const n = this.eras.length;
    return n <= 1 ? 0 : (i / (n - 1)) * 100;
  }

  _build() {
    const { ticks, marks } = this._el;
    const n = this.eras.length;
    ticks.innerHTML = '';
    marks.innerHTML = '';
    const step = n > 40 ? 6 : 4;
    this.eras.forEach((e, i) => {
      const d = document.createElement('i');
      if (i % step === 0 || i === n - 1) d.className = 'big';
      d.style.left = this._pct(i) + '%';
      ticks.appendChild(d);

      const mk = document.createElement('i');
      mk.style.left = this._pct(i) + '%';
      marks.appendChild(mk);

      if (i % step === 0 || i === n - 1) {
        const b = document.createElement('b');
        b.style.left = this._pct(i) + '%';
        b.textContent = shortYear(e.year);
        if (i === n - 1) b.style.transform = 'translateX(-90%)';
        ticks.appendChild(b);
      }
    });
    this._el.eraCount.textContent = `共 ${n} 个时代`;
  }

  _bind() {
    const { track, play, speed, back, fwd } = this._el;
    let dragging = false;

    const indexFromX = (clientX) => {
      const r = track.getBoundingClientRect();
      const t = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      return Math.round(t * (this.eras.length - 1));
    };

    const onDown = (ev) => {
      dragging = true;
      try { track.setPointerCapture?.(ev.pointerId); } catch (e) { /* 合成事件无指针 */ }
      this.pause();
      this.setIndex(indexFromX(ev.clientX), { scrub: true });
      track.classList.add('is-drag');
    };
    const onMove = (ev) => {
      if (!dragging) return;
      this.setIndex(indexFromX(ev.clientX), { scrub: true });
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      track.classList.remove('is-drag');
      if (this.onSettle) this.onSettle(this.index, this.eras[this.index]);
    };
    track.addEventListener('pointerdown', onDown);
    track.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);

    play.addEventListener('click', () => this.toggle());
    speed.addEventListener('click', () => {
      const i = SPEEDS.indexOf(this.speed);
      this.speed = SPEEDS[(i + 1) % SPEEDS.length];
      speed.textContent = this.speed + '×';
      if (this.playing) { this.pause(); this.play(); }
    });
    back.addEventListener('click', () => { this.pause(); this.step(-1); });
    fwd.addEventListener('click', () => { this.pause(); this.step(1); });

    window.addEventListener('keydown', (ev) => {
      const tag = (ev.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (ev.key === 'ArrowLeft') { this.pause(); this.step(-1); }
      else if (ev.key === 'ArrowRight') { this.pause(); this.step(1); }
      else if (ev.code === 'Space') { ev.preventDefault(); this.toggle(); }
    });
  }

  setIndex(i, { silent = false, scrub = false } = {}) {
    i = Math.max(0, Math.min(this.eras.length - 1, i));
    const changed = i !== this.index;
    this.index = i;
    const p = this._pct(i);
    this._el.knob.style.left = p + '%';
    this._el.fill.style.width = p + '%';
    const era = this.eras[i];
    this._el.yearBig.textContent = shortYear(era.year);
    this._el.yearLabel.textContent = era.label;
    if (changed && !silent) this.onChange(i, era, { scrub });
    else if (!changed && !silent) this.onChange(i, era, { scrub, same: true });
  }

  step(d) {
    const next = this.index + d;
    if (next < 0) return;
    if (next > this.eras.length - 1) { this.pause(); return; }
    this.setIndex(next);
  }

  play() {
    if (this.playing) return;
    if (this.index >= this.eras.length - 1) this.setIndex(0);
    this.playing = true;
    this._el.play.classList.add('is-playing');
    document.body.classList.add('is-playing');
    const tick = () => {
      if (!this.playing) return;
      const next = this.index + 1;
      if (next > this.eras.length - 1) { this.pause(); return; }
      this.setIndex(next);
      this._timer = setTimeout(tick, BASE_MS / this.speed);
    };
    this._timer = setTimeout(tick, 240);
  }

  pause() {
    this.playing = false;
    clearTimeout(this._timer);
    this._timer = null;
    this._el.play.classList.remove('is-playing');
    document.body.classList.remove('is-playing');
  }

  toggle() { this.playing ? this.pause() : this.play(); }
}

export function shortYear(y) {
  return y < 0 ? `前${-y}` : `${y}`;
}