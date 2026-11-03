/* ============================================================
   maprender.js — 把每个时期的地块画到旧纸画布上
   ============================================================ */

export const DEG = Math.PI / 180;

export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 每块地一种极细微的纸色差，避免整片死板 */
export function landTone(name) {
  const h = hashStr(name);
  const hue = 36 + ((h % 11) - 5);
  const sat = 38 + ((h >> 5) % 14);
  const lit = 75 + ((h >> 9) % 6);
  return `hsl(${hue} ${sat}% ${lit}%)`;
}

export function idColor(id) {
  // 唯一且彼此远离的拾取色
  const r = 17 + ((id * 53) % 233);
  const g = 23 + ((id * 97) % 227);
  const b = 31 + ((id * 151) % 219);
  return `rgb(${r},${g},${b})`;
}

/* ---------------------------------------------------------- paper */
function mottle(ctx, W, H, n, rmax, alpha) {
  for (let i = 0; i < n; i++) {
    const x = Math.random() * W, y = Math.random() * H;
    const r = (0.12 + Math.random() * 0.88) * rmax;
    const warm = Math.random() > 0.42;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const a = alpha * (0.35 + Math.random() * 0.65);
    if (warm) {
      g.addColorStop(0, `rgba(126,92,50,${a})`);
      g.addColorStop(0.65, `rgba(126,92,50,${a * 0.32})`);
      g.addColorStop(1, 'rgba(126,92,50,0)');
    } else {
      g.addColorStop(0, `rgba(255,247,224,${a * 0.95})`);
      g.addColorStop(0.65, `rgba(255,247,224,${a * 0.3})`);
      g.addColorStop(1, 'rgba(255,247,224,0)');
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function fibres(ctx, W, H, n, alpha) {
  ctx.save();
  for (let i = 0; i < n; i++) {
    const x = Math.random() * W, y = Math.random() * H;
    const len = 4 + Math.random() * 26;
    const ang = (Math.random() - 0.5) * 0.7;
    ctx.strokeStyle = Math.random() > 0.5
      ? `rgba(120,88,48,${alpha * Math.random()})`
      : `rgba(255,250,232,${alpha * Math.random()})`;
    ctx.lineWidth = 0.6 + Math.random() * 0.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    ctx.stroke();
  }
  ctx.restore();
}

function foxing(ctx, W, H, n, alpha) {
  for (let i = 0; i < n; i++) {
    const x = Math.random() * W, y = Math.random() * H;
    const r = 0.6 + Math.random() * 3.4;
    ctx.fillStyle = `rgba(${104 + Math.random() * 40 | 0},${70 + Math.random() * 30 | 0},34,${alpha * Math.random()})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

const fillStyleCache = new Map();

function pathFor(ctx, polys, W, H, offsetX) {
  ctx.beginPath();
  for (let p = 0; p < polys.length; p++) {
    const poly = polys[p];
    if (poly.length < 3) continue;
    for (let i = 0; i < poly.length; i++) {
      const lon = poly[i][0] / 100, lat = poly[i][1] / 100;
      const x = (lon + 180) / 360 * W + offsetX;
      const y = (90 - lat) / 180 * H;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
}

/** 经纬网 */
function graticule(ctx, W, H) {
  ctx.save();
  ctx.strokeStyle = 'rgba(96,72,42,0.13)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let lon = -180; lon <= 180; lon += 30) {
    const x = (lon + 180) / 360 * W;
    ctx.moveTo(x, 0); ctx.lineTo(x, H);
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const y = (90 - lat) / 180 * H;
    ctx.moveTo(0, y); ctx.lineTo(W, y);
  }
  ctx.stroke();

  // 赤道略重
  const ye = H / 2;
  ctx.strokeStyle = 'rgba(120,60,30,0.22)';
  ctx.lineWidth = 1.4;
  ctx.setLineDash([10, 7]);
  ctx.beginPath(); ctx.moveTo(0, ye); ctx.lineTo(W, ye); ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

/** 海面：旧纸 + 水纹 */
function sea(ctx, W, H) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#b1926a');
  g.addColorStop(0.5, '#a5855c');
  g.addColorStop(1, '#b1926a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // 水波纹：横向细波
  ctx.save();
  ctx.strokeStyle = 'rgba(112,84,50,0.13)';
  ctx.lineWidth = 1;
  const step = Math.max(9, Math.round(H / 150));
  for (let y = step * 0.5; y < H; y += step) {
    ctx.beginPath();
    const amp = 1.1;
    for (let x = 0; x <= W; x += 24) {
      const yy = y + Math.sin(x / 64 + y / 37) * amp;
      if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  ctx.restore();
}

export class EraPainter {
  constructor(W = 4096, H = 2048) {
    this.W = W;
    this.H = H;
    this.base = document.createElement('canvas');
    this.base.width = W; this.base.height = H;
    this.ctx = this.base.getContext('2d', { alpha: false });
    this.idW = 2048; this.idH = 1024;
    this.idCanvas = document.createElement('canvas');
    this.idCanvas.width = this.idW; this.idCanvas.height = this.idH;
    this.idCtx = this.idCanvas.getContext('2d', { alpha: false });
  }

  paint(eraData, { ids = false } = {}) {
    const { W, H, ctx } = this;
    sea(ctx, W, H);
    mottle(ctx, W, H, 130, W * 0.075, 0.10);
    fibres(ctx, W, H, 2600, 0.16);
    graticule(ctx, W, H);

    const feats = eraData.features;
    const offs = [-W, 0, W];

    // 1) 地色
    ctx.save();
    for (let f = 0; f < feats.length; f++) {
      const ft = feats[f];
      let tone = fillStyleCache.get(ft.name);
      if (!tone) { tone = landTone(ft.name); fillStyleCache.set(ft.name, tone); }
      ctx.fillStyle = tone;
      for (let o = 0; o < 3; o++) {
        pathFor(ctx, ft.polys, W, H, offs[o]);
        ctx.fill();
      }
    }
    ctx.restore();

    // 2) 纸纹压到地上，让陆地与海是同一种纸
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.5;
    mottle(ctx, W, H, 60, W * 0.05, 0.16);
    ctx.restore();
    foxing(ctx, W, H, 380, 0.10);

    // 3) 墨线：先淡影，再实线
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(70,46,22,0.20)';
    ctx.lineWidth = 6;
    for (let f = 0; f < feats.length; f++) {
      const ft = feats[f];
      for (let o = 0; o < 3; o++) { pathFor(ctx, ft.polys, W, H, offs[o]); ctx.stroke(); }
    }
    ctx.strokeStyle = 'rgba(43,27,12,0.90)';
    ctx.lineWidth = 1.7;
    for (let f = 0; f < feats.length; f++) {
      const ft = feats[f];
      for (let o = 0; o < 3; o++) { pathFor(ctx, ft.polys, W, H, offs[o]); ctx.stroke(); }
    }
    ctx.restore();

    if (ids) this.paintIds(eraData);
    return this.base;
  }

  paintIds(eraData) {
    const { idW, idH, idCtx } = this;
    idCtx.fillStyle = '#000000';
    idCtx.fillRect(0, 0, idW, idH);
    idCtx.lineJoin = 'round';
    const offs = [-idW, 0, idW];
    for (let f = 0; f < eraData.features.length; f++) {
      const ft = eraData.features[f];
      idCtx.fillStyle = idColor(ft.id);
      for (let o = 0; o < 3; o++) {
        pathFor(idCtx, ft.polys, idW, idH, offs[o]);
        idCtx.fill();
      }
    }
  }

  /** 选中地块的高亮层 */
  paintOverlay(ctx, eraData, featureIds, alpha = 1) {
    const { W, H } = this;
    ctx.clearRect(0, 0, W, H);
    if (!featureIds || !featureIds.length) return;
    const offs = [-W, 0, W];
    ctx.save();
    ctx.lineJoin = 'round';
    for (const id of featureIds) {
      const ft = eraData.features.find(f => f.id === id);
      if (!ft) continue;
      ctx.fillStyle = `rgba(132,46,24,${0.30 * alpha})`;
      ctx.strokeStyle = `rgba(112,34,18,${0.95 * alpha})`;
      ctx.lineWidth = 3.2;
      for (let o = 0; o < 3; o++) {
        pathFor(ctx, ft.polys, W, H, offs[o]);
        ctx.fill();
        ctx.stroke();
      }
      ctx.strokeStyle = `rgba(255,236,198,${0.55 * alpha})`;
      ctx.lineWidth = 1;
      for (let o = 0; o < 3; o++) {
        pathFor(ctx, ft.polys, W, H, offs[o]);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

/* ---------------------------------------------------------- geo utils */
export function lonLatToVec3(lon, lat, r = 1) {
  const phi = lat * DEG, lam = lon * DEG;
  return {
    x: Math.cos(phi) * Math.cos(lam) * r,
    y: Math.sin(phi) * r,
    z: -Math.cos(phi) * Math.sin(lam) * r,
  };
}

export function vec3ToLonLat(x, y, z) {
  const r = Math.hypot(x, y, z) || 1;
  const lat = Math.asin(Math.max(-1, Math.min(1, y / r))) / DEG;
  const lon = Math.atan2(-z, x) / DEG;
  return { lon, lat };
}

/** 点是否落在某个 feature 内（支持展开后的经度） */
export function pointInFeature(ft, lon, lat) {
  for (let p = 0; p < ft.polys.length; p++) {
    const poly = ft.polys[p];
    for (const shift of [0, 360, -360]) {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i][0] / 100, yi = poly[i][1] / 100;
        const xj = poly[j][0] / 100, yj = poly[j][1] / 100;
        if ((yi > lat) !== (yj > lat)) {
          const xint = xi + (lat - yi) / (yj - yi) * (xj - xi);
          if (lon + shift < xint) inside = !inside;
        }
      }
      if (inside) return true;
    }
  }
  return false;
}

export function featureAt(eraData, lon, lat) {
  let best = null, bg = null;
  for (const ft of eraData.features) {
    const b = ft.bbox;
    if (lon < b[0] - 2 || lon > b[2] + 2 || lat < b[1] - 2 || lat > b[3] + 2) continue;
    if (!pointInFeature(ft, lon, lat)) continue;
    if (ft.bg) {
      if (!bg || ft.area > bg.area) bg = ft;
      continue;
    }
    if (!best || ft.area < best.area) best = ft;
  }
  return best || bg;
}