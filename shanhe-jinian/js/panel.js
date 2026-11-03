/* ============================================================
   panel.js — 左侧卷轴：此刻 / 沿革 / 往来
   ============================================================ */
import { RTYPES } from './relations.js';
import { shortYear } from './timeline.js';

const REGION_LABEL = {
  eastAsia: '东亚', southAsia: '南亚', centralAsia: '中亚·内亚',
  middleEast: '西亚·北非', europe: '欧洲', africa: '非洲', americas: '美洲',
  oceania: '大洋洲·太平洋',
};

export function regionOf(lon, lat) {
  if (lat <= -60) return 'oceania';
  if (lon <= -30 || (lon >= -170 && lat > 55)) return 'americas';
  if (lon >= 110 && lat <= 8) return 'oceania';
  if (lon >= 148) return 'oceania';
  if (lon >= -20 && lon <= 52 && lat <= 22) return 'africa';
  if (lon >= -20 && lon <= 60 && lat > 20 && lat <= 42) return 'middleEast';
  if (lon >= -12 && lon <= 48 && lat > 42 && lat <= 72) return 'europe';
  if (lon >= 60 && lon <= 95 && lat > 28 && lat <= 55) return 'centralAsia';
  if (lon >= 92 && lon <= 150 && lat > 4) return 'eastAsia';
  if (lon >= 28 && lon <= 100 && lat > 42) return 'centralAsia';
  if (lon >= 40 && lon <= 100 && lat > -12 && lat <= 32) return 'southAsia';
  if (lon >= -20 && lon <= 52 && lat > 22) return 'africa';
  if (lon >= 100) return 'eastAsia';
  return 'europe';
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Panel {
  constructor({ onJump, onEvent, onClose } = {}) {
    this.el = document.getElementById('panel');
    this.body = document.getElementById('pBody');
    this.nameEl = document.getElementById('pName');
    this.eraEl = document.getElementById('pEra');
    this.subEl = document.getElementById('pSub');
    this.tabs = document.getElementById('pTabs');
    this.onJump = onJump || (() => {});
    this.onEvent = onEvent || (() => {});
    this.onClose = onClose || (() => {});
    this.ctx = null;
    this.tab = 'now';
    this.tabs.addEventListener('click', (e) => {
      const b = e.target.closest('.tab');
      if (!b) return;
      this.setTab(b.dataset.tab);
    });
    document.getElementById('panelClose').addEventListener('click', () => {
      this.close();
      this.onClose();
    });
    this.body.addEventListener('click', (e) => {
      const j = e.target.closest('[data-jump]');
      if (j) { this.onJump(Number(j.dataset.jump)); return; }
      const ev = e.target.closest('[data-ev]');
      if (ev && this.ctx && this.ctx.affairs) {
        const item = this.ctx.affairs[Number(ev.dataset.ev)];
        if (item) this.onEvent(item);
      }
    });
  }

  close() { this.el.classList.add('is-hidden'); this.ctx = null; }
  isOpen() { return !this.el.classList.contains('is-hidden'); }

  setTab(tab) {
    this.tab = tab;
    [...this.tabs.children].forEach(b => b.classList.toggle('is-on', b.dataset.tab === tab));
    this._renderBody();
  }

  open(ctx) {
    this.ctx = ctx;
    this.el.classList.remove('is-hidden');
    this._renderHead();
    this._renderBody();
  }

  update(ctx) {
    this.ctx = ctx;
    if (!this.isOpen()) return;
    this._renderHead();
    this._renderBody();
  }

  _renderHead() {
    const c = this.ctx;
    this.eraEl.textContent = c.era.label;
    const head = c.place ? c.place.zh : (c.zh || c.name || '—');
    this.nameEl.textContent = head;
    this.nameEl.style.fontSize = head.length > 9 ? '21px' : '27px';
    const bits = [];
    if (c.place) bits.push('城址');
    if (c.place && (c.zh || c.name)) bits.push(c.zh || c.name);
    if (c.entity && c.entity.k) bits.push(c.entity.k);
    if (c.span) bits.push(c.span);
    if (c.regionKey) bits.push(REGION_LABEL[c.regionKey] || '');
    if (c.sub) bits.push(c.sub);
    this.subEl.textContent = bits.filter(Boolean).join(' · ') || '　';
  }

  _renderBody() {
    const c = this.ctx;
    if (!c) return;
    let html = '';
    if (this.tab === 'now') html = this._now(c);
    else if (this.tab === 'lineage') html = this._lineage(c);
    else html = this._affairs(c);
    this.body.innerHTML = html;
    this.body.scrollTop = 0;
  }

  _affairRow(ev, i) {
    const t = RTYPES[ev.t] || RTYPES.war;
    return `<div class="affair" data-ev="${i}">
      <div class="hd"><span class="yr">${esc(shortYear(ev.y))}</span>
        <span class="ti">${esc(ev.h)}</span>
        <span class="tag ${t.css}">${esc(t.name)}</span></div>
      <div class="tx">${esc(ev.d || (ev.a + '—' + ev.b))}</div>
    </div>`;
  }

  _now(c) {
    const out = [];
    if (c.place && c.place.note) out.push(`<p class="quote place-note">${esc(c.place.note)}</p>`);
    if (c.note) out.push(`<p class="noindent">${esc(c.note)}</p>`);
    if (c.note2) out.push(`<p>${esc(c.note2)}</p>`);
    if (c.entity && c.entity.k) {
      out.push(`<div class="factrow"><span class="pill">${esc(c.entity.k)}</span>${c.span ? `<span class="pill">${esc(c.span)}</span>` : ''}${c.regionKey ? `<span class="pill">${esc(REGION_LABEL[c.regionKey] || '')}</span>` : ''}</div>`);
    }
    if (c.affairs && c.affairs.length) {
      out.push('<h4>此世的往来</h4>');
      c.affairs.slice(0, 6).forEach((ev, i) => out.push(this._affairRow(ev, i)));
    }
    if (c.eraNote) {
      out.push(`<h4>${esc(c.era.label)}·天下大势</h4>`);
      out.push(`<p class="quote">${esc(c.eraNote)}</p>`);
    }
    if (!out.length) out.push('<p class="muted">此地此世，史笔未及。</p>');
    return out.join('');
  }

  _lineage(c) {
    if (c.lineagePending) return '<p class="muted">正在追溯四十八幅疆域…</p>';
    if (!c.lineage) return '<p class="muted">未择一地。在地球上点一处，或右上「寻一地」，即可见其历世沿革。</p>';
    if (!c.lineage.length) return '<p class="muted">此地未见于载籍。</p>';
    const here = c.place ? c.place.zh : (c.zh || c.name);
    let html = `<p class="noindent muted">${esc(here)}一带，历世归属如下。点一行可跃至其年。</p>`;
    html += '<div class="lin">';
    for (const row of c.lineage) {
      const now = row.key === c.era.key ? ' now' : '';
      const from = shortYear(row.from);
      const to = shortYear(row.to);
      const range = row.from === row.to ? from : `${from}—${to}`;
      const nt = row.kind ? `<div class="nt">${esc(row.kind)}</div>` : '';
      html += `<div class="row${now}" data-jump="${row.index}">
        <div class="yr">${esc(range)}</div>
        <div class="nm">${esc(row.label)}</div>${nt}</div>`;
    }
    html += '</div>';
    return html;
  }

  _affairs(c) {
    if (!c.affairs || !c.affairs.length) {
      return `<p class="muted">此世此地，未记往来。换一个时代，或换一处看看。</p>`;
    }
    let html = '';
    c.affairs.forEach((ev, i) => { html += this._affairRow(ev, i); });
    return html;
  }
}