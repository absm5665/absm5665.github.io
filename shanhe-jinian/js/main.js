/* ============================================================
   main.js — 装配：数据、地球、时间轴、卷轴、标注
   ============================================================ */
import { Globe } from './globe.js';
import { Timeline, shortYear } from './timeline.js';
import { Panel, regionOf } from './panel.js';
import { Relations, RTYPES } from './relations.js';
import { featureAt } from './maprender.js';

const $ = (s) => document.querySelector(s);
const FETCH = (u) => fetch(u, { cache: 'no-cache' }).then(r => {
  if (!r.ok) throw new Error(u + ' ' + r.status);
  return r.json();
});

const S = {
  eras: [],
  idx: 0,
  cache: new Map(),
  names: {},
  entityText: {},
  eraNotes: {},
  regions: {},
  events: [],
  spans: {},
  selected: null,        // {lon,lat}
  labels: null,
  labelPool: new Map(),
  allLoaded: false,
  loadingAll: false,
  lineageReady: false,
  places: [],
};

let globe, timeline, panel, relations;
let tickerTimer = null;

/* ------------------------------------------------------------ boot */
async function boot() {
  const setBar = (p, txt) => {
    $('#loaderBar').style.width = Math.round(p * 100) + '%';
    if (txt) $('#loaderText').textContent = txt;
  };
  setBar(0.05, '正在翻检旧籍…');

  const [erasDoc, names, entText, eraNotes, regions, relationsDoc, spans, placesDoc] = await Promise.all([
    FETCH('data/eras.json'),
    FETCH('data/names_zh.json').catch(() => ({})),
    FETCH('data/entity_text.json').catch(() => ({})),
    FETCH('data/era_notes.json').catch(() => ({})),
    FETCH('data/regions.json').catch(() => ({})),
    FETCH('data/relations.json').catch(() => ({ events: [] })),
    FETCH('data/entity_spans.json').catch(() => ({})),
    FETCH('data/places.json').catch(() => ({ places: [] })),
  ]);
  S.eras = erasDoc.eras;
  S.names = names;
  S.entityText = entText;
  S.eraNotes = eraNotes;
  S.regions = regions;
  S.events = (relationsDoc.events || []).slice().sort((a, b) => a.y - b.y);
  S.spans = spans;
  S.places = placesDoc.places || [];
  setBar(0.18, '正在铺纸研墨…');

  const start = Math.max(0, S.eras.findIndex(e => e.key === '1500'));
  S.idx = start;

  const first = await getEra(S.eras[start].key);
  setBar(0.42, '正在描画海陆…');

  globe = new Globe($('#globe'));
  relations = new Relations(globe.scene);
  await globe.setEra(first, { instant: true });
  setBar(0.78, '正在钤印…');

  timeline = new Timeline(S.eras, { onChange: (i) => applyEra(i) });
  timeline.setIndex(start, { silent: true });

  panel = new Panel({
    onJump: (i) => { timeline.pause(); timeline.setIndex(i); },
    onEvent: (ev) => { if (ev && ev.p) globe.flyTo(ev.p[0][0], ev.p[0][1], { dist: 235, ms: 800 }); },
    onClose: () => {
      S.selected = null; globe.clearSelection(); globe.setPanel(false);
      document.body.classList.remove('panel-open');
      $('#legend').classList.toggle('is-hidden', !(relations && relations.visible));
    },
  });

  layoutLabels();
  const st = $('#subStats');
  if (st) st.textContent = ` · ${S.eras.length} 时代 / ${Object.keys(S.spans).length} 政权 / ${S.events.length} 往来`;
  applyTicker();
  applyRelations(S.idx);
  bindUI();
  setBar(1, '');

  setTimeout(() => {
    $('#loader').classList.add('is-done');
    document.body.classList.add('is-ready');
    openPanel(buildEraCtx());
  }, 260);

  // 后台预取其余时代（沿革、搜索需要）
  prefetchAll();
}

/* ------------------------------------------------------------ data */
/* 原图若干处年代错标，在此校正（不改数据文件）：
   值为字符串 = 改指另一实体（沿用其词条与年代）；值为对象 = 仅改中文显示 */
const FIXUPS = {
  '700': { 'Sui Empire': 'Tang Empire' },       // 原图误标隋，实为武周/唐
  '500': { 'Jin Empire': { zh: '南朝梁' } },      // 原图误标晋，时南朝为梁
};

async function getEra(key) {
  if (S.cache.has(key)) return S.cache.get(key);
  const d = await FETCH('data/map/' + key + '.json');
  const fx = FIXUPS[key];
  if (fx) for (const f of d.features) {
    const v = fx[f.name];
    if (!v) continue;
    if (typeof v === 'string') f.name = v; else f.zh = v.zh;
  }
  S.cache.set(key, d);
  return d;
}

async function prefetchAll() {
  if (S.loadingAll) return;
  S.loadingAll = true;
  const keys = S.eras.map(e => e.key).filter(k => !S.cache.has(k));
  const q = keys.slice();
  const worker = async () => {
    while (q.length) {
      const k = q.shift();
      try { await getEra(k); } catch (e) { /* 忽略 */ }
    }
  };
  await Promise.all([0, 1, 2, 3].map(worker));
  S.loadingAll = false;
  S.allLoaded = true;
  S.lineageReady = true;
  if (S.selected && panel) refreshPanel();
}

/* ------------------------------------------------------------ era */
let eraToken = 0;
async function applyEra(i) {
  S.idx = i;
  const token = ++eraToken;
  const era = S.eras[i];
  const data = await getEra(era.key);
  if (token !== eraToken) return;
  S.labels = null;
  applyTicker();
  applyRelations(i);
  refreshPanel();
  await globe.setEra(data);
}

function windowEvents(i) {
  const cur = S.eras[i].year;
  const prev = i > 0 ? S.eras[i - 1].year : cur - 500;
  const evs = S.events.filter(e => e.y > prev && e.y <= cur);
  if (evs.length) return evs;
  const near = S.events.filter(e => Math.abs(e.y - cur) <= 90);
  near.sort((a, b) => Math.abs(a.y - cur) - Math.abs(b.y - cur));
  return near.slice(0, 7);
}

function applyRelations(i) {
  const evs = windowEvents(i);
  const show = evs.length > 40 ? evs.slice().sort((a, b) => (b.s || 0) - (a.s || 0)).slice(0, 40) : evs;
  relations.show(show, { animate: true });
}

/* ------------------------------------------------------------ labels */
function layoutLabels() {
  globe.onFrame = (dt) => {
    updateLabels();
    if (relations) {
      const cp = globe.camera.position;
      relations.update(dt, timeline && timeline.playing, { x: cp.x / cp.length(), y: cp.y / cp.length(), z: cp.z / cp.length() });
    }
  };
}

const CJK = /[\u3400-\u9fff]/;

function labelCandidates(era) {
  const data = S.cache.get(S.eras[S.idx].key);
  if (!data) return [];
  const seen = new Set();
  const list = [];
  for (const f of data.features) {
    if (f.bg || f.u) continue;
    if (f.area < 2.2) continue;
    if (seen.has(f.name)) continue;
    seen.add(f.name);
    list.push(f);
  }
  list.sort((a, b) => b.area - a.area);
  return list.slice(0, 46);
}

function updateLabels() {
  if (!S.cache.get(S.eras[S.idx].key)) return;
  if (!S.labels) S.labels = labelCandidates();
  const layer = $('#labelLayer');
  const placed = [];
  const mctx = (updateLabels._ctx || (updateLabels._ctx = document.createElement('canvas').getContext('2d')));
  const ppd = globe.pxPerDeg;
  const visible = [];
  const usedZh = new Set();
  const selF = S.selected
    ? featureAt(S.cache.get(S.eras[S.idx].key), S.selected.lon, S.selected.lat) : null;
  const selZh = selF ? (selF.zh || S.names[selF.name] || selF.name) : '';

  for (const f of S.labels) {
    const zh0 = f.zh || S.names[f.name] || f.name;
    if (usedZh.has(zh0)) continue;
    if (selZh && zh0 === selZh) continue;
    const p = globe.project(f.c[0], f.c[1]);
    if (p.facing < 0.30 || p.behind) continue;
    const rad = Math.sqrt(Math.max(0.2, f.area) / Math.PI);
    const rpx = rad * ppd;
    if (rpx < 7.5) continue;
    const size = Math.max(9.5, Math.min(15, 8.2 + rpx * 0.22));
    mctx.font = `${size.toFixed(1)}px "Noto Serif SC","Songti SC","SimSun",serif`;
    const w = mctx.measureText(zh0).width + 6;
    let hit = false;
    for (let i = 0; i < placed.length; i++) {
      const q = placed[i];
      if (Math.abs(p.x - q.x) < (w + q.w) / 2 && Math.abs(p.y - q.y) < 16) { hit = true; break; }
    }
    if (hit) continue;
    placed.push({ x: p.x, y: p.y, w });
    usedZh.add(zh0);
    const zh = zh0;
    const isLatin = !CJK.test(zh);
    visible.push({ f, x: p.x, y: p.y, size, zh, isLatin, op: Math.min(1, (p.facing - 0.30) / 0.22) });
  }

  const keep = new Set();
  for (const v of visible) {
    keep.add(v.f.id);
    let node = S.labelPool.get(v.f.id);
    if (!node) {
      node = document.createElement('div');
      node.className = 'lbl';
      layer.appendChild(node);
      S.labelPool.set(v.f.id, node);
    }
    node.textContent = v.zh;
    node.style.fontSize = v.size.toFixed(1) + 'px';
    node.style.opacity = v.op.toFixed(2);
    const below = v.y < 112 || (v.facing < 0.46 && v.y < globe.height * 0.44);
    node.style.transform = `translate(-50%,${below ? '24%' : '-140%'}) translate(${v.x.toFixed(1)}px,${v.y.toFixed(1)}px)`;
    node.classList.toggle('small', v.size < 11);
    node.classList.toggle('below', below);
    node.dataset.vis = '1';
  }
  for (const [id, node] of S.labelPool) {
    if (!keep.has(id)) { node.remove(); S.labelPool.delete(id); }
  }
  // 选中地块的注记
  if (S.selected) {
    const f = featureAt(S.cache.get(S.eras[S.idx].key), S.selected.lon, S.selected.lat);
    if (f) {
      const p = globe.project(S.selected.lon, S.selected.lat);
      let node = S.labelPool.get('sel');
      if (!node) {
        node = document.createElement('div');
        node.className = 'lbl sel';
        layer.appendChild(node);
        S.labelPool.set('sel', node);
      }
      node.textContent = f.zh || S.names[f.name] || f.name;
      node.style.fontSize = '';
      node.style.opacity = p.facing > 0.1 ? '1' : '0';
      const below = p.y < 112 || (p.facing < 0.46 && p.y < globe.height * 0.44);
      node.style.transform = `translate(-50%,${below ? '24%' : '-140%'}) translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px)`;
      node.classList.toggle('below', below);
    }
  }
}

/* ------------------------------------------------------------ ticker */
function applyTicker() {
  const el = $('#ticker');
  const era = S.eras[S.idx];
  const data = S.cache.get(era.key);
  const nFeat = data ? data.features.filter(f => !f.bg && !f.u).length : 0;
  const nEv = windowEvents(S.idx).length;
  const head = `<div class="ev-hd"><b>${esc(era.label)}</b><span>载籍政权 ${nFeat} · 往来 ${nEv}</span></div>`;
  const evs = windowEvents(S.idx).slice().sort((a, b) => (b.s || 0) - (a.s || 0)).slice(0, 5);
  if (!evs.length) {
    const note = S.eraNotes[era.key];
    el.innerHTML = head + (note ? `<div class="ev"><div class="t">此世大势</div><div class="d">${esc(note)}</div></div>` : '');
    el.onclick = null;
    return;
  }
  el.innerHTML = head + evs.map((ev, i) => {
    const t = RTYPES[ev.t] || RTYPES.war;
    const detail = ev.d ? '：' + ev.d : '';
    return `<div class="ev ${t.css}" data-i="${i}">
      <div class="t"><span class="y">${esc(shortYear(ev.y))}</span>${esc(ev.h)}</div>
      <div class="d">${esc(ev.a)}—${esc(ev.b)}${esc(detail)}</div></div>`;
  }).join('');
  el.onclick = (e) => {
    const n = e.target.closest('.ev[data-i]');
    if (!n) return;
    const ev = evs[Number(n.dataset.i)];
    if (ev && ev.p) {
      timeline.pause();
      globe.flyTo(ev.p[0][0], ev.p[0][1], { dist: 225, ms: 820 });
    }
  };
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ------------------------------------------------------------ panel ctx */
/* 数据集的实体年代取"出现过的快照区间"，对少数大王朝明显偏窄，此处按通行纪年更正 */
const REAL_SPANS = {
  'Han': [-202, 220], 'Han Empire': [-202, 220], 'Qin': [-221, -207],
  'Jin': [265, 420], 'Sui Empire': [581, 618], 'Tang Empire': [618, 907],
  'Song Empire': [960, 1279], 'Mongol Empire': [1206, 1368],
  'Ming Empire': [1368, 1644], 'Ming Chinese Empire': [1368, 1644],
  'Qing Empire': [1644, 1912], 'Manchu Empire': [1644, 1912],
  'Zhou states': [-1046, -256], 'Xia': [-2070, -1600],
};

function spanText(name) {
  const rs = REAL_SPANS[name];
  if (rs) return `${shortYear(rs[0])}—${shortYear(rs[1])}`;
  const sp = S.spans[name];
  if (!sp || !sp.first) return '';
  const a = shortYear(sp.first), b = shortYear(sp.last);
  return sp.first === sp.last ? a : `${a}—${b}`;
}

function buildEraCtx() {
  const era = S.eras[S.idx];
  return {
    era,
    regionKey: null,
    name: '天下',
    zh: '天下',
    note: '点地球上任一地块，可读此地此刻的记载；拨动下方时间轴，可换一世看。',
    note2: S.eraNotes[era.key] || '',
    eraNote: '',
    affairs: windowEvents(S.idx).filter(e => (e.s || 0) >= 2).slice(0, 8),
    lineage: null,
    tab: 'now',
  };
}

function buildPointCtx() {
  const c = _buildPointCtx();
  c.lineagePending = !S.lineageReady;
  return c;
}

function _buildPointCtx() {
  const era = S.eras[S.idx];
  const data = S.cache.get(era.key);
  const { lon, lat } = S.selected;
  const f = data ? featureAt(data, lon, lat) : null;
  const regionKey = regionOf(lon, lat);
  const bucket = 'b' + bucketOf(era.year);
  const regionText = (S.regions[regionKey] || {})[bucket] || '';
  const place = S.selected && S.selected.place ? S.selected.place : null;

  if (!f) {
    return {
      era, regionKey, place, name: '无际之水', zh: '无际之水',
      note: '此处为洋面，未属一邦。', note2: regionText,
      affairs: [], lineage: [], entity: null,
      eraNote: S.eraNotes[era.key] || '',
    };
  }
  const zh = f.zh || S.names[f.name] || f.name;
  const ent = S.entityText[f.name];
  const lineage = S.lineageReady ? buildLineage(lon, lat) : [];
  const affairs = S.events
    .filter(e => e.a === zh || e.b === zh || e.ea === f.name || e.eb === f.name)
    .sort((a, b) => Math.abs(a.y - era.year) - Math.abs(b.y - era.year))
    .slice(0, 14);
  if (f.bg) {
    return {
      era, regionKey, place, name: f.name, zh: '无主之地',
      entity: null,
      note: '此地此时未见于载籍：或为部族游耕之野、或为强邻未及之疆、或为荒漠冰原。',
      note2: regionText,
      span: '', sub: '史籍未详', eraNote: S.eraNotes[era.key] || '',
      affairs, lineage,
    };
  }
  return {
    era, regionKey, place, name: f.name, zh,
    entity: ent ? { k: ent.k, s: ent.s } : null,
    note: ent ? ent.s : regionText,
    note2: ent ? '' : '',
    span: spanText(f.name),
    sub: f.u ? '史籍未详' : '',
    eraNote: S.eraNotes[era.key] || '',
    affairs, lineage,
  };
}

function bucketOf(year) {
  if (year <= -1000) return 0;
  if (year <= -300) return 1;
  if (year <= -1) return 2;
  if (year <= 600) return 3;
  if (year <= 1000) return 4;
  if (year <= 1400) return 5;
  if (year <= 1530) return 6;
  if (year <= 1783) return 7;
  if (year <= 1880) return 8;
  if (year <= 1945) return 9;
  return 10;
}

function buildLineage(lon, lat) {
  const rows = [];
  let cur = null;
  for (let i = 0; i < S.eras.length; i++) {
    const era = S.eras[i];
    const data = S.cache.get(era.key);
    if (!data) continue;
    const f = featureAt(data, lon, lat);
    const name = f ? (f.bg ? '无政权' : (f.zh || S.names[f.name] || f.name)) : '无政权';
    if (cur && cur.name === name && Math.abs(i - cur.lastIdx) <= 2) {
      cur.to = era.year;
      cur.lastIdx = i;
    } else {
      if (cur) rows.push(cur);
      cur = { name, from: era.year, to: era.year, index: i, lastIdx: i, key: era.key };
    }
  }
  if (cur) rows.push(cur);
  return rows.map(r => ({ ...r, label: r.name }));
}

function refreshPanel() {
  if (!panel || !panel.isOpen()) return;
  if (S.selected) panel.update(buildPointCtx());
  else panel.update(buildEraCtx());
}

/* ------------------------------------------------------------ interactions */
function bindUI() {
  const canvas = $('#globe');
  let down = null;

  canvas.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!down) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    const dt = performance.now() - down.t;
    down = null;
    if (Math.hypot(dx, dy) > 6 || dt > 700) return;
    const hit = globe.pickAt(e.clientX, e.clientY);
    if (!hit || !hit.feature) {
      S.selected = null;
      globe.clearSelection();
      openPanel(buildEraCtx());
      return;
    }
    selectPoint(hit.lon, hit.lat, { fly: true });
  });

  let hovT = 0;
  canvas.addEventListener('pointermove', (e) => {
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) {
      $('#tooltip').classList.remove('is-on');
      return;
    }
    const now = performance.now();
    if (now - hovT < 55) return;
    hovT = now;
    const hit = globe.pickAt(e.clientX, e.clientY);
    const tip = $('#tooltip');
    if (hit && hit.feature) {
      const zh = S.names[hit.feature.name] || hit.feature.name;
      tip.textContent = zh;
      tip.style.transform = `translate(${e.clientX + 14}px,${e.clientY - 8}px)`;
      tip.classList.add('is-on');
      canvas.style.cursor = 'pointer';
    } else {
      tip.classList.remove('is-on');
      canvas.style.cursor = 'grab';
    }
  });
  canvas.addEventListener('pointerleave', () => $('#tooltip').classList.remove('is-on'));

  $('#btnRotate').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const on = !btn.classList.contains('is-on');
    btn.classList.toggle('is-on', on);
    globe.setAutoRotate(on);
  });
  $('#btnLayers').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const on = !btn.classList.contains('is-on');
    btn.classList.toggle('is-on', on);
    relations.setVisible(on);
    $('#legend').classList.toggle('is-hidden', !on);
  });
  $('#btnHelp').addEventListener('click', () => $('#helpSheet').classList.remove('is-hidden'));
  $('#helpClose').addEventListener('click', () => $('#helpSheet').classList.add('is-hidden'));
  $('#helpSheet').addEventListener('click', (e) => {
    if (e.target.id === 'helpSheet') $('#helpSheet').classList.add('is-hidden');
  });

  bindSearch();
}

function openPanel(ctx) {
  panel.open(ctx);
  globe.setPanel(true);
  $('#legend').classList.add('is-hidden');
  document.body.classList.add('panel-open');
}

function selectPoint(lon, lat, { fly = false, place = null } = {}) {
  S.selected = { lon, lat, place };
  if (globe.controls && globe.controls.autoRotate) {
    globe.setAutoRotate(false);
    $('#btnRotate').classList.remove('is-on');
  }
  const data = S.cache.get(S.eras[S.idx].key);
  const f = data ? featureAt(data, lon, lat) : null;
  if (f) globe.setSelection([f]);
  else globe.clearSelection();
  if (fly) {
    const c = f ? f.c : [lon, lat];
    globe.flyTo(c[0], c[1], { dist: Math.max(500, Math.min(globe.camera.position.length(), 540)), ms: 760 });
  }
  panel.setTab('now');
  openPanel(buildPointCtx());
}

function placeByEn(en) {
  return (S.places || []).find(p => p.en === en) || null;
}

/* ------------------------------------------------------------ search */
function bindSearch() {
  const input = $('#searchInput');
  const box = $('#searchResults');
  const index = [];
  for (const [en, zh] of Object.entries(S.names)) {
    index.push({ en, zh, kind: 'entity' });
  }
  for (const p of (S.places || [])) {
    index.push({ en: p.en, zh: p.zh, kind: 'place', place: p });
  }
  const HINT = '<div class="r none">试试：长安 / 罗马 / 埃及 / Samarkand</div>';

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { box.innerHTML = HINT; box.classList.add('is-open'); return; }
    const hits = [];
    const seen = new Set();
    // 城址优先
    for (const it of index) {
      if (it.kind !== 'place') continue;
      if (it.zh.includes(q) || it.en.toLowerCase().includes(q)) {
        hits.push(it); seen.add(it.zh);
        if (hits.length >= 4) break;
      }
    }
    for (const it of index) {
      if (it.kind !== 'entity' || seen.has(it.zh)) continue;
      if (it.zh.includes(q) || it.en.toLowerCase().includes(q)) {
        hits.push(it);
        if (hits.length >= 9) break;
      }
    }
    if (!hits.length) {
      box.innerHTML = '<div class="r none">无此记载 — 可试：长安 / 罗马 / 埃及</div>';
      box.classList.add('is-open');
      return;
    }
    box.innerHTML = hits.map((h) => `<div class="r" data-kind="${h.kind}" data-en="${esc(h.en)}"${h.kind === 'place' ? ` data-lon="${h.place.lon}" data-lat="${h.place.lat}"` : ''}><b>${esc(h.zh)}</b><em>${esc(h.en)}${h.kind === 'place' ? ' · 城址' : ''}</em></div>`).join('');
    box.classList.add('is-open');
  });
  input.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    const first = box.querySelector('.r[data-en]');
    if (!first) return;
    if (first.dataset.kind === 'place') {
      box.classList.remove('is-open'); input.blur();
      timeline.pause();
      selectPoint(+first.dataset.lon, +first.dataset.lat, { fly: true, place: placeByEn(first.dataset.en) });
    } else {
      box.classList.remove('is-open'); input.blur();
      await gotoEntity(first.dataset.en);
    }
  });
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('.r[data-en]');
    if (!b) return;
    box.classList.remove('is-open');
    input.blur();
    if (b.dataset.kind === 'place') {
      timeline.pause();
      selectPoint(+b.dataset.lon, +b.dataset.lat, { fly: true, place: placeByEn(b.dataset.en) });
      return;
    }
    await gotoEntity(b.dataset.en);
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search')) box.classList.remove('is-open');
  });
}

async function gotoEntity(en) {
  // 找当前时代或附近时代里叫这个名字的地块
  const order = [];
  for (let d = 0; d < S.eras.length; d++) {
    for (const s of [S.idx + d, S.idx - d]) {
      if (s >= 0 && s < S.eras.length && !order.includes(s)) order.push(s);
    }
  }
  for (const i of order) {
    let data = S.cache.get(S.eras[i].key);
    if (!data) { try { data = await getEra(S.eras[i].key); } catch { continue; } }
    const f = data.features.find(x => x.name === en);
    if (!f) continue;
    if (i !== S.idx) { timeline.pause(); timeline.setIndex(i); await new Promise(r => setTimeout(r, 80)); }
    selectPoint(f.c[0], f.c[1], { fly: true });
    return;
  }
}

/* ------------------------------------------------------------ go */
window.__S = S;
window.__dbg = () => ({ globe, timeline, panel, relations, relItems: relations && relations.items.length });

boot().catch((err) => {
  console.error(err);
  $('#loaderText').textContent = '载入失败：' + err.message;
});