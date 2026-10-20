/* ============================================================
   四川乡道 · 20:30
   一个程序化生成的夜间乡间公路场景
   - 破败水泥路 / 泛黄路灯 / 远方远光灯 / 偶发会车 / 砖房
   - 车上看 → 下车漫步
   所有纹理、几何体均在运行时程序生成，无外部资源
   ============================================================ */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { Radio, PLAYLIST } from './radio.js';

/** 合并工具：自动统一索引状态（有的几何体是非索引的，直接合并会失败） */
function mergeSafe(geos, useGroups = false) {
  const list = geos.filter(Boolean);
  if (!list.length) return null;
  const hasNonIndexed = list.some(g => !g.index);
  const prepared = hasNonIndexed
    ? list.map(g => (g.index ? g.toNonIndexed() : g))
    : list;
  const merged = mergeGeometries(prepared, useGroups);
  if (!merged) {
    console.warn('mergeSafe failed, fallback to first geometry');
    return list[0];
  }
  return merged;
}

/* ---------------- 基础工具 ---------------- */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------- 场景常量 ---------------- */
const ROAD_LEN = 3000;      // 道路总长（米）
const ROAD_HW = 3.2;        // 半宽
const LANE = 1.55;          // 车道中心
const EYE = 1.62;           // 站立视高
const DRIVE_SPEED = 11.6;   // ≈ 42 km/h

/** 路面纵向起伏（略微起伏的乡道） */
function roadY(z) {
  return 0.52 * Math.sin(z * 0.0061)
       + 0.24 * Math.sin(z * 0.0167 + 1.2)
       + 0.08 * Math.sin(z * 0.043 + 3.1);
}

/* ---------------- 渲染器 / 场景 ---------------- */
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.56;
document.body.insertBefore(renderer.domElement, document.body.firstChild);

const scene = new THREE.Scene();
const FOG_COLOR = 0x080f1c;
scene.fog = new THREE.FogExp2(FOG_COLOR, 0.0102);

const camera = new THREE.PerspectiveCamera(66, window.innerWidth / window.innerHeight, 0.05, 4000);
camera.rotation.order = 'YXZ';
scene.add(camera);

/* 夜空基础照明：极暗的环境色 + 天光/地面反射 */
const ambient = new THREE.AmbientLight(0x9fb2d4, 0.86);
scene.add(ambient);
const hemi = new THREE.HemisphereLight(0xa8bce0, 0x2a2418, 0.36);
hemi.position.set(0, 40, 0);
scene.add(hemi);
const moon = new THREE.DirectionalLight(0x93a9d6, 0.55);
moon.position.set(-38, 46, 22);
scene.add(moon);

/* ============================================================
   一、程序化纹理
   ============================================================ */
function cv(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function toTex(canvas, rx = 1, ry = 1, srgb = true) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 破败水泥路面 */
function makeConcreteTexture() {
  const S = 1024, c = cv(S, S), g = c.getContext('2d');
  const rnd = mulberry32(1337);

  g.fillStyle = '#6b6b64'; g.fillRect(0, 0, S, S);

  // 骨料颗粒
  for (let i = 0; i < 60000; i++) {
    const v = rnd();
    const a = 0.03 + rnd() * 0.10;
    g.fillStyle = v > 0.55
      ? `rgba(178,176,166,${a})`
      : `rgba(38,37,34,${a})`;
    const r = 0.7 + rnd() * 2.4;
    g.fillRect(rnd() * S, rnd() * S, r, r);
  }

  // 大块污渍 / 水痕
  for (let i = 0; i < 70; i++) {
    const x = rnd() * S, y = rnd() * S, r = 30 + rnd() * 150;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    const dark = rnd() > 0.35;
    grd.addColorStop(0, dark ? 'rgba(30,29,26,0.20)' : 'rgba(150,148,138,0.13)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
  }

  // 补丁（新水泥块，颜色偏浅、边界清晰）
  for (let i = 0; i < 7; i++) {
    const x = rnd() * S, y = rnd() * S;
    const w = 70 + rnd() * 170, h = 50 + rnd() * 130;
    g.fillStyle = `rgba(126,124,114,${0.16 + rnd() * 0.14})`;
    g.fillRect(x, y, w, h);
    g.strokeStyle = 'rgba(40,38,34,0.30)';
    g.lineWidth = 1.6;
    g.strokeRect(x, y, w, h);
  }

  // 裂缝：主裂缝 + 分叉
  function crack(x, y, len, width, depth) {
    g.strokeStyle = `rgba(24,23,21,${0.34 + rnd() * 0.26})`;
    g.lineWidth = width;
    g.beginPath(); g.moveTo(x, y);
    let cx = x, cy = y;
    const steps = 5 + Math.floor(rnd() * 9);
    for (let s = 0; s < steps; s++) {
      cx += (rnd() - 0.5) * len;
      cy += (rnd() - 0.35) * len * 0.75;
      g.lineTo(cx, cy);
    }
    g.stroke();
    if (depth > 0) {
      for (let k = 0; k < 2; k++) {
        if (rnd() > 0.45) crack(cx, cy, len * 0.6, width * 0.6, depth - 1);
      }
    }
  }
  for (let i = 0; i < 16; i++) crack(rnd() * S, rnd() * S, 34, 0.8 + rnd() * 1.8, 2);

  // 横向伸缩缝：每块水泥板之间的接缝
  [0.25, 0.75].forEach(fy => {
    const y0 = fy * S;
    g.strokeStyle = 'rgba(26,25,23,0.62)';
    g.lineWidth = 2.6;
    g.beginPath();
    for (let x = 0; x <= S; x += 8) {
      g.lineTo(x, y0 + Math.sin(x * 0.05 + fy * 9) * 1.6 + (rnd() - 0.5) * 1.2);
    }
    g.stroke();
    // 缝边的浅色积垢
    g.strokeStyle = 'rgba(160,158,148,0.10)';
    g.lineWidth = 6;
    g.stroke();
  });

  // 边角磕碰（浅色凹坑）
  for (let i = 0; i < 26; i++) {
    const x = rnd() * S, y = rnd() * S, r = 2 + rnd() * 9;
    g.fillStyle = `rgba(52,50,45,${0.18 + rnd() * 0.22})`;
    g.beginPath(); g.ellipse(x, y, r, r * 0.7, rnd() * 3, 0, 6.2832); g.fill();
    g.fillStyle = 'rgba(160,158,148,0.10)';
    g.beginPath(); g.ellipse(x - r * 0.3, y - r * 0.3, r * 0.55, r * 0.4, 0, 0, 6.2832); g.fill();
  }
  return c;
}

/** 砖墙 */
function makeBrickTexture(seed, base = [104, 58, 46]) {
  const S = 512, c = cv(S, S), g = c.getContext('2d');
  const rnd = mulberry32(seed);
  g.fillStyle = '#4a453e'; g.fillRect(0, 0, S, S); // 灰缝

  const bh = 16, bw = 56;
  for (let row = 0; row * bh < S + bh; row++) {
    const off = (row % 2) * (bw / 2);
    for (let col = -1; col * bw < S + bw; col++) {
      const x = col * bw + off + 1.5, y = row * bh + 1.5;
      const t = rnd();
      const r = base[0] + (t - 0.5) * 46;
      const gg = base[1] + (t - 0.5) * 30;
      const b = base[2] + (t - 0.5) * 24;
      g.fillStyle = `rgb(${r | 0},${gg | 0},${b | 0})`;
      g.fillRect(x, y, bw - 3, bh - 3);
      // 砖面斑驳
      g.fillStyle = `rgba(30,22,18,${0.05 + rnd() * 0.16})`;
      g.fillRect(x + rnd() * (bw * 0.5), y + rnd() * (bh * 0.5), bw * 0.35, bh * 0.45);
      if (rnd() > 0.88) {
        g.fillStyle = 'rgba(170,168,158,0.10)';
        g.fillRect(x, y, bw - 3, bh - 3);
      }
    }
  }
  // 整体脏污
  for (let i = 0; i < 26; i++) {
    const x = rnd() * S, y = rnd() * S, r = 40 + rnd() * 120;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(18,16,14,${0.08 + rnd() * 0.14})`);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
  }
  return c;
}

/** 抹灰墙面 */
function makePlasterTexture(seed) {
  const S = 512, c = cv(S, S), g = c.getContext('2d');
  const rnd = mulberry32(seed);
  g.fillStyle = '#a8a49a'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 26000; i++) {
    const a = 0.02 + rnd() * 0.07;
    g.fillStyle = rnd() > 0.5 ? `rgba(210,206,196,${a})` : `rgba(70,68,62,${a})`;
    g.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 3, 1 + rnd() * 3);
  }
  // 雨痕（自上而下的竖条）
  for (let i = 0; i < 26; i++) {
    const x = rnd() * S, w = 4 + rnd() * 22, y0 = rnd() * S * 0.4;
    const grd = g.createLinearGradient(0, y0, 0, S);
    grd.addColorStop(0, `rgba(52,50,44,${0.10 + rnd() * 0.12})`);
    grd.addColorStop(1, 'rgba(52,50,44,0)');
    g.fillStyle = grd;
    g.fillRect(x, y0, w, S - y0);
  }
  // 脱皮斑点
  for (let i = 0; i < 40; i++) {
    const x = rnd() * S, y = rnd() * S, r = 3 + rnd() * 16;
    g.fillStyle = `rgba(88,82,72,${0.12 + rnd() * 0.2})`;
    g.beginPath(); g.ellipse(x, y, r, r * 0.7, rnd() * 3, 0, 6.2832); g.fill();
  }
  return c;
}

/** 泥土/杂草地面 */
function makeGroundTexture() {
  const S = 512, c = cv(S, S), g = c.getContext('2d');
  const rnd = mulberry32(77);
  g.fillStyle = '#3d3b2a'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 9000; i++) {
    const t = rnd();
    const col = t > 0.6
      ? `rgba(${40 + rnd() * 26 | 0},${44 + rnd() * 30 | 0},${28 + rnd() * 14 | 0},0.5)`
      : `rgba(${42 + rnd() * 22 | 0},${36 + rnd() * 16 | 0},${24 + rnd() * 12 | 0},0.5)`;
    g.fillStyle = col;
    const r = 2 + rnd() * 9;
    g.beginPath(); g.arc(rnd() * S, rnd() * S, r, 0, 6.2832); g.fill();
  }
  // 细碎草叶
  for (let i = 0; i < 2600; i++) {
    g.strokeStyle = `rgba(${54 + rnd() * 40 | 0},${62 + rnd() * 40 | 0},${34 + rnd() * 20 | 0},0.45)`;
    g.lineWidth = 1;
    const x = rnd() * S, y = rnd() * S;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 6, y - 3 - rnd() * 7); g.stroke();
  }
  return c;
}

/** 柔和径向光斑（用于光晕 / 粒子） */
function makeGlowTexture(inner = 0.0, size = 128) {
  const c = cv(size, size), g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.12, 'rgba(255,252,240,0.92)');
  grd.addColorStop(0.32, 'rgba(255,226,178,0.42)');
  grd.addColorStop(0.62, 'rgba(255,196,128,0.11)');
  grd.addColorStop(1, 'rgba(255,180,110,0)');
  g.fillStyle = grd; g.fillRect(0, 0, size, size);
  return c;
}

/** 路面暖色光池 */
function makePoolTexture() {
  const S = 256, c = cv(S, S), g = c.getContext('2d');
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,214,150,0.85)');
  grd.addColorStop(0.30, 'rgba(255,190,112,0.42)');
  grd.addColorStop(0.62, 'rgba(240,158,78,0.13)');
  grd.addColorStop(1, 'rgba(220,140,60,0)');
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  return c;
}

/** 草叶（带 alpha） */
function makeGrassTexture() {
  const S = 128, c = cv(S, S), g = c.getContext('2d');
  const rnd = mulberry32(9);
  g.clearRect(0, 0, S, S);
  for (let i = 0; i < 26; i++) {
    const x = 8 + rnd() * (S - 16);
    const h = 42 + rnd() * 72;
    const bend = (rnd() - 0.5) * 34;
    const w = 1.6 + rnd() * 2.4;
    const t = rnd();
    g.fillStyle = `rgba(${34 + t * 34 | 0},${48 + t * 40 | 0},${24 + t * 20 | 0},${0.75 + rnd() * 0.25})`;
    g.beginPath();
    g.moveTo(x - w / 2, S);
    g.quadraticCurveTo(x + bend * 0.5, S - h * 0.6, x + bend, S - h);
    g.quadraticCurveTo(x + bend * 0.5 + w * 0.4, S - h * 0.55, x + w / 2, S);
    g.closePath(); g.fill();
  }
  return c;
}

/** 挡风玻璃上的灰 / 水痕 */
function makeGlassDirtTexture() {
  const W = 1024, H = 640, c = cv(W, H), g = c.getContext('2d');
  const rnd = mulberry32(31);
  g.clearRect(0, 0, W, H);

  // 底部积灰更重
  const grd = g.createLinearGradient(0, H, 0, H * 0.45);
  grd.addColorStop(0, 'rgba(150,148,138,0.30)');
  grd.addColorStop(0.5, 'rgba(150,148,138,0.08)');
  grd.addColorStop(1, 'rgba(150,148,138,0)');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);

  // 泥点
  for (let i = 0; i < 900; i++) {
    const x = rnd() * W, y = H * (0.35 + rnd() * 0.65);
    const r = 0.8 + rnd() * 3.2;
    g.fillStyle = `rgba(${120 + rnd() * 50 | 0},${116 + rnd() * 46 | 0},${100 + rnd() * 40 | 0},${0.05 + rnd() * 0.22})`;
    g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
  }

  // 雨刮擦痕（两道弧）
  for (const cx of [W * 0.28, W * 0.74]) {
    g.strokeStyle = 'rgba(190,190,182,0.10)';
    g.lineWidth = 26;
    g.beginPath();
    g.arc(cx, H * 1.05, H * 0.72, Math.PI * 1.14, Math.PI * 1.82);
    g.stroke();
    g.strokeStyle = 'rgba(40,40,38,0.06)';
    g.lineWidth = 3;
    g.stroke();
  }

  // 四周羽化，避免出现硬边矩形
  g.globalCompositeOperation = 'destination-in';
  const mask = g.createRadialGradient(W / 2, H * 0.62, Math.min(W, H) * 0.18, W / 2, H * 0.55, Math.max(W, H) * 0.66);
  mask.addColorStop(0, 'rgba(255,255,255,1)');
  mask.addColorStop(0.62, 'rgba(255,255,255,0.85)');
  mask.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = mask; g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'source-over';

  return c;
}

/** 云的柔软笔触（用于低空薄雾） */function makeSoftBlobTexture() {
  const S = 256, c = cv(S, S), g = c.getContext('2d');
  const rnd = mulberry32(5);
  for (let i = 0; i < 16; i++) {
    const x = S * (0.2 + rnd() * 0.6), y = S * (0.3 + rnd() * 0.4);
    const r = S * (0.12 + rnd() * 0.22);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.30)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
  }
  return c;
}

/** 路面污渍 / 坑洼贴花 */
function makeStainTexture() {
  const S = 256, c = cv(S, S), g = c.getContext('2d');
  const rnd = mulberry32(808);
  g.clearRect(0, 0, S, S);
  const cx = S * 0.5, cy = S * 0.5;
  const grd = g.createRadialGradient(cx, cy, 0, cx, cy, S * 0.5);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)');
  grd.addColorStop(0.55, 'rgba(0,0,0,0.34)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  // 用不规则多边形挖出形状，避免圆得太规整
  g.beginPath();
  const n = 22;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = S * (0.28 + rnd() * 0.20);
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.closePath(); g.fill();
  // 内部碎石点
  for (let i = 0; i < 260; i++) {
    const a = rnd() * 6.2832, r = rnd() * S * 0.34;
    g.fillStyle = `rgba(0,0,0,${0.10 + rnd() * 0.30})`;
    g.beginPath();
    g.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 1 + rnd() * 5, 0, 6.2832);
    g.fill();
  }
  return c;
}

/** 路面裂缝贴花 */
function makeCrackDecalTexture() {
  const S = 256, c = cv(S, S), g = c.getContext('2d');
  const rnd = mulberry32(4242);
  g.clearRect(0, 0, S, S);
  function line(x, y, ang, len, w, depth) {
    g.strokeStyle = `rgba(0,0,0,${0.35 + rnd() * 0.35})`;
    g.lineWidth = w;
    g.beginPath(); g.moveTo(x, y);
    let cx = x, cy = y, a = ang;
    const seg = 6 + Math.floor(rnd() * 8);
    for (let i = 0; i < seg; i++) {
      a += (rnd() - 0.5) * 0.9;
      cx += Math.cos(a) * (len / seg);
      cy += Math.sin(a) * (len / seg);
      g.lineTo(cx, cy);
    }
    g.stroke();
    if (depth > 0 && rnd() > 0.35) line(cx, cy, a + (rnd() - 0.5) * 1.8, len * 0.55, w * 0.6, depth - 1);
  }
  for (let i = 0; i < 5; i++) {
    line(rnd() * S, rnd() * S, rnd() * 6.28, 55 + rnd() * 90, 1 + rnd() * 2.2, 2);
  }
  return c;
}

/* 生成纹理实例 */
const TEX = {
  concrete: toTex(makeConcreteTexture(), 2, 300),
  brick: toTex(makeBrickTexture(11, [104, 58, 46]), 2.2, 2.2),
  brickWarm: toTex(makeBrickTexture(23, [118, 70, 52]), 2.4, 2.4),
  plaster: toTex(makePlasterTexture(41), 2, 2),
  ground: toTex(makeGroundTexture(), 26, 190),
  glow: toTex(makeGlowTexture(), 1, 1),
  pool: toTex(makePoolTexture(), 1, 1),
  grass: toTex(makeGrassTexture(), 1, 1),
  glassDirt: toTex(makeGlassDirtTexture(), 1, 1),
  blob: toTex(makeSoftBlobTexture(), 1, 1),
  stain: toTex(makeStainTexture(), 1, 1),
  crack: toTex(makeCrackDecalTexture(), 1, 1),
};

/* ============================================================
   二、天空 / 星空 / 薄雾
   ============================================================ */
// 注意：这是裸 ShaderMaterial，输出不做色调映射/色彩空间转换，
// 所以下面的颜色直接按「最终字节 = 线性值 × 255」来给，才能精确控制天色的深浅。
const skyCol = (r, g, b) => new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.LinearSRGBColorSpace);
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: {
    cTop: { value: skyCol(2, 3, 7) },        // 天顶：近乎黑
    cMid: { value: skyCol(8, 15, 28) },      // 中段：深蓝
    cHor: { value: skyCol(16, 27, 44) },     // 地平线：与雾色接得上
  },
  vertexShader: `
    varying vec3 vDir;
    void main() {
      vDir = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    varying vec3 vDir;
    uniform vec3 cTop, cMid, cHor;
    void main() {
      float h = vDir.y;
      vec3 col = mix(cHor, cMid, smoothstep(-0.02, 0.22, h));
      col = mix(col, cTop, smoothstep(0.18, 0.92, h));

      // 极低频的深浅交错（深蓝与黑交加），不做硬边
      float weave = sin(vDir.x * 1.7 + vDir.z * 1.1) * 0.5 + 0.5;
      weave *= sin(vDir.z * 2.3 - vDir.x * 1.4 + 1.7) * 0.5 + 0.5;
      col *= 0.94 + weave * 0.12;

      // 地平线雾霭
      col += vec3(0.022, 0.030, 0.044) * smoothstep(0.12, -0.03, h);

      gl_FragColor = vec4(col, 1.0);
    }`
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(1600, 40, 28), skyMat);
scene.add(sky);

/* 远景树线 / 缓丘：做成跟随镜头的剪影环，避免地平线是一条刀切的直线 */
let farRidge = null;
(function buildFarRidge() {
  const c = cv(2048, 300);
  const g = c.getContext('2d');
  g.clearRect(0, 0, 2048, 300);
  g.fillStyle = '#ffffff';
  const rnd = mulberry32(9137);
  // 先算出起伏的丘线，树冠要贴着它长
  const hill = [];
  let y = 176;
  for (let x = 0; x <= 2048; x += 14) {
    y += (rnd() - 0.5) * 18;
    y = Math.max(120, Math.min(214, y));
    hill.push([x, y]);
  }
  // 树冠（先画，之后丘体会盖住它们的下半截）
  for (let i = 0; i < 320; i++) {
    const cx = rnd() * 2048;
    const seg = hill[Math.min(hill.length - 1, Math.round(cx / 14))];
    const base = seg ? seg[1] : 180;
    const r = 4 + rnd() * 12;
    g.beginPath();
    g.arc(cx, base - r * 0.72, r, 0, 6.2832);
    g.fill();
  }
  // 丘体
  g.beginPath();
  g.moveTo(0, 300);
  hill.forEach(([hx, hy]) => g.lineTo(hx, hy));
  g.lineTo(2048, 300);
  g.closePath();
  g.fill();

  const tex = toTex(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(3, 1);

  const H = 52;
  // 这里走正常材质管线（有 sRGB 输出），所以直接给十六进制，
  // 最终像素就是这个值；比地平线天色暗一档，读作远树线的剪影。
  const mat = new THREE.MeshBasicMaterial({
    map: tex, color: 0x0b121e, transparent: true, alphaTest: 0.5,
    side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
  });
  const ridge = new THREE.Mesh(new THREE.CylinderGeometry(520, 520, H, 96, 1, true), mat);
  ridge.position.y = H * 0.5 - 16;
  scene.add(ridge);
  farRidge = ridge;
})();

/* 星空 */
(function buildStars() {
  const rnd = mulberry32(2024);
  const N = 1500;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const c = new THREE.Color();
  for (let i = 0; i < N; i++) {
    const v = new THREE.Vector3(rnd() * 2 - 1, rnd() * 1.1 - 0.05, rnd() * 2 - 1).normalize();
    if (v.y < 0.02) v.y = Math.abs(v.y) + 0.02;
    v.normalize().multiplyScalar(1420);
    pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
    const t = rnd();
    c.setHSL(0.58 - t * 0.10, 0.28 + t * 0.25, 0.55 + t * 0.4);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size: 2.4, sizeAttenuation: false, map: TEX.glow, vertexColors: true,
    transparent: true, opacity: 0.85, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: false,
  });
  const stars = new THREE.Points(geo, mat);
  stars.frustumCulled = false;
  scene.add(stars);
  window.__stars = mat;
})();

/* ============================================================
   三、地面与道路
   ============================================================ */
/** 沿路铺一条带纵向起伏的网格 */
function buildStrip(width, len, segX, segZ, yOffset, edgeJitter) {
  const geo = new THREE.PlaneGeometry(width, len, segX, segZ);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const zLocal = p.getY(i);          // 旋转前是 y
    // 网格整体会被平移到 z = -ROAD_LEN/2，所以世界坐标要减掉这个偏移，
    // 否则路面起伏和车/灯/贴花用的 roadY(世界 z) 差了一整段相位。
    const zWorld = -zLocal - ROAD_LEN / 2;
    let yy = roadY(zWorld) + yOffset;
    // 边缘破损
    if (edgeJitter > 0) {
      const edge = Math.abs(Math.abs(x) - width / 2) < 0.001;
      if (edge) {
        const n = Math.sin(zWorld * 3.7) * 0.5 + Math.sin(zWorld * 11.3) * 0.3 + Math.sin(zWorld * 0.9) * 0.2;
        p.setX(i, x + n * edgeJitter);
        p.setY(i, zLocal + Math.sin(zWorld * 5.1) * 0.08);
        yy += Math.abs(n) * 0.04;
      }
    }
    p.setZ(i, yy);
  }
  geo.computeVertexNormals();
  return geo;
}

// 大地
const groundGeo = new THREE.PlaneGeometry(220, ROAD_LEN + 200, 12, 320);
{
  const p = groundGeo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const zWorld = -p.getY(i) - ROAD_LEN / 2;
    const x = p.getX(i);
    const n = Math.sin(x * 0.14 + zWorld * 0.07) * 0.10 + Math.sin(x * 0.42 - zWorld * 0.19) * 0.05;
    p.setZ(i, roadY(zWorld) - 0.10 + n);
  }
  groundGeo.computeVertexNormals();
}
const ground = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({
  map: TEX.ground, color: 0x8e9078, roughness: 1.0, metalness: 0.0,
}));
ground.rotation.x = -Math.PI / 2;
ground.position.z = -ROAD_LEN / 2;
scene.add(ground);

// 路面
const roadGeo = buildStrip(ROAD_HW * 2, ROAD_LEN, 14, 460, 0.0, 0.16);
{
  const p = roadGeo.attributes.position;
  const colors = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const zw = -p.getY(i) - ROAD_LEN / 2;
    const n = Math.sin(x * 0.55 + zw * 0.11) * 0.5
            + Math.sin(zw * 0.31 - x * 0.23) * 0.28
            + Math.sin(zw * 0.083 + 2.1) * 0.42;
    const edge = Math.min(1, (ROAD_HW - Math.abs(x)) / 0.45);
    const v = (0.80 + n * 0.13) * (0.42 + 0.58 * edge);
    colors[i * 3] = v; colors[i * 3 + 1] = v; colors[i * 3 + 2] = v * 0.985;
  }
  roadGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}
const road = new THREE.Mesh(roadGeo, new THREE.MeshStandardMaterial({
  map: TEX.concrete, color: 0x86867e, roughness: 0.78, metalness: 0.03, vertexColors: true,
}));
road.rotation.x = -Math.PI / 2;
road.position.z = -ROAD_LEN / 2;
scene.add(road);

/* 路面贴花：坑洼 / 修补黑斑 / 裂缝 / 横向伸缩缝 */
(function buildRoadDecals() {
  const rnd = mulberry32(20240);
  const quad = new THREE.PlaneGeometry(1, 1);
  const dummy = new THREE.Object3D();

  function build(n, tex, opacity, minS, maxS) {
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity, depthWrite: false, color: 0x000000,
    });
    const inst = new THREE.InstancedMesh(quad, mat, n);
    for (let i = 0; i < n; i++) {
      const z = -rnd() * ROAD_LEN;
      const x = (rnd() - 0.5) * (ROAD_HW * 2 - 0.9);
      const s = minS + rnd() * (maxS - minS);
      dummy.position.set(x, roadY(z) + 0.014, z);
      dummy.rotation.set(-Math.PI / 2, 0, rnd() * 6.2832);
      dummy.scale.set(s, s * (0.6 + rnd() * 0.8), 1);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    }
    scene.add(inst);
    return inst;
  }

  build(300, TEX.stain, 0.72, 0.7, 3.4);   // 污渍 / 坑洼
  build(140, TEX.crack, 0.52, 1.6, 5.2);   // 裂缝

  // 横向伸缩缝：每 5m 一道，用真实几何画，远处也不会被 mipmap 糊掉
  const jointGeo = new THREE.PlaneGeometry(ROAD_HW * 2 - 0.25, 0.055);
  const jointMat = new THREE.MeshBasicMaterial({
    color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false,
  });
  const count = Math.floor(ROAD_LEN / 5);
  const joints = new THREE.InstancedMesh(jointGeo, jointMat, count);
  for (let i = 0; i < count; i++) {
    const z = -i * 5 - 2.5;
    dummy.position.set(0, roadY(z) + 0.008, z);
    dummy.rotation.set(-Math.PI / 2, 0, (rnd() - 0.5) * 0.03);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    joints.setMatrixAt(i, dummy.matrix);
  }
  scene.add(joints);
})();

/* 路肩碎石 */
(function buildGravel() {
  const rnd = mulberry32(55);
  const N = 900;
  const geo = new THREE.DodecahedronGeometry(1, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x4a4a42, roughness: 1, flatShading: true });
  const inst = new THREE.InstancedMesh(geo, mat, N);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < N; i++) {
    const z = -rnd() * ROAD_LEN;
    const side = rnd() > 0.5 ? 1 : -1;
    const x = side * (ROAD_HW + rnd() * 1.7);
    const s = 0.03 + rnd() * 0.12;
    dummy.position.set(x, roadY(z) - 0.03 + rnd() * 0.05, z);
    dummy.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
    dummy.scale.set(s, s * (0.5 + rnd() * 0.6), s);
    dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);
  }
  scene.add(inst);
})();

/* ============================================================
   四、路灯（泛黄）
   ============================================================ */
const lampHeadPositions = [];   // 记录灯头世界坐标，供光晕/飞虫使用
const lampData = [];            // { x, z, y }

(function buildStreetLamps() {
  const rnd = mulberry32(404);
  const poleH = 6.6;
  const armLen = 1.55;

  // 合并 灯杆 + 灯臂
  const parts = [];
  const pole = new THREE.CylinderGeometry(0.055, 0.085, poleH, 8, 1);
  pole.translate(0, poleH / 2, 0);
  parts.push(pole);
  const arm = new THREE.BoxGeometry(armLen, 0.075, 0.075);
  arm.translate(armLen / 2, poleH - 0.06, 0);
  parts.push(arm);
  const brace = new THREE.BoxGeometry(0.62, 0.045, 0.045);
  brace.rotateZ(-0.62);
  brace.translate(armLen * 0.38, poleH - 0.30, 0);
  parts.push(brace);
  const baseG = new THREE.CylinderGeometry(0.14, 0.17, 0.28, 8, 1);
  baseG.translate(0, 0.14, 0);
  parts.push(baseG);

  const poleGeo = mergeSafe(parts, false);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x1c1e1b, roughness: 0.86, metalness: 0.10 });
  const headGeo = new THREE.BoxGeometry(0.56, 0.11, 0.26);
  headGeo.translate(armLen + 0.16, poleH - 0.10, 0);
  const headMat = new THREE.MeshStandardMaterial({
    color: 0x241f16, roughness: 0.55, metalness: 0.3,
    emissive: 0xffa53d, emissiveIntensity: 2.6,
  });

  // 排布：每 ~40m 一盏，左右交替
  const positions = [];
  for (let z = -16; z > -ROAD_LEN; z -= 38 + rnd() * 7) {
    positions.push({ z, side: positions.length % 2 === 0 ? 1 : -1 });
  }

  const poleInst = new THREE.InstancedMesh(poleGeo, poleMat, positions.length);
  const headInst = new THREE.InstancedMesh(headGeo, headMat, positions.length);
  const dummy = new THREE.Object3D();
  const glowPos = new Float32Array(positions.length * 3);
  const poolMats = [];

  positions.forEach((p, i) => {
    const x = p.side * (ROAD_HW + 0.62);
    const y = roadY(p.z);
    dummy.position.set(x, y, p.z);
    // 右侧灯臂朝 -X（旋转 180°）
    dummy.rotation.set(0, p.side > 0 ? Math.PI : 0, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    poleInst.setMatrixAt(i, dummy.matrix);
    headInst.setMatrixAt(i, dummy.matrix);

    // 灯头世界坐标
    const armX = x + (p.side > 0 ? -(armLen + 0.16) : (armLen + 0.16));
    const headY = y + poleH - 0.10;
    glowPos[i * 3] = armX;
    glowPos[i * 3 + 1] = headY - 0.06;
    glowPos[i * 3 + 2] = p.z;
    lampHeadPositions.push(new THREE.Vector3(armX, headY - 0.06, p.z));
    lampData.push({ x: armX, z: p.z, y: headY });
    poolMats.push({ x: armX, z: p.z, y });
  });

  poleInst.frustumCulled = true;
  headInst.frustumCulled = true;
  scene.add(poleInst, headInst);

  // 灯泡光晕（一个 Points 搞定所有灯）
  const glowGeo = new THREE.BufferGeometry();
  glowGeo.setAttribute('position', new THREE.BufferAttribute(glowPos, 3));
  const glowPoints = new THREE.Points(glowGeo, new THREE.PointsMaterial({
    size: 2.8, map: TEX.glow, color: 0xffc06a, transparent: true, opacity: 0.95,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  }));
  scene.add(glowPoints);
  window.__lampGlow = glowPoints;

  // 路面光池
  const poolGeo = new THREE.PlaneGeometry(1, 1);
  const poolMat = new THREE.MeshBasicMaterial({
    map: TEX.pool, color: 0xffb463, transparent: true, opacity: 0.8,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const poolInst = new THREE.InstancedMesh(poolGeo, poolMat, poolMats.length);
  poolMats.forEach((p, i) => {
    dummy.position.set(p.x, p.y + 0.035, p.z);
    dummy.rotation.set(-Math.PI / 2, 0, 0);
    dummy.scale.set(9.5, 15, 1);
    dummy.updateMatrix();
    poolInst.setMatrixAt(i, dummy.matrix);
  });
  scene.add(poolInst);
  window.__pool = poolInst;
})();

/* ============================================================
   五、砖房
   ============================================================ */
function boxAt(w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(1, 1, 1)
  );
  g.applyMatrix4(m);
  return g;
}

const MAT = {
  roofDark: new THREE.MeshStandardMaterial({ color: 0x2b2a27, roughness: 0.92, metalness: 0.05 }),
  roofTile: new THREE.MeshStandardMaterial({ color: 0x24211e, roughness: 0.9, metalness: 0.05 }),
  wallBrick: new THREE.MeshStandardMaterial({ map: TEX.brick, color: 0x8e8478, roughness: 0.96 }),
  wallBrick2: new THREE.MeshStandardMaterial({ map: TEX.brickWarm, color: 0x9a8e80, roughness: 0.96 }),
  wallPlaster: new THREE.MeshStandardMaterial({ map: TEX.plaster, color: 0x8b8b82, roughness: 0.97 }),
  windowLit: new THREE.MeshBasicMaterial({ color: 0xd08b3c, toneMapped: false }),
  windowLit2: new THREE.MeshBasicMaterial({ color: 0xdfa963, toneMapped: false }),
  windowDark: new THREE.MeshStandardMaterial({ color: 0x0d1218, roughness: 0.25, metalness: 0.4 }),
  door: new THREE.MeshStandardMaterial({ color: 0x1c1712, roughness: 0.9 }),
  concrete: new THREE.MeshStandardMaterial({ color: 0x54544c, roughness: 0.95 }),
};

function buildHouse(seed) {
  const rnd = mulberry32(seed);
  const g = new THREE.Group();

  const w = 7.5 + rnd() * 4.5;
  const d = 6.5 + rnd() * 3.2;
  const floors = rnd() < 0.55 ? 2 : 1;
  const fh = 3.0;
  const H = floors * fh;

  const wallGeos = [], roofGeos = [], litGeos = [], darkGeos = [], trimGeos = [];

  // 主体
  wallGeos.push(boxAt(w, H, d, 0, H / 2, 0));

  // 二层挑檐 / 腰线
  if (floors === 2) {
    trimGeos.push(boxAt(w + 0.35, 0.16, d + 0.35, 0, fh, 0));
  }
  // 勒脚
  trimGeos.push(boxAt(w + 0.16, 0.55, d + 0.16, 0, 0.27, 0));

  // 屋顶
  const flat = rnd() < 0.5;
  if (flat) {
    roofGeos.push(boxAt(w + 0.7, 0.18, d + 0.7, 0, H + 0.09, 0));
    // 女儿墙
    roofGeos.push(boxAt(w + 0.7, 0.42, 0.14, 0, H + 0.30, (d + 0.7) / 2));
    roofGeos.push(boxAt(w + 0.7, 0.42, 0.14, 0, H + 0.30, -(d + 0.7) / 2));
    roofGeos.push(boxAt(0.14, 0.42, d + 0.7, (w + 0.7) / 2, H + 0.30, 0));
    roofGeos.push(boxAt(0.14, 0.42, d + 0.7, -(w + 0.7) / 2, H + 0.30, 0));
    // 屋顶水箱 / 楼梯间
    if (rnd() < 0.55) {
      trimGeos.push(boxAt(1.1, 0.9, 1.1, (rnd() - 0.5) * w * 0.5, H + 0.63, (rnd() - 0.5) * d * 0.4));
    }
  } else {
    // 小青瓦双坡顶
    const rh = 1.15 + rnd() * 0.35;
    const halfD = d / 2 + 0.55;
    const ang = Math.atan2(rh, halfD);
    const plen = Math.hypot(rh, halfD);
    roofGeos.push(boxAt(w + 0.9, 0.13, plen, 0, H + rh / 2 + 0.02, halfD / 2, ang, 0, 0));
    roofGeos.push(boxAt(w + 0.9, 0.13, plen, 0, H + rh / 2 + 0.02, -halfD / 2, -ang, 0, 0));
    // 屋脊
    roofGeos.push(boxAt(w + 1.0, 0.14, 0.26, 0, H + rh + 0.04, 0));
  }

  // 窗（正面 +Z）
  const cols = w > 9.5 ? 3 : 2;
  for (let f = 0; f < floors; f++) {
    const yBase = f * fh + 1.55;
    for (let i = 0; i < cols; i++) {
      const x = (i - (cols - 1) / 2) * (w / (cols + 0.35));
      const lit = rnd() < 0.40;
      const ww = 1.05 + rnd() * 0.3, wh = 1.28;
      const geo = new THREE.PlaneGeometry(ww, wh).translate(x, yBase, d / 2 + 0.035);
      (lit ? litGeos : darkGeos).push(geo);
      // 窗框
      darkGeos.push(boxAt(ww + 0.14, 0.07, 0.06, x, yBase + wh / 2 + 0.04, d / 2 + 0.05));
      darkGeos.push(boxAt(ww + 0.14, 0.07, 0.06, x, yBase - wh / 2 - 0.04, d / 2 + 0.05));
      if (rnd() < 0.5) {
        // 防盗网
        darkGeos.push(boxAt(ww + 0.10, wh + 0.06, 0.03, x, yBase, d / 2 + 0.10));
      }
    }
  }

  // 侧面窗
  if (rnd() < 0.7) {
    const sy = fh * 0.55 + 1.5;
    const sg = new THREE.PlaneGeometry(0.95, 1.15)
      .rotateY(Math.PI / 2)
      .translate(w / 2 + 0.03, sy, (rnd() - 0.5) * d * 0.5);
    (rnd() < 0.5 ? litGeos : darkGeos).push(sg);
  }

  // 门
  const doorX = (rnd() - 0.5) * w * 0.45;
  darkGeos.push(new THREE.PlaneGeometry(1.1, 2.1).translate(doorX, 1.05, d / 2 + 0.04));
  trimGeos.push(boxAt(1.5, 0.12, 0.7, doorX, 0.06, d / 2 + 0.3)); // 门前台阶

  // 门头灯（有的亮）
  const hasPorchLight = rnd() < 0.55;
  if (hasPorchLight) {
    litGeos.push(boxAt(0.16, 0.1, 0.12, doorX + 0.9, 2.55, d / 2 + 0.09));
  }

  const wallMat = floors === 2 && rnd() < 0.35 ? MAT.wallPlaster : (rnd() < 0.5 ? MAT.wallBrick : MAT.wallBrick2);
  g.add(new THREE.Mesh(mergeSafe(wallGeos, false), wallMat));
  if (roofGeos.length) g.add(new THREE.Mesh(mergeSafe(roofGeos, false), flat ? MAT.roofDark : MAT.roofTile));
  if (litGeos.length) g.add(new THREE.Mesh(mergeSafe(litGeos, false), rnd() < 0.5 ? MAT.windowLit : MAT.windowLit2));
  if (darkGeos.length) g.add(new THREE.Mesh(mergeSafe(darkGeos, false), MAT.windowDark));
  if (trimGeos.length) g.add(new THREE.Mesh(mergeSafe(trimGeos, false), MAT.concrete));

  g.userData.litCount = litGeos.length;
  g.userData.frontZ = d / 2;
  return g;
}

/* 摆放房屋 */
(function placeHouses() {
  const rnd = mulberry32(808);
  const group = new THREE.Group();
  let z = -40;
  let i = 0;
  while (z > -ROAD_LEN + 60) {
    const side = rnd() > 0.5 ? 1 : -1;
    const h = buildHouse(1000 + i * 37);
    const dist = ROAD_HW + 6.5 + rnd() * 12;
    h.position.set(side * dist, roadY(z) - 0.06, z);
    h.rotation.y = (side > 0 ? -Math.PI / 2 : Math.PI / 2) + (rnd() - 0.5) * 0.42;
    h.scale.setScalar(0.92 + rnd() * 0.22);
    group.add(h);

    // 亮窗光晕（挂在房子本地空间、贴在立面前方，才会绕开墙体遮挡）
    const glowMat = new THREE.SpriteMaterial({
      map: TEX.glow, color: 0xffa855, transparent: true, opacity: 0.34,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const sp = new THREE.Sprite(glowMat);
    sp.scale.set(3.6, 3.6, 1);
    sp.position.set(0, 2.4, h.userData.frontZ + 0.8);
    h.add(sp);
    (window.__winGlow = window.__winGlow || []).push(sp);

    // 院墙
    if (rnd() < 0.45) {
      const wallMat = rnd() < 0.5 ? MAT.wallBrick2 : MAT.concrete;
      const ww = 6 + rnd() * 4;
      const wallGeo = mergeSafe([
        boxAt(ww, 0.95, 0.16, -ww * 0.15, 0.48, 0),
      ], false);
      const m = new THREE.Mesh(wallGeo, wallMat);
      m.position.copy(h.position);
      m.position.x += side * 0.4;
      m.position.z += 0.4;
      m.rotation.y = h.rotation.y;
      group.add(m);
    }

    const step = 62 + rnd() * 95;
    z -= step;
    i++;
  }
  scene.add(group);
})();

/* ============================================================
   六、树 / 竹 / 草
   ============================================================ */
const MAT_TREE = {
  trunk: new THREE.MeshStandardMaterial({ color: 0x201a14, roughness: 1 }),
  leaf: new THREE.MeshStandardMaterial({ color: 0x0a1209, roughness: 1, flatShading: true }),
  leaf2: new THREE.MeshStandardMaterial({ color: 0x0c150b, roughness: 1, flatShading: true }),
  bambooStem: new THREE.MeshStandardMaterial({ color: 0x1a2312, roughness: 0.9 }),
  bambooLeaf: new THREE.MeshStandardMaterial({
    color: 0x101c0e, roughness: 0.95, side: THREE.DoubleSide, flatShading: true,
  }),
};

/* 带顶点扰动的团块：比纯 icosahedron 更像一丛叶子 */
function blobGeo(r, rnd, squash = 0.88, detail = 1) {
  const geo = new THREE.IcosahedronGeometry(r, detail);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = 0.74 + rnd() * 0.52;
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * squash, p.getZ(i) * k);
  }
  geo.computeVertexNormals();
  return geo;
}

function buildTree(seed) {
  const rnd = mulberry32(seed);
  const g = new THREE.Group();
  const h = 3.2 + rnd() * 2.6;
  const tr = 0.11 + rnd() * 0.09;

  // 主干：分段微弯
  const trunkParts = [];
  const SEG = 4;
  const lean = (rnd() - 0.5) * 0.20;
  for (let i = 0; i < SEG; i++) {
    const t0 = i / SEG, t1 = (i + 1) / SEG;
    const r0 = tr * (1.22 - t0 * 0.52);
    const r1 = tr * (1.22 - t1 * 0.52);
    const cg = new THREE.CylinderGeometry(r1, r0, h / SEG + 0.02, 6, 1);
    cg.translate(Math.sin(t0 * 2.4) * 0.06 + lean * t0 * h * 0.5, h / SEG * (i + 0.5), 0);
    trunkParts.push(cg);
  }

  // 分叉枝：短而收敛，枝端藏在树冠里
  const nb = 3 + Math.floor(rnd() * 2);
  const branches = [];
  for (let i = 0; i < nb; i++) {
    const bh = h * (0.50 + rnd() * 0.34);
    const bl = 0.62 + rnd() * 0.85;
    const rz = (rnd() - 0.5) * 1.30;
    const ry = (i / nb) * 6.2832 + rnd() * 0.9;
    const bg = new THREE.CylinderGeometry(tr * 0.20, tr * 0.50, bl, 5, 1);
    bg.translate(0, bl / 2, 0);
    bg.rotateZ(rz);
    bg.rotateY(ry);
    bg.translate(lean * bh * 0.5, bh, 0);
    trunkParts.push(bg);

    // 枝端方向（与上面的变换顺序一致）
    const dx = -Math.sin(rz) * Math.cos(ry);
    const dy = Math.cos(rz);
    const dz = Math.sin(rz) * Math.sin(ry);
    branches.push({
      base: new THREE.Vector3(lean * bh * 0.5, bh, 0),
      dir: new THREE.Vector3(dx, dy, dz),
      len: bl,
    });
  }

  g.add(new THREE.Mesh(mergeSafe(trunkParts, false), MAT_TREE.trunk));

  // 树冠：沿每根枝干铺 2 个团块，再补一个顶心；枝干完全被包住
  const blobs = [];
  for (const b of branches) {
    const nAt = 2;
    for (let k = 0; k < nAt; k++) {
      const t = 0.55 + k * 0.5;
      const r = (0.66 + rnd() * 0.5) * (k === 0 ? 1.0 : 0.82);
      const geo = blobGeo(r, rnd, 0.9, 1);
      geo.translate(
        b.base.x + b.dir.x * b.len * t + (rnd() - 0.5) * 0.26,
        b.base.y + b.dir.y * b.len * t + (rnd() - 0.5) * 0.22,
        b.base.z + b.dir.z * b.len * t + (rnd() - 0.5) * 0.26
      );
      blobs.push(geo);
    }
  }
  // 顶心与内层填充
  for (let i = 0; i < 3; i++) {
    const r = 0.7 + rnd() * 0.55;
    const geo = blobGeo(r, rnd, 0.86, 1);
    geo.translate(
      lean * h * 0.5 + (rnd() - 0.5) * 0.8,
      h * (0.72 + rnd() * 0.34),
      (rnd() - 0.5) * 0.8
    );
    blobs.push(geo);
  }

  g.add(new THREE.Mesh(mergeSafe(blobs, false), rnd() < 0.5 ? MAT_TREE.leaf : MAT_TREE.leaf2));
  g.userData.h = h;
  return g;
}

/* 川西乡道旁成丛的慈竹：细高的竿 + 顶端一小簇暗色叶影 */
function buildBamboo(seed) {
  const rnd = mulberry32(seed);
  const stems = [];
  const clumps = [];
  const n = 8 + Math.floor(rnd() * 9);
  for (let i = 0; i < n; i++) {
    const h = 4.6 + rnd() * 4.8;
    const r0 = 0.024 + rnd() * 0.018;
    const bx = (rnd() - 0.5) * 1.7;
    const bz = (rnd() - 0.5) * 1.7;

    const lower = new THREE.CylinderGeometry(r0 * 0.8, r0, h * 0.62, 4, 1);
    lower.translate(0, h * 0.31, 0);
    const upper = new THREE.CylinderGeometry(r0 * 0.45, r0 * 0.8, h * 0.4, 4, 1);
    upper.translate(0, h * 0.8, 0);
    const droop = (rnd() - 0.5) * 0.55;
    for (const gg of [lower, upper]) {
      gg.rotateZ(droop * 0.55);
      gg.rotateX((rnd() - 0.5) * 0.30);
      gg.translate(bx, 0, bz);
      stems.push(gg);
    }

    // 叶簇：只用暗色小团，夜里就是一团剪影，不会变成放射状白线
    const nc = 2 + Math.floor(rnd() * 2);
    for (let k = 0; k < nc; k++) {
      const r = 0.30 + rnd() * 0.26;
      const cl = blobGeo(r, rnd, 0.62, 0);
      cl.translate(
        bx + droop * h * 0.6 + (rnd() - 0.5) * 0.62,
        h * (0.72 + rnd() * 0.30),
        bz + (rnd() - 0.5) * 0.62
      );
      clumps.push(cl);
    }
  }
  const g = new THREE.Group();
  g.add(new THREE.Mesh(mergeSafe(stems, false), MAT_TREE.bambooStem));
  g.add(new THREE.Mesh(mergeSafe(clumps, false), new THREE.MeshStandardMaterial({
    color: 0x0b1409, roughness: 1, flatShading: true,
  })));
  return g;
}

(function plantVegetation() {
  const rnd = mulberry32(616);
  const group = new THREE.Group();

  // 近景树（贴着路边，压出剪影）
  for (let z = -12; z > -ROAD_LEN; z -= 11 + rnd() * 22) {
    const side = rnd() > 0.5 ? 1 : -1;
    const x = side * (ROAD_HW + 1.5 + rnd() * 14);
    const t = buildTree(3000 + Math.floor(rnd() * 9999));
    t.position.set(x, roadY(z) - 0.08, z);
    t.rotation.y = rnd() * 6.28;
    t.scale.setScalar(0.85 + rnd() * 0.7);
    group.add(t);
  }

  // 中景树
  for (let z = -30; z > -ROAD_LEN; z -= 26 + rnd() * 34) {
    const side = rnd() > 0.5 ? 1 : -1;
    const x = side * (ROAD_HW + 5 + rnd() * 17);
    const t = buildTree(4100 + Math.floor(rnd() * 9999));
    t.position.set(x, roadY(z) - 0.08, z);
    t.rotation.y = rnd() * 6.28;
    t.scale.setScalar(0.95 + rnd() * 0.75);
    group.add(t);
  }

  // 远景树（稀疏，只做层次）
  for (let z = -40; z > -ROAD_LEN; z -= 42 + rnd() * 66) {
    const side = rnd() > 0.5 ? 1 : -1;
    const x = side * (ROAD_HW + 8 + rnd() * 22);
    const t = buildTree(7000 + Math.floor(rnd() * 9999));
    t.position.set(x, roadY(z) - 0.08, z);
    t.rotation.y = rnd() * 6.28;
    t.scale.setScalar(1.0 + rnd() * 0.9);
    group.add(t);
  }

  // 竹林：成丛地出现，不是均匀撒
  for (let z = -24; z > -ROAD_LEN; z -= 52 + rnd() * 74) {
    const side = rnd() > 0.5 ? 1 : -1;
    const x = side * (ROAD_HW + 2.6 + rnd() * 5.5);
    const b = buildBamboo(5200 + Math.floor(rnd() * 9999));
    b.position.set(x, roadY(z) - 0.06, z);
    b.rotation.y = rnd() * 6.28;
    b.scale.setScalar(0.9 + rnd() * 0.5);
    group.add(b);
  }

  scene.add(group);
  (window.__veg = window.__veg || []).push(group);
})();

/* 路肩杂草（instanced 交叉面片） */
(function buildGrass() {
  const rnd = mulberry32(777);
  // 四片交叉：单片不再像纸屑，四片叠起来才像一丛草
  const base = new THREE.PlaneGeometry(0.36, 0.44);
  base.translate(0, 0.22, 0);
  const quads = [];
  for (let k = 0; k < 4; k++) quads.push(base.clone().rotateY(k * Math.PI / 4));
  const geo = mergeSafe(quads, false);

  const mat = new THREE.MeshLambertMaterial({
    map: TEX.grass, transparent: true, alphaTest: 0.46, side: THREE.DoubleSide,
    color: 0x2c3624,
  });

  const N = 2600;
  const inst = new THREE.InstancedMesh(geo, mat, N);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < N; i++) {
    const z = -rnd() * ROAD_LEN;
    const side = rnd() > 0.5 ? 1 : -1;
    const x = side * (ROAD_HW - 0.15 + rnd() * 6.5);
    const s = 0.6 + rnd() * 1.5;
    dummy.position.set(x, roadY(z) - 0.12, z);
    dummy.rotation.set(0, rnd() * 6.28, 0);
    dummy.scale.set(s, s * (0.8 + rnd() * 0.6), s);
    dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);
  }
  inst.castShadow = false;
  scene.add(inst);
  (window.__veg = window.__veg || []).push(inst);

  // 高一点的蒿草 / 芦苇：只长在路肩外 0.2–2.6 m，撑起地平线附近的碎剪影
  const N2 = 1200;
  const tall = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({
    map: TEX.grass, transparent: true, alphaTest: 0.52, side: THREE.DoubleSide,
    color: 0x1f2618,
  }), N2);
  for (let i = 0; i < N2; i++) {
    const z = -rnd() * ROAD_LEN;
    const side = rnd() > 0.5 ? 1 : -1;
    const x = side * (ROAD_HW + 0.42 + rnd() * 2.5);
    const s = 1.5 + rnd() * 1.7;
    dummy.position.set(x, roadY(z) - 0.14, z);
    dummy.rotation.set((rnd() - 0.5) * 0.12, rnd() * 6.28, (rnd() - 0.5) * 0.14);
    dummy.scale.set(s * 0.62, s, s * 0.62);
    dummy.updateMatrix();
    tall.setMatrixAt(i, dummy.matrix);
  }
  scene.add(tall);
  (window.__veg = window.__veg || []).push(tall);
})();

/* ============================================================
   六点五、路边细节：电线杆 / 电线 / 反光桩 / 柴垛石堆 / 远处农家灯
   ============================================================ */
const propGroup = new THREE.Group();
scene.add(propGroup);
window.__props = propGroup;

/* 电线杆 + 下垂电线（乡道最强的剪影节奏） */
(function buildUtilityPoles() {
  const rnd = mulberry32(3311);
  const POLE_H = 8.6;
  const UX = ROAD_HW + 2.75;      // 右侧路肩外侧
  const posts = [];
  for (let z = -58; z > -ROAD_LEN; z -= 52 + rnd() * 24) posts.push(z);

  const parts = [];
  const shaft = new THREE.CylinderGeometry(0.058, 0.098, POLE_H, 7, 1);
  shaft.translate(0, POLE_H / 2, 0);
  parts.push(shaft);
  for (const [yy, len] of [[POLE_H - 0.48, 1.6], [POLE_H - 1.34, 1.24]]) {
    const arm = new THREE.BoxGeometry(len, 0.075, 0.075);
    arm.translate(0, yy, 0);
    parts.push(arm);
    for (const sx of [-0.67, 0, 0.67]) {
      const ins = new THREE.CylinderGeometry(0.042, 0.052, 0.13, 6, 1);
      ins.translate(sx * (len / 1.6), yy + 0.11, 0);
      parts.push(ins);
    }
  }

  const poleMat = new THREE.MeshStandardMaterial({ color: 0x14130f, roughness: 0.97, metalness: 0.0 });
  const inst = new THREE.InstancedMesh(mergeSafe(parts, false), poleMat, posts.length);
  const dummy = new THREE.Object3D();
  posts.forEach((z, i) => {
    dummy.position.set(UX, roadY(z) - 0.05, z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);
  });
  propGroup.add(inst);

  // 导线：每两杆之间三条，二次贝塞尔加垂度
  const wires = [];
  for (let i = 0; i < posts.length - 1; i++) {
    const z0 = posts[i], z1 = posts[i + 1];
    for (const [dy, dx] of [
      [POLE_H - 0.36, -1.07], [POLE_H - 0.36, 1.07], [POLE_H - 1.22, 0],
    ]) {
      const p0 = new THREE.Vector3(UX + dx, roadY(z0) + dy, z0);
      const p1 = new THREE.Vector3(UX + dx, roadY(z1) + dy, z1);
      const mid = p0.clone().add(p1).multiplyScalar(0.5);
      mid.y -= 0.60 + rnd() * 0.34;
      const curve = new THREE.QuadraticBezierCurve3(p0, mid, p1);
      wires.push(new THREE.TubeGeometry(curve, 7, 0.017, 3, false));
    }
  }
  const wireMesh = new THREE.Mesh(
    mergeSafe(wires, false),
    new THREE.MeshStandardMaterial({ color: 0x191a17, roughness: 0.9, metalness: 0.1 })
  );
  wireMesh.frustumCulled = false;
  propGroup.add(wireMesh);
})();

/* 反光路桩：车灯扫过时最先看见的东西 */
(function buildGuidePosts() {
  const N = Math.floor(ROAD_LEN / 27);
  const bodyGeo = new THREE.BoxGeometry(0.088, 0.74, 0.062);
  bodyGeo.translate(0, 0.37, 0);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1d1c17, roughness: 0.86, metalness: 0.02 });

  const refGeo = new THREE.BoxGeometry(0.092, 0.105, 0.068);
  refGeo.translate(0, 0.645, 0);
  const refMat = new THREE.MeshStandardMaterial({
    color: 0x120402, roughness: 0.40, metalness: 0.2,
    emissive: 0x6b1207, emissiveIntensity: 0.34,
  });

  const iBody = new THREE.InstancedMesh(bodyGeo, bodyMat, N);
  const iRef = new THREE.InstancedMesh(refGeo, refMat, N);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < N; i++) {
    const z = -8 - i * 27;
    const side = i % 2 === 0 ? 1 : -1;
    dummy.position.set(side * (ROAD_HW + 0.24), roadY(z) - 0.06, z);
    dummy.rotation.set(0, side > 0 ? -0.14 : 0.14, (Math.random() - 0.5) * 0.03);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    iBody.setMatrixAt(i, dummy.matrix);
    iRef.setMatrixAt(i, dummy.matrix);
  }
  propGroup.add(iBody, iRef);
})();

/* 柴垛 / 石堆 / 预制水泥块 */
(function buildRoadsideDebris() {
  const rnd = mulberry32(7744);
  const wood = [], stone = [], concrete = [];

  for (let z = -26; z > -ROAD_LEN; z -= 23 + rnd() * 38) {
    const side = rnd() > 0.5 ? 1 : -1;
    const x = side * (ROAD_HW + 1.15 + rnd() * 3.4);
    const y = roadY(z) - 0.05;
    const kind = rnd();

    if (kind < 0.40) {
      // 柴垛：横放的圆木劈柴，一层层叠起来
      const rows = 2 + Math.floor(rnd() * 3);
      const len = 0.85 + rnd() * 0.75;
      const dir = rnd() * 6.2832;
      for (let r = 0; r < rows; r++) {
        const cnt = rows - r + 1;
        for (let k = 0; k < cnt; k++) {
          const lg = new THREE.CylinderGeometry(0.052, 0.062, len, 5, 1);
          lg.rotateZ(Math.PI / 2);
          lg.translate(0, 0.085 + r * 0.108, (k - (cnt - 1) / 2) * 0.122);
          lg.rotateY(dir);
          lg.translate(x, y, z);
          wood.push(lg);
        }
      }
    } else if (kind < 0.74) {
      // 石堆
      const n = 3 + Math.floor(rnd() * 4);
      for (let k = 0; k < n; k++) {
        const sg = blobGeo(0.10 + rnd() * 0.17, rnd, 0.68, 0);
        sg.translate(x + (rnd() - 0.5) * 0.6, y + 0.07 + rnd() * 0.08, z + (rnd() - 0.5) * 0.6);
        stone.push(sg);
      }
    } else {
      // 预制水泥块 / 半截界碑
      const cg = new THREE.BoxGeometry(0.34 + rnd() * 0.34, 0.22 + rnd() * 0.1, 0.2 + rnd() * 0.3);
      cg.rotateY(rnd() * 1.4);
      cg.translate(x, y + 0.13, z);
      concrete.push(cg);
    }
  }

  if (wood.length) propGroup.add(new THREE.Mesh(mergeSafe(wood, false),
    new THREE.MeshStandardMaterial({ color: 0x211a12, roughness: 0.99 })));
  if (stone.length) propGroup.add(new THREE.Mesh(mergeSafe(stone, false),
    new THREE.MeshStandardMaterial({ color: 0x0d0d0b, roughness: 1, flatShading: true })));
  if (concrete.length) propGroup.add(new THREE.Mesh(mergeSafe(concrete, false),
    new THREE.MeshStandardMaterial({ color: 0x232219, roughness: 0.98 })));
})();

/* 远处散落的农家灯火：让地平线之外不是一片死黑 */
(function buildFarFarmLights() {
  const rnd = mulberry32(9933);
  const group = new THREE.Group();
  for (let i = 0; i < 30; i++) {
    const z = -50 - rnd() * (ROAD_LEN - 120);
    const side = rnd() > 0.5 ? 1 : -1;
    const x = side * (22 + rnd() * 78);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: TEX.glow, color: 0xffb268, transparent: true,
      opacity: 0.20 + rnd() * 0.26, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    const sc = 1.3 + rnd() * 2.2;
    sp.scale.set(sc, sc, 1);
    sp.position.set(x, roadY(z) + 2.2 + rnd() * 2.4, z);
    group.add(sp);
  }
  scene.add(group);
})();

/* ============================================================
   七、小皮卡
   ============================================================ */
const truck = new THREE.Group();
const truckWheels = [];
let truckHeadlightSpot, truckHeadlightFill;

(function buildPickup() {
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x77817f, roughness: 0.44, metalness: 0.22 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1c1e, roughness: 0.75, metalness: 0.3 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x0b1218, roughness: 0.10, metalness: 0.6,
    transparent: true, opacity: 0.92,
  });
  const chromeMat = new THREE.MeshStandardMaterial({ color: 0x8a8f92, roughness: 0.35, metalness: 0.85 });

  function add(geo, mat, x, y, z) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    truck.add(m);
    return m;
  }

  // 底盘
  add(new THREE.BoxGeometry(1.70, 0.22, 4.32), darkMat, 0, 0.44, 0);
  // 货箱底板
  add(new THREE.BoxGeometry(1.78, 0.10, 1.98), bodyMat, 0, 0.79, 1.34);
  // 货箱侧板
  add(new THREE.BoxGeometry(0.09, 0.46, 1.98), bodyMat, 0.855, 1.02, 1.34);
  add(new THREE.BoxGeometry(0.09, 0.46, 1.98), bodyMat, -0.855, 1.02, 1.34);
  // 尾门
  add(new THREE.BoxGeometry(1.78, 0.46, 0.09), bodyMat, 0, 1.02, 2.34);
  // 驾驶室下部
  add(new THREE.BoxGeometry(1.80, 0.60, 1.86), bodyMat, 0, 0.85, -0.50);
  // 引擎盖：漆面比车身更哑、更暗，否则在副驾视角里会被环境光洗成一块白板
  const hoodMat = new THREE.MeshStandardMaterial({ color: 0x272e2d, roughness: 0.70, metalness: 0.12 });
  add(new THREE.BoxGeometry(1.76, 0.26, 1.06), hoodMat, 0, 0.95, -1.96);
  // 盖板棱线
  add(new THREE.BoxGeometry(0.055, 0.014, 1.03), hoodMat, 0.585, 1.085, -1.96);
  add(new THREE.BoxGeometry(0.055, 0.014, 1.03), hoodMat, -0.585, 1.085, -1.96);
  // 翼子板分缝
  const seamMat = new THREE.MeshBasicMaterial({
    color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false,
  });
  add(new THREE.BoxGeometry(0.020, 0.006, 1.04), seamMat, 0.836, 1.081, -1.96);
  add(new THREE.BoxGeometry(0.020, 0.006, 1.04), seamMat, -0.836, 1.081, -1.96);
  // 积灰：几片极淡的污渍贴在盖面上，打散平板感
  const dustMat = new THREE.MeshBasicMaterial({
    map: TEX.stain, transparent: true, opacity: 0.34, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  [[-0.33, -1.70, 1.00, 0.58, 0.5], [0.31, -2.12, 0.78, 0.47, 2.1], [0.01, -1.52, 0.64, 0.40, 3.4]]
    .forEach(([x, z, w, h, r]) => {
      const d = new THREE.Mesh(new THREE.PlaneGeometry(w, h), dustMat);
      d.rotation.x = -Math.PI / 2;
      d.rotation.z = r;
      d.position.set(x, 1.0845, z);
      truck.add(d);
    });
  // 前脸
  add(new THREE.BoxGeometry(1.80, 0.34, 0.12), darkMat, 0, 0.78, -2.50);
  // 前缘饰条：带一点自发光，保证无论有没有路灯，引擎盖和路面之间都有一条清晰的界线
  const edgeMat = new THREE.MeshStandardMaterial({
    color: 0x3d4341, roughness: 0.56, metalness: 0.10, emissive: 0x080706,
  });
  add(new THREE.BoxGeometry(1.84, 0.08, 0.16), edgeMat, 0, 1.07, -2.47);
  // 驾驶室玻璃舱
  add(new THREE.BoxGeometry(1.60, 0.56, 1.36), glassMat, 0, 1.43, -0.58);
  // 车顶
  add(new THREE.BoxGeometry(1.70, 0.08, 1.44), darkMat, 0, 1.75, -0.58);
  // 门线
  add(new THREE.BoxGeometry(0.02, 0.50, 0.03), chromeMat, 0.905, 0.88, -0.30);
  // 后视镜
  add(new THREE.BoxGeometry(0.09, 0.11, 0.06), darkMat, 0.95, 1.26, -1.18);
  add(new THREE.BoxGeometry(0.09, 0.11, 0.06), darkMat, -0.95, 1.26, -1.18);

  // 车灯
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff3d4 });
  add(new THREE.BoxGeometry(0.34, 0.14, 0.06), headMat, 0.60, 0.90, -2.545);
  add(new THREE.BoxGeometry(0.34, 0.14, 0.06), headMat, -0.60, 0.90, -2.545);
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a12 });
  add(new THREE.BoxGeometry(0.13, 0.20, 0.05), tailMat, 0.80, 0.98, 2.39);
  add(new THREE.BoxGeometry(0.13, 0.20, 0.05), tailMat, -0.80, 0.98, 2.39);

  // 车轮
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.95 });
  const hubMat = new THREE.MeshStandardMaterial({ color: 0x6e7274, roughness: 0.5, metalness: 0.7 });
  const tireGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.24, 16);
  const hubGeo = new THREE.CylinderGeometry(0.19, 0.19, 0.26, 12);
  [[-0.83, -1.62], [0.83, -1.62], [-0.83, 1.60], [0.83, 1.60]].forEach(([x, z]) => {
    const wheel = new THREE.Group();
    const tire = new THREE.Mesh(tireGeo, tireMat);
    tire.rotation.z = Math.PI / 2;
    const hub = new THREE.Mesh(hubGeo, hubMat);
    hub.rotation.z = Math.PI / 2;
    wheel.add(tire, hub);
    wheel.position.set(x, 0.36, z);
    truck.add(wheel);
    truckWheels.push(wheel);
  });

  // 车头灯光锥（体积感，极淡）
  const coneGeo = new THREE.ConeGeometry(2.6, 22, 18, 1, true);
  coneGeo.translate(0, -11, 0);
  coneGeo.rotateX(Math.PI / 2);
  const beam = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({
    color: 0xffd9a4, transparent: true, opacity: 0.016,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  }));
  // 体积光锥不使用（近距锥尖会产生亮条），保留引用便于调试
  beam.visible = false;
  window.__beam = beam;
  truck.add(beam);

  // 前灯实际照明：衰减别太陡，否则两盏路灯之间近处路面是黑的
  const spot = new THREE.SpotLight(0xffe2b8, 520, 110, 0.44, 0.55, 1.30);
  spot.position.set(0, 0.92, -2.5);
  spot.target.position.set(0, -2.4, -26);
  truck.add(spot, spot.target);
  truckHeadlightSpot = spot;

  // 不使用近距补光：点光源离引擎盖过近，会在漆面上烧出一条光斑
  truckHeadlightFill = null;

  // 车头两个光晕
  const glowMat = new THREE.SpriteMaterial({
    map: TEX.glow, color: 0xfff0cf, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  [0.60, -0.60].forEach(x => {
    const s = new THREE.Sprite(glowMat.clone());
    s.scale.set(0.42, 0.42, 1);
    s.position.set(x, 0.90, -2.58);
    truck.add(s);
    (window.__truckGlow = window.__truckGlow || []).push(s);
  });

  // 车底阴影（假接触阴影）
  const shadowTex = (() => {
    const c = cv(128, 128), g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(0,0,0,0.65)');
    grd.addColorStop(0.55, 'rgba(0,0,0,0.28)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
    return toTex(c);
  })();
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 5.4),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.9 })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  truck.add(shadow);

  scene.add(truck);
})();

/* ============================================================
   八、驾驶室内部（挂在相机上）
   ============================================================ */
const interior = new THREE.Group();
camera.add(interior);
let interiorHidden = false;   // 调试用：?hide=interior

// 极简内饰：车顶内衬 + A 柱 + 遮阳板 + 后视镜 + 挡风玻璃薄灰
// 只做“暗框”，不做仪表台——引擎盖会替我们把画面下方封住
(function buildInterior() {
  // 用不受光的纯色材质：车内是逆光的剪影，不能被路灯点光源打成一块塑料
  const frameMat = new THREE.MeshBasicMaterial({ color: 0x0e1014, side: THREE.DoubleSide });
  const trimMat = new THREE.MeshBasicMaterial({ color: 0x0c0e12, side: THREE.DoubleSide });

  function put(geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.frustumCulled = false;
    interior.add(m);
    return m;
  }

  // 挡风玻璃上的薄灰与水痕（极淡一层，压在画面最前）
  const glass = put(
    new THREE.PlaneGeometry(2.6, 1.7),
    new THREE.MeshBasicMaterial({
      map: TEX.glassDirt, transparent: true, opacity: 0.075,
      depthWrite: false, side: THREE.DoubleSide, color: 0xb4c0c8,
    }),
    0, 0, -1.04
  );
  glass.frustumCulled = false;

  // 车顶内衬：前缘落在视线上方约 22°，也就是画面上方 ~17%
  put(new THREE.BoxGeometry(2.9, 0.05, 0.72), frameMat, 0, 0.262, -0.26, 0.03);
  // 翻下来一半的遮阳板
  put(new THREE.BoxGeometry(0.50, 0.024, 0.20), trimMat, -0.37, 0.216, -0.50, 0.30);

  // A 柱：从顶棚前角向下收到翼子板
  put(new THREE.BoxGeometry(0.075, 0.80, 0.12), frameMat, -0.585, 0.004, -0.62, 0, 0, -0.13);
  put(new THREE.BoxGeometry(0.075, 0.80, 0.12), frameMat, 0.585, 0.004, -0.62, 0, 0, 0.13);

  // 后视镜：夜里就是一块暗剪影，不铺镜面，免得看起来像块小屏幕
  put(new THREE.BoxGeometry(0.024, 0.085, 0.024), trimMat, 0, 0.222, -0.58);
  put(new THREE.BoxGeometry(0.198, 0.062, 0.030), trimMat, 0, 0.186, -0.58);
})();

/* ============================================================
   九、车流（远方远光 / 会车）
   ============================================================ */
const traffic = [];
const trafficGroup = new THREE.Group();
scene.add(trafficGroup);

function makeHeadlightSprite(size, color = 0xfff6e2, opacity = 1) {
  const mat = new THREE.SpriteMaterial({
    map: TEX.glow, color, transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const s = new THREE.Sprite(mat);
  s.scale.set(size, size, 1);
  return s;
}

function buildTrafficVehicle(kind, seed) {
  const rnd = mulberry32(seed);
  const g = new THREE.Group();
  const paint = new THREE.Color().setHSL(
    rnd() < 0.5 ? 0.03 + rnd() * 0.08 : 0.55 + rnd() * 0.12,
    0.25 + rnd() * 0.35,
    0.10 + rnd() * 0.14
  );
  const bodyMat = new THREE.MeshStandardMaterial({ color: paint, roughness: 0.45, metalness: 0.5 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x0d0f11, roughness: 0.8 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x060a0e, roughness: 0.15, metalness: 0.6 });

  let len, headY;
  if (kind === 'truck') {
    len = 9.5;
    // 驾驶室
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.30, 1.85, 2.1), bodyMat);
    cab.position.set(0, 1.55, len / 2 - 1.05);
    g.add(cab);
    const wind = new THREE.Mesh(new THREE.BoxGeometry(2.10, 0.75, 0.10), glassMat);
    wind.position.set(0, 1.95, len / 2 - 0.02);
    g.add(wind);
    // 货厢
    const box = new THREE.Mesh(new THREE.BoxGeometry(2.42, 2.55, 6.6), bodyMat);
    box.position.set(0, 1.95, -len / 2 + 3.35);
    g.add(box);
    // 厢体横纹
    for (let i = 0; i < 4; i++) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(2.46, 0.06, 6.5), darkMat);
      strip.position.set(0, 0.85 + i * 0.62, -len / 2 + 3.35);
      g.add(strip);
    }
    headY = 0.95;
  } else {
    len = 4.45;
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.80, 0.62, len), bodyMat);
    body.position.y = 0.72;
    g.add(body);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.55, 2.3), glassMat);
    cabin.position.set(0, 1.28, -0.15);
    g.add(cabin);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.08, 1.9), bodyMat);
    roof.position.set(0, 1.56, -0.15);
    g.add(roof);
    headY = 0.78;
  }

  // 车轮（简化）
  const tireGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.26, 10);
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 1 });
  const wz = len > 6 ? [-len / 2 + 1.6, -len / 2 + 6.6, len / 2 - 1.0] : [-1.42, 1.42];
  wz.forEach(z => {
    [-0.92, 0.92].forEach(x => {
      const t = new THREE.Mesh(tireGeo, tireMat);
      t.position.set(x, 0.38, z);
      t.rotation.z = Math.PI / 2;
      g.add(t);
    });
  });

  // 大灯（朝 +Z，即迎面）
  const lx = kind === 'truck' ? 0.86 : 0.66;
  const hz = len / 2 + 0.02;
  const lights = [];
  [lx, -lx].forEach(x => {
    const s = makeHeadlightSprite(2.0, 0xfff4dc, 1.0);
    s.position.set(x, headY, hz);
    g.add(s);
    lights.push(s);
    // 灯体
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.16, 0.05), new THREE.MeshBasicMaterial({ color: 0xfff6dd }));
    lamp.position.set(x, headY, hz - 0.03);
    g.add(lamp);
  });

  // 远光眩光（近距离才明显）
  const glare = makeHeadlightSprite(9, 0xfff2d6, 0.0);
  glare.position.set(0, headY + 0.15, hz + 0.1);
  g.add(glare);

  // 示廓灯（卡车）
  if (kind === 'truck') {
    for (let i = 0; i < 3; i++) {
      const m = makeHeadlightSprite(0.7, 0xff4a2a, 0.7);
      m.position.set(1.24, 2.9 - i * 0.9, -len / 2 + 0.1);
      g.add(m);
    }
  }

  g.userData.lights = lights;
  g.userData.glare = glare;
  g.userData.kind = kind;
  g.userData.speed = (kind === 'truck' ? 9.5 : 12.5) + rnd() * 5;
  return g;
}

const sweepLight = new THREE.PointLight(0xffe9c8, 0, 34, 2);
scene.add(sweepLight);

let nextTrafficAt = 4;

function spawnTraffic(now) {
  const kind = Math.random() < 0.42 ? 'truck' : 'car';
  const v = buildTrafficVehicle(kind, Math.floor(Math.random() * 99999));
  // 迎面来车：出现在前方较远处，沿 +Z 行驶
  const z = camera.position.z - (230 + Math.random() * 130);
  v.position.set(-LANE - 0.1, roadY(z), z);
  v.rotation.y = 0; // 车头朝 +Z
  trafficGroup.add(v);
  traffic.push(v);
}

function updateTraffic(dt) {
  nextTrafficAt -= dt;
  if (nextTrafficAt <= 0 && traffic.length < 3) {
    spawnTraffic();
    nextTrafficAt = 16 + Math.random() * 26;
  }

  let nearest = null, nearestDist = 1e9;

  for (let i = traffic.length - 1; i >= 0; i--) {
    const v = traffic[i];
    v.position.z += v.userData.speed * dt;
    v.position.y = roadY(v.position.z);

    const dz = v.position.z - camera.position.z;
    const d = Math.abs(dz);
    if (dz > 26) {   // 已经掠过
      trafficGroup.remove(v);
      traffic.splice(i, 1);
      continue;
    }
    if (d < nearestDist) { nearestDist = d; nearest = v; }

    // 远近光随距离变化：远处是小亮点，近了眩光变大
    const g = v.userData.glare;
    const prox = clamp(1 - d / 130, 0, 1);
    const sz = 2.4 + prox * prox * 8;
    g.scale.set(sz, sz, 1);
    g.material.opacity = 0.14 + prox * 0.42;
    v.userData.lights.forEach(l => {
      l.material.opacity = 0.55 + prox * 0.45;
      const s = 1.1 + prox * 1.6;
      l.scale.set(s, s, 1);
    });
  }

  if (nearest) {
    sweepLight.position.set(nearest.position.x, nearest.position.y + 0.9, nearest.position.z + 3);
    sweepLight.intensity = clamp(140 * (1 - nearestDist / 60), 0, 160);
  } else {
    sweepLight.intensity *= 0.9;
  }
}

/* ============================================================
   十、粒子：浮尘 / 花粉 / 飞虫 / 低雾
   ============================================================ */
// 浮尘（在镜头附近，随光可见）
const dust = (() => {
  const N = 520;
  const pos = new Float32Array(N * 3);
  const seedArr = new Float32Array(N);
  const rnd = mulberry32(99);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (rnd() - 0.5) * 44;
    pos[i * 3 + 1] = rnd() * 7;
    pos[i * 3 + 2] = (rnd() - 0.5) * 44;
    seedArr[i] = rnd() * 100;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.045, map: TEX.glow, color: 0xc9b489, transparent: true, opacity: 0.32,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  });
  const p = new THREE.Points(geo, mat);
  p.frustumCulled = false;
  scene.add(p);
  return { points: p, seeds: seedArr, base: pos };
})();

// 飞虫（围绕路灯）
const insects = (() => {
  const N = 260;
  const pos = new Float32Array(N * 3);
  const lampIdx = new Int16Array(N);
  const phase = new Float32Array(N);
  const rnd = mulberry32(1234);
  for (let i = 0; i < N; i++) {
    lampIdx[i] = Math.floor(rnd() * lampHeadPositions.length);
    phase[i] = rnd() * 6.2832;
    pos[i * 3] = 0; pos[i * 3 + 1] = -999; pos[i * 3 + 2] = 0;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.055, map: TEX.glow, color: 0xffd79a, transparent: true, opacity: 0.75,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const p = new THREE.Points(geo, mat);
  p.frustumCulled = false;
  scene.add(p);
  return { points: p, lampIdx, phase, arr: pos };
})();

// 贴地薄雾（只保留极淡的一层，避免糊屏）
const mists = [];
(function buildMist() {
  const rnd = mulberry32(451);
  for (let i = 0; i < 6; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: TEX.blob, color: 0x1d2740, transparent: true, opacity: 0.030,
      depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
    }));
    const z = -rnd() * ROAD_LEN;
    s.position.set((rnd() - 0.5) * 24, roadY(z) + 0.5 + rnd() * 0.8, z);
    const sc = 16 + rnd() * 16;
    s.scale.set(sc, sc * 0.28, 1);
    scene.add(s);
    mists.push({ s, baseY: s.position.y, ph: rnd() * 6.2832 });
  }
})();

/* ============================================================
   十一、环境音（WebAudio 程序生成）
   ============================================================ */
const Sound = {
  ctx: null, master: null, started: false, muted: false,
  windGain: null, engGain: null, engOsc: null, noiseBuf: null,

  init() {
    if (this.started) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      const ctx = new AC();
      this.ctx = ctx;
      const master = ctx.createGain();
      master.gain.value = 0;
      master.connect(ctx.destination);
      this.master = master;

      // 噪声缓冲
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;

      // 风
      const wind = ctx.createBufferSource();
      wind.buffer = buf; wind.loop = true;
      const wf = ctx.createBiquadFilter();
      wf.type = 'lowpass'; wf.frequency.value = 380; wf.Q.value = 0.6;
      const wg = ctx.createGain(); wg.gain.value = 0.14;
      wind.connect(wf); wf.connect(wg); wg.connect(master);
      wind.start();
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
      const lg = ctx.createGain(); lg.gain.value = 0.055;
      lfo.connect(lg); lg.connect(wg.gain); lfo.start();
      this.windGain = wg;

      // 自己的引擎
      const eng = ctx.createOscillator(); eng.type = 'sawtooth'; eng.frequency.value = 44;
      const ef = ctx.createBiquadFilter(); ef.type = 'lowpass'; ef.frequency.value = 170; ef.Q.value = 3;
      const eg = ctx.createGain(); eg.gain.value = 0;
      eng.connect(ef); ef.connect(eg); eg.connect(master); eng.start();
      this.engOsc = eng; this.engGain = eg;

      master.gain.linearRampToValueAtTime(this.muted ? 0 : 0.5, ctx.currentTime + 2.5);
      this.started = true;
      this.cricketLoop();

      // 收音机独立接 dest：音乐和环境音的比例各自可调，M 键两边一起静音
      try {
        radio.attach(ctx, ctx.destination);
        radio.fadeIn();
      } catch (e) {
        console.warn('radio attach failed', e);
      }
    } catch (e) {
      console.warn('audio unavailable', e);
    }
  },

  cricketLoop() {
    if (!this.started) return;
    this.chirp();
    setTimeout(() => this.cricketLoop(), 260 + Math.random() * 1100);
  },

  chirp() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const g = ctx.createGain(); g.gain.value = 0;
    if (pan) { pan.pan.value = Math.random() * 1.7 - 0.85; g.connect(pan); pan.connect(this.master); }
    else g.connect(this.master);

    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = 3600 + Math.random() * 1400;
    o.connect(g);

    const n = 2 + Math.floor(Math.random() * 3);
    const amp = 0.018 + Math.random() * 0.022;
    for (let i = 0; i < n; i++) {
      const t = t0 + i * 0.055;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(amp, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    }
    o.start(t0);
    o.stop(t0 + n * 0.06 + 0.1);
    setTimeout(() => {
      try { o.disconnect(); g.disconnect(); if (pan) pan.disconnect(); } catch (e) {}
    }, (n * 0.06 + 0.4) * 1000);
  },

  footstep() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.7 + Math.random() * 0.5;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 260 + Math.random() * 220; bp.Q.value = 1.1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.12 + Math.random() * 0.06, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(t0); src.stop(t0 + 0.2);
    setTimeout(() => { try { src.disconnect(); bp.disconnect(); g.disconnect(); } catch (e) {} }, 400);
  },

  update(dt, mode, speed, nearestTrafficDist) {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    // 引擎
    const running = (mode === 'drive' || mode === 'stopping') ? clamp(speed / DRIVE_SPEED, 0, 1) : 0;
    this.engGain.gain.setTargetAtTime(0.035 * running, t, 0.3);
    this.engOsc.frequency.setTargetAtTime(38 + running * 16, t, 0.4);
    // 风：走动时更明显
    const w = mode === 'walk' ? 0.19 : 0.12;
    this.windGain.gain.setTargetAtTime(w, t, 1.2);
    // 会车：远处引擎声
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, t, 0.15);
  },

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, this.ctx.currentTime, 0.2);
    return this.muted;
  }
};

/* ============================================================
   十一半、老收音机（播放列表 + 界面）
   ============================================================ */
const radioEl = document.getElementById('radio');
const rdFreqEl = document.getElementById('rd-freq');
const rdNeedleEl = document.getElementById('rd-needle');
const rdTitleEl = document.getElementById('rd-title');
const rdArtistEl = document.getElementById('rd-artist');
const rdListEl = document.getElementById('rd-list');
const rdBarsEls = Array.from(document.querySelectorAll('#rd-bars i'));
const rdHintEl = document.getElementById('rd-hint');

let barLevel = 1;
let barJitter = 0;
let nextBarAt = 0;

function paintBars() {
  rdBarsEls.forEach((b, i) => {
    b.style.height = (3.5 + i * 1.8) + 'px';
    b.classList.toggle('on', i < barLevel + barJitter);
  });
}

function paintRadio(st) {
  try {
  const t = st.track;
  rdFreqEl.textContent = t ? t.freq.toFixed(1) : '96.4';
  const pct = t ? ((t.freq - 88) / 20) * 100 : 41;
  rdNeedleEl.style.left = 'calc(' + pct.toFixed(2) + '% - 1px)';
  rdTitleEl.textContent = t ? t.title : '—';
  rdArtistEl.textContent = t ? t.artist : '未选台';

  Array.from(rdListEl.children).forEach((row, i) => {
    row.classList.toggle('active', i === st.index);
    row.classList.toggle('found', !!st.available[i]);
    row.classList.toggle('missing', !st.available[i]);
  });

  const found = (st.available || []).filter(Boolean).length;
  const src = st.index >= 0 ? st.available[st.index] : null;
  const suspended = radio.ctx && radio.ctx.state !== 'running';

  if (suspended) {
    rdHintEl.textContent = '浏览器拦着声音 · 点一下画面任意处';
  } else if (src) {
    const name = decodeURIComponent(src.split('/').pop());
    rdHintEl.textContent = (src.indexOf('blob:') === 0 ? '本地文件 · ' : 'music/ · ') + name;
  } else if (st.index >= 0 && radio.usingSynth) {
    rdHintEl.textContent = '这首没有音频文件 · 正在播电台垫音（可用 ' + found + '/' + PLAYLIST.length + '）';
  } else if (found > 0) {
    rdHintEl.textContent = '已找到 ' + found + '/' + PLAYLIST.length + ' 首音频';
  } else {
    rdHintEl.textContent = '没有音频文件 · 现在播的是电台垫音';
  }

  barLevel = st.index < 0 ? 1 : (found > 0 ? 4 : 3);
  paintBars();
  } catch (e) {
    console.error('paintRadio failed:', e && e.message, e && e.stack ? e.stack.split('\n')[1] : '');
  }
}

const radio = new Radio({ onState: paintRadio });

/* 生成曲目列表 */
(function buildRadioList() {
  PLAYLIST.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'row missing';
    row.innerHTML =
      '<span class="tick"></span>' +
      '<span class="no">' + s.n + '</span>' +
      '<span class="tt">' + s.title + '</span>' +
      '<span class="fq">' + s.freq.toFixed(1) + '</span>';
    row.addEventListener('click', async () => {
      const ok = await radio.play(i);
      if (!ok) showCaption('浏览器拦住了声音，点一下画面再试', 2600);
      else showCaption('调到 ' + s.freq.toFixed(1) + ' · ' + s.title, 2400);
    });
    rdListEl.appendChild(row);
  });
})();

/* 选本地文件：绕开服务器目录探测，代价是刷新后要重选 */
const rdPickEl = document.getElementById('rd-pick');
const rdFileEl = document.getElementById('rd-file');

async function loadFiles(files) {
  const n = radio.setLocalFiles(files);
  if (!n) {
    showCaption('没有识别到音频文件', 2200);
    return;
  }
  const i = radio.index >= 0 ? radio.index : 0;
  await radio.play(i, { skipProbe: true });
  showCaption('已载入 ' + n + ' 个音频文件', 2600);
}

rdPickEl.addEventListener('click', (e) => {
  e.stopPropagation();
  rdFileEl.click();
});
rdFileEl.addEventListener('change', () => {
  loadFiles(rdFileEl.files);
  rdFileEl.value = '';
});

/* 拖进来也行 */
radioEl.addEventListener('dragover', (e) => {
  e.preventDefault();
  radioEl.classList.add('dragover');
});
radioEl.addEventListener('dragleave', () => radioEl.classList.remove('dragover'));
radioEl.addEventListener('drop', (e) => {
  e.preventDefault();
  radioEl.classList.remove('dragover');
  if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) loadFiles(e.dataTransfer.files);
});

/* 折叠 */
const rdToggleEl = document.getElementById('rd-toggle');
rdToggleEl.addEventListener('click', (e) => {
  e.stopPropagation();
  const open = radioEl.classList.toggle('open');
  rdToggleEl.textContent = open ? '收起' : '曲目';
});
radioEl.classList.add('open');

/* 先探测 music/ 里有哪些文件（不需要用户交互；延后几秒，别跟首帧抢带宽） */
setTimeout(() => radio.detect(), 3200);

/* ============================================================
   十二、交互状态机
   ============================================================ */
const state = {
  mode: 'drive',
  dist: 0,
  speed: DRIVE_SPEED,
  targetSpeed: DRIVE_SPEED,
  truckX: LANE,
  yaw: 0, pitch: -0.035,
  headTurn: 0, headTurnTarget: 0,
  trans: null,
  walkPos: new THREE.Vector3(),
  walkDist: 0,
  stepPhase: 0,
  started: false,
};

const keys = {};
document.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'KeyE') toggleVehicle();
  if (e.code === 'KeyM') {
    const muted = Sound.toggleMute();
    radio.setMuted(muted);
    showCaption(muted ? '静音' : '声音开启', 1200);
  }
  if (e.code === 'KeyR') {
    const open = radioEl.classList.toggle('open');
    rdToggleEl.textContent = open ? '收起' : '曲目';
  }
  if (e.code === 'KeyH') {
    document.querySelectorAll('.hud').forEach(el => el.classList.toggle('show'));
    radioEl.classList.toggle('show');
  }
});
document.addEventListener('keyup', e => { keys[e.code] = false; });

// 驾驶时的轻微头部转动（鼠标横向位置）
document.addEventListener('mousemove', e => {
  if (document.pointerLockElement) {
    state.yaw -= e.movementX * 0.0022;
    state.pitch = clamp(state.pitch - e.movementY * 0.0020, -1.15, 1.15);
  } else if (state.mode === 'drive' || state.mode === 'stopping') {
    state.headTurnTarget = clamp(-(e.clientX / window.innerWidth - 0.5) * 0.72, -0.42, 0.42);
  }
});

/* 字幕 */
let captionTimer = null;
function showCaption(text, ms = 4200) {
  const el = document.getElementById('caption');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(captionTimer);
  captionTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/* 上下车 */
const tmpV = new THREE.Vector3();
const euler = new THREE.Euler(0, 0, 0, 'YXZ');

function cabPosition(out) {
  return out.set(state.truckX + 0.40, roadY(-state.dist) + 1.55, -state.dist - 1.00);
}

function toggleVehicle() {
  if (!state.started) return;
  if (state.mode === 'drive') {
    // 靠边停车
    state.mode = 'stopping';
    state.targetSpeed = 0;
    setModeText('靠边停车…');
  } else if (state.mode === 'walk') {
    // 距离车近了才能上车
    const dz = state.walkPos.z - (-state.dist);
    const dx = state.walkPos.x - state.truckX;
    if (Math.hypot(dx, dz) < 5.5) {
      startEnterTruck();
    } else {
      showCaption('离车太远了，往回走一点', 2000);
    }
  }
}

function startExitTruck() {
  state.mode = 'exiting';
  const from = cabPosition(new THREE.Vector3());
  const z = -state.dist;
  const to = new THREE.Vector3(state.truckX + 1.55, roadY(z) + EYE, z - 0.55);
  state.trans = {
    t: 0, dur: 1.9, from, to,
    yawFrom: state.headTurn, yawTo: -0.30,
    pitchFrom: -0.035, pitchTo: -0.02,
  };
  setModeText('下车 · 漫步');
  document.getElementById('hud-right').innerHTML = '<div><b>W A S D</b>走动</div><div><b>E</b>上车</div><div><b>M</b>静音　<b>H</b>隐藏</div>';
  showCaption('下车。空气里有泥土、树叶，还有说不清的花香。', 5200);
}

function startEnterTruck() {
  state.mode = 'entering';
  const from = camera.position.clone();
  const to = cabPosition(new THREE.Vector3());
  state.trans = {
    t: 0, dur: 1.7, from, to,
    yawFrom: state.yaw, yawTo: 0,
    pitchFrom: state.pitch, pitchTo: -0.035,
  };
  setModeText('上车');
  document.getElementById('hud-right').innerHTML = '<div><b>E</b>下车</div><div><b>M</b>静音　<b>H</b>隐藏</div>';
}

function setModeText(t) {
  document.getElementById('mode-text').textContent = t;
}

/* ============================================================
   十三、主循环
   ============================================================ */
const clock = new THREE.Clock();
let time = 0;
const pooledLights = [];
for (let i = 0; i < 4; i++) {
  const l = new THREE.PointLight(0xffb055, 0, 38, 2);
  scene.add(l);
  pooledLights.push(l);
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  time += dt;

  if (state.started) {
    if (state.mode === 'drive' || state.mode === 'stopping') updateDrive(dt);
    else if (state.mode === 'walk') updateWalk(dt);
    else if (state.mode === 'exiting' || state.mode === 'entering') updateTransition(dt);

    updateTraffic(dt);
    updateParticles(dt);
    updateStreetlightPooling(dt);

    let nd = 1e9;
    for (const v of traffic) nd = Math.min(nd, Math.abs(v.position.z - camera.position.z));
    Sound.update(dt, state.mode, state.speed, nd);
    radio.update(dt);
  }

  // 信号格轻微跳动
  if (time > nextBarAt) {
    nextBarAt = time + 0.22 + Math.random() * 0.55;
    barJitter = Math.random() < 0.34 ? 1 : 0;
    paintBars();
  }

  // 星空微闪
  if (window.__stars) window.__stars.opacity = 0.72 + Math.sin(time * 1.3) * 0.06;
  // 远景剪影环跟着镜头走，始终保持在地平线那一圈
  if (farRidge) { farRidge.position.x = camera.position.x; farRidge.position.z = camera.position.z; }

  renderer.render(scene, camera);
}

function updateDrive(dt) {
  // 速度
  state.speed = lerp(state.speed, state.targetSpeed, clamp(dt * 1.1, 0, 1));
  if (state.mode === 'drive' && state.speed > 1) {
    state.truckX = lerp(state.truckX, LANE, clamp(dt * 0.30, 0, 1));
  }
  if (state.mode === 'stopping') {
    // 靠边
    state.truckX = lerp(state.truckX, LANE + 1.15, clamp(dt * 0.7, 0, 1));
    if (state.speed < 0.12) {
      state.speed = 0;
      startExitTruck();
      return;
    }
  }

  state.dist += state.speed * dt;

  // 循环（走完整段路后回到起点，用黑场遮一下）
  if (state.dist > ROAD_LEN - 80) {
    state.dist = 0;
    const fadeEl = document.getElementById('fade');
    fadeEl.style.opacity = '1';
    setTimeout(() => { fadeEl.style.opacity = '0'; }, 260);
    traffic.forEach(v => trafficGroup.remove(v));
    traffic.length = 0;
  }

  const z = -state.dist;
  const y = roadY(z);
  const slope = (roadY(z - 14) - roadY(z + 14)) / 28;
  const pitchFollow = Math.atan(slope);
  truck.position.set(state.truckX, y, z);
  truck.rotation.x = pitchFollow;
  truck.rotation.z = Math.sin(state.dist * 0.6) * 0.004 - state.headTurn * 0.02;

  // 车轮
  const spin = state.speed * dt / 0.36;
  truckWheels.forEach(w => { w.rotation.x += spin; });

  // 相机（副驾）
  const bumpAmt = clamp(state.speed / DRIVE_SPEED, 0, 1);
  const bump = (Math.sin(state.dist * 2.3) * 0.010 + Math.sin(state.dist * 6.7 + 1.1) * 0.006
              + Math.sin(state.dist * 13.1) * 0.003) * bumpAmt;

  state.headTurn = lerp(state.headTurn, state.headTurnTarget, clamp(dt * 2.2, 0, 1));

  if (!interior.visible && !interiorHidden) interior.visible = true;
  camera.position.set(
    state.truckX + 0.40,
    y + 1.55 + bump,
    z - 1.00
  );
  camera.rotation.set(
    -0.028 + pitchFollow + bump * 0.5,
    state.headTurn * 0.55,
    Math.sin(state.dist * 1.7) * 0.0045 * bumpAmt
  );

  // 里程/速度 HUD
  document.getElementById('spd').textContent = Math.round(state.speed * 3.6);
  if (state.mode === 'drive') setModeText('副驾 · 行驶中');
}

function updateWalk(dt) {
  if (interior.visible) interior.visible = false;   // 下车后收起车内框景
  const fwd = new THREE.Vector3(-Math.sin(state.yaw), 0, -Math.cos(state.yaw));
  const right = new THREE.Vector3(Math.cos(state.yaw), 0, -Math.sin(state.yaw));
  const move = new THREE.Vector3();
  if (keys['KeyW']) move.add(fwd);
  if (keys['KeyS']) move.sub(fwd);
  if (keys['KeyD']) move.add(right);
  if (keys['KeyA']) move.sub(right);

  const sprint = keys['ShiftLeft'] || keys['ShiftRight'];
  const spd = sprint ? 2.6 : 1.35;

  if (move.lengthSq() > 0) {
    move.normalize().multiplyScalar(spd * dt);
    state.walkPos.add(move);
    state.walkDist += move.length();

    // 脚步
    const prev = Math.floor(state.stepPhase / Math.PI);
    state.stepPhase += move.length() * 3.4;
    if (Math.floor(state.stepPhase / Math.PI) !== prev) Sound.footstep();
  }

  // 边界
  state.walkPos.x = clamp(state.walkPos.x, -34, 34);

  const onRoad = Math.abs(state.walkPos.x) < ROAD_HW;
  const gy = roadY(state.walkPos.z) + (onRoad ? 0 : -0.10);
  const bob = Math.sin(state.stepPhase) * 0.028;
  const sway = Math.cos(state.stepPhase * 0.5) * 0.012;

  camera.position.set(state.walkPos.x, gy + EYE + bob, state.walkPos.z);
  camera.rotation.set(state.pitch, state.yaw, sway);

  document.getElementById('spd').textContent = '—';
}

function updateTransition(dt) {
  const tr = state.trans;
  tr.t += dt / tr.dur;
  const k = smooth(clamp(tr.t, 0, 1));

  camera.position.lerpVectors(tr.from, tr.to, k);
  const yaw = lerp(tr.yawFrom, tr.yawTo, k);
  const pitch = lerp(tr.pitchFrom, tr.pitchTo, k);
  camera.rotation.set(pitch, yaw, 0);

  if (tr.t >= 1) {
    if (state.mode === 'exiting') {
      state.mode = 'walk';
      state.yaw = tr.yawTo;
      state.pitch = tr.pitchTo;
      state.walkPos.copy(camera.position);
      state.walkPos.y = 0;
      state.truckX = state.truckX;
      document.body.requestPointerLock?.();
      setModeText('漫步 · 乡道边');
    } else {
      state.mode = 'drive';
      state.speed = 0;
      state.targetSpeed = DRIVE_SPEED;
      setModeText('副驾 · 行驶中');
      document.exitPointerLock?.();
    }
  }
}

function updateParticles(dt) {
  // 浮尘
  const arr = dust.points.geometry.attributes.position.array;
  const c = camera.position;
  for (let i = 0; i < arr.length / 3; i++) {
    const i3 = i * 3;
    const s = dust.seeds[i];
    arr[i3 + 1] += (0.12 + Math.sin(time * 0.7 + s) * 0.10) * dt;
    arr[i3] += (0.18 + Math.sin(time * 0.4 + s * 1.7) * 0.14) * dt;
    arr[i3 + 2] += Math.cos(time * 0.3 + s) * 0.10 * dt;
    // 相对相机循环
    if (arr[i3] - c.x > 23) arr[i3] -= 46;
    if (arr[i3] - c.x < -23) arr[i3] += 46;
    if (arr[i3 + 2] - c.z > 23) arr[i3 + 2] -= 46;
    if (arr[i3 + 2] - c.z < -23) arr[i3 + 2] += 46;
    if (arr[i3 + 1] - c.y > 6) arr[i3 + 1] -= 6;
    if (arr[i3 + 1] - c.y < -1.5) arr[i3 + 1] += 6;
    // 离镜头太近的粒子会被透视放大成巨大光斑，推到 1.5m 外
    const dx = arr[i3] - c.x, dz = arr[i3 + 2] - c.z;
    const r2 = dx * dx + dz * dz;
    if (r2 < 2.25) {
      const r = Math.sqrt(r2) || 0.001;
      arr[i3] = c.x + (dx / r) * 1.5;
      arr[i3 + 2] = c.z + (dz / r) * 1.5;
    }
  }
  dust.points.geometry.attributes.position.needsUpdate = true;

  // 飞虫
  const ia = insects.points.geometry.attributes.position.array;
  for (let i = 0; i < ia.length / 3; i++) {
    const i3 = i * 3;
    const base = lampHeadPositions[insects.lampIdx[i]];
    if (!base) continue;
    const ph = insects.phase[i];
    ia[i3] = base.x + Math.sin(time * 1.9 + ph) * 0.85 + Math.sin(time * 4.3 + ph * 2) * 0.22;
    ia[i3 + 1] = base.y - 0.25 + Math.sin(time * 2.6 + ph * 1.3) * 0.45;
    ia[i3 + 2] = base.z + Math.cos(time * 1.6 + ph) * 0.85 + Math.cos(time * 3.7 + ph) * 0.22;
  }
  insects.points.geometry.attributes.position.needsUpdate = true;

  // 薄雾漂移
  mists.forEach(m => {
    m.s.position.y = m.baseY + Math.sin(time * 0.25 + m.ph) * 0.25;
    m.s.position.x += Math.sin(time * 0.12 + m.ph) * 0.002;
  });
}

/** 三个动态点光源吸附到最近的几盏路灯 */
function updateStreetlightPooling(dt) {
  // 找最近的三盏灯
  const cz = camera.position.z;
  const sorted = lampData
    .map(l => ({ l, d: Math.abs(l.z - cz) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 4);

  pooledLights.forEach((pl, i) => {
    const item = sorted[i];
    if (item && item.d < 62) {
      pl.position.set(item.l.x, item.l.y - 0.35, item.l.z);
      const fall = clamp(1 - item.d / 62, 0, 1);
      pl.intensity = 56 * fall + 10;
    } else {
      pl.intensity = 0;
    }
  });
}

/* ============================================================
   十四、初始化
   ============================================================ */
function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);

// 初始相机位置
camera.position.set(LANE + 0.40, roadY(0) + 1.55, -1.00);
truck.position.set(LANE, roadY(0), 0);

// —— 调试参数：?auto 跳过开场，?skip=米数 直接定位到路上某处，?walk 以漫步视角开场 ——
const QS = new URLSearchParams(location.search);
const AUTO = QS.has('auto');
const SKIP = parseFloat(QS.get('skip') || '0') || 0;
const START_WALK = QS.has('walk');
if (SKIP > 0) state.dist = SKIP;

function startExperience(withSound = true) {
  const intro = document.getElementById('intro');
  intro.classList.add('hide');
  setTimeout(() => { intro.style.display = 'none'; }, 1700);
  document.getElementById('hud-left').classList.add('show');
  document.getElementById('hud-right').classList.add('show');
  document.getElementById('place').classList.add('show');
  radioEl.classList.add('show');
  // ?radio 用于无头环境自检音频链路（配合 --autoplay-policy=no-user-gesture-required）
  const wantAudio = withSound || QS.has('radio');
  if (wantAudio) {
    Sound.init();
    // 浏览器要求先有用户手势，这里才敢开台
    setTimeout(() => { if (radio.index < 0) radio.play(0); }, QS.has('radio') ? 400 : 1500);
  }
  state.started = true;
  state.walkPos.set(camera.position.x, 0, camera.position.z);

  // 调试：?sim=秒 先把模拟快进 N 秒（用于截图某个瞬间）
  const SIMT = parseFloat(QS.get('sim') || '0') || 0;
  if (SIMT > 0) {
    const dt = 1 / 60;
    for (let i = 0, n = Math.round(SIMT * 60); i < n; i++) {
      if (state.mode === 'drive' || state.mode === 'stopping') updateDrive(dt);
      updateTraffic(dt);
    }
  }
  if (START_WALK) {
    const z = -state.dist;
    state.mode = 'walk';
    state.walkPos.set(state.truckX + 1.55, 0, z - 1.1);
    state.yaw = -0.30;
    state.pitch = -0.02;
    setModeText('漫步 · 乡道边');
    document.getElementById('hud-right').innerHTML = '<div><b>W A S D</b>走动</div><div><b>E</b>上车</div><div><b>R</b>收音机　<b>M</b>静音</div><div><b>H</b>隐藏</div>';
  } else {
    setTimeout(() => showCaption('路是水泥的，有点破。远处的车开着远光。', 5000), 2600);
  }
}

// 预渲染一帧，避免进入黑屏
animate();
renderer.render(scene, camera);

document.getElementById('loading').textContent = '准备就绪';
const enterBtn = document.getElementById('enter');
enterBtn.disabled = false;
enterBtn.addEventListener('click', () => startExperience(true));

if (AUTO) startExperience(false);

/* 音频自检：?audiochk 每 800ms 打一次链路状态与输出电平（headless 里读 console 用） */
if (QS.has('audiochk')) {
  setInterval(() => {
    console.log(
      'ACHK ctx=' + (Sound.ctx ? Sound.ctx.state : 'none') +
      ' out=' + (radio.out ? radio.out.gain.value.toFixed(3) : '-') +
      ' synth=' + radio.usingSynth +
      ' idx=' + radio.index +
      ' muted=' + radio.muted +
      ' avail=' + ((radio.available || []).filter(Boolean).length) +
      ' url=' + ((radio.available && radio.available[radio.index]) || 'none') +
      ' aPaused=' + (radio.audio ? radio.audio.paused : '?') +
      ' rms=' + radio.level().toFixed(4)
    );
  }, 800);
}

/* —— 调试开关：?hide=beam,lampglow,win,cars,pool,interior —— */
(function applyDebugHides() {
  const hide = (QS.get('hide') || '').split(',').filter(Boolean);
  if (!hide.length) return;
  const has = k => hide.includes(k);
  if (has('beam') && window.__beam) window.__beam.visible = false;
  if (has('lampglow') && window.__lampGlow) window.__lampGlow.visible = false;
  if (has('pool') && window.__pool) window.__pool.visible = false;
  if (has('win')) (window.__winGlow || []).forEach(s => { s.visible = false; });
  if (has('cars')) trafficGroup.visible = false;
  if (has('interior')) { interiorHidden = true; interior.visible = false; }
  if (has('sky')) sky.visible = false;
  if (has('ground')) ground.visible = false;
  if (has('road')) road.visible = false;
  if (has('truck')) truck.visible = false;
  if (has('dust')) dust.points.visible = false;
  if (has('insects')) insects.points.visible = false;
  if (has('mist')) mists.forEach(m => { m.s.visible = false; });
  if (has('stone')) window.__stars && (window.__stars.opacity = 0);
  if (has('truckglow')) (window.__truckGlow || []).forEach(o => { o.visible = false; });
  if (has('props')) propGroup.visible = false;
  if (has('veg')) (window.__veg || []).forEach(o => { o.visible = false; });
})();

/* —— 像素探针：?probe 逐个隐藏卡车子对象，输出上方区域亮度（调试用） —— */
if (QS.has('probe')) {
  setTimeout(() => {
    const gl = renderer.getContext();
    const W = 300, H = 200;
    const px = new Uint8Array(4 * W * H);
    const readRegion = () => {
      renderer.render(scene, camera);
      const bw = gl.drawingBufferWidth, bh = gl.drawingBufferHeight;
      gl.readPixels(Math.floor(bw * 0.30), Math.floor(bh * 0.06), W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let s = 0;
      for (let i = 0; i < px.length; i += 4) s += px[i] + px[i + 1] + px[i + 2];
      return s / (px.length / 4) / 3;
    };
    console.log('PROBE base', readRegion().toFixed(1));
    scene.children.forEach((c, i) => {
      if (!c.visible) return;
      c.visible = false;
      const val = readRegion();
      c.visible = true;
      console.log('PROBE top', i, c.type, c.name || '', c.geometry ? c.geometry.type : '', val.toFixed(1));
    });
  }, 2000);
}

// 点击画面（漫步时重新锁定鼠标）
renderer.domElement.addEventListener('click', () => {
  if (state.mode === 'walk' && !document.pointerLockElement) {
    document.body.requestPointerLock?.();
  }
});
