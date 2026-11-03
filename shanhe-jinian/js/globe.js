/* ============================================================
   globe.js — 纸面地球：双球交叉淡化、拾取、标注投影、飞行
   ============================================================ */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { EraPainter, lonLatToVec3, featureAt } from './maprender.js';

const R = 100;

export class Globe {
  constructor(canvas) {
    this.canvas = canvas;
    this.R = R;
    this.painter = new EraPainter(4096, 2048);
    this.overlayPainter = document.createElement('canvas');
    this.overlayPainter.width = 4096;
    this.overlayPainter.height = 2048;

    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, alpha: true, powerPreference: 'high-performance',
    });
    this.renderer.setClearAlpha(0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.5, 3000);
    // 初始朝向东亚（约 100°E, 28°N），赤道略高一点的视角
    const start = lonLatToVec3(100, 28, 1);
    this.camera.position.set(start.x, start.y, start.z).normalize().multiplyScalar(520);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.rotateSpeed = 0.62;
    this.controls.zoomSpeed = 0.75;
    this.controls.enablePan = false;
    this.controls.minDistance = 160;
    this.controls.maxDistance = 700;
    this.controls.autoRotate = false;
    this.controls.autoRotateSpeed = 0.05;
    // 用户拖动/缩放时视角变了必须重绘，否则只有 DOM 标签在动
    this.controls.addEventListener('change', () => { this._needsRender = true; });

    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.scene.add(new THREE.AmbientLight(0xfff4e0, 1.55));
    const key = new THREE.DirectionalLight(0xffeed2, 1.15);
    key.position.set(-380, 420, 300);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xd9e4ef, 0.30);
    fill.position.set(420, -300, -260);
    this.scene.add(fill);

    this.geom = new THREE.SphereGeometry(R, 150, 104);

    // 两层球，交叉淡化
    this.slots = [0, 1].map(() => {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 1,
      });
      const mesh = new THREE.Mesh(this.geom, mat);
      mesh.userData.pickable = true;
      this.group.add(mesh);
      return { mesh, mat, tex: null };
    });
    this.active = 0;
    this.slots[0].mesh.visible = true;
    this.slots[1].mesh.visible = false;

    // 选中地块高亮层
    this.hlTex = new THREE.CanvasTexture(this.overlayPainter);
    this.hlTex.colorSpace = THREE.SRGBColorSpace;
    const hlMat = new THREE.MeshBasicMaterial({
      map: this.hlTex, transparent: true, opacity: 0.95, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2,
    });
    this.hlMesh = new THREE.Mesh(new THREE.SphereGeometry(R * 1.0015, 150, 104), hlMat);
    this.hlMesh.renderOrder = 2;
    this.group.add(this.hlMesh);

    // 大气边缘光
    const atmMat = new THREE.ShaderMaterial({
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide,
      uniforms: { uColor: { value: new THREE.Color(0xffd9a0) }, uPow: { value: 3.4 }, uInt: { value: 0.10 } },
      vertexShader: `
        varying vec3 vN; varying vec3 vV;
        void main(){
          vec4 wp = modelMatrix * vec4(position,1.0);
          vN = normalize(mat3(modelMatrix) * normal);
          vV = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform vec3 uColor; uniform float uPow; uniform float uInt;
        varying vec3 vN; varying vec3 vV;
        void main(){
          float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
          f = pow(clamp(f,0.0,1.0), uPow) * uInt;
          gl_FragColor = vec4(uColor, f);
        }`,
    });
    this.atm = new THREE.Mesh(new THREE.SphereGeometry(R * 1.028, 96, 64), atmMat);
    this.atm.renderOrder = 3;
    this.scene.add(this.atm);

    // 球缘暗角：越靠边越沉，像旧铜版地球的圆边
    const shadeMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.FrontSide,
      uniforms: { uColor: { value: new THREE.Color(0x3a2410) }, uInt: { value: 0.46 } },
      vertexShader: `
        varying vec3 vN; varying vec3 vV;
        void main(){
          vec4 wp = modelMatrix * vec4(position,1.0);
          vN = normalize(mat3(modelMatrix) * normal);
          vV = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform vec3 uColor; uniform float uInt;
        varying vec3 vN; varying vec3 vV;
        void main(){
          float d = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
          float f = pow(1.0 - d, 2.1) * uInt;
          gl_FragColor = vec4(uColor, f);
        }`,
    });
    this.shade = new THREE.Mesh(new THREE.SphereGeometry(R * 1.003, 128, 84), shadeMat);
    this.shade.renderOrder = 4;
    this.group.add(this.shade);

    this.relationsGroup = new THREE.Group();
    this.group.add(this.relationsGroup);

    this.era = null;
    this.raycaster = new THREE.Raycaster();
    this._tmp = new THREE.Vector3();
    this._needsRender = true;
    this._anim = null;
    this._frame = 0;

    this._resize();
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(canvas.parentElement || canvas);
    this.clock = new THREE.Clock();
    this._tick = this._tick.bind(this);
    this.running = true;
    requestAnimationFrame(this._tick);
  }

  _resize() {
    const el = this.canvas.parentElement || this.canvas;
    const w = Math.max(320, el.clientWidth || window.innerWidth);
    const h = Math.max(320, el.clientHeight || window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // 竖屏时把球推远，避免裁切
    const fit = Math.min(1, (w / h) / 1.15);
    this.camera.fov = 32 / Math.max(0.55, fit);
    // 左侧卷轴占位：把球心推到空白处，避免被面板压住
    const shift = (w >= 1120 && this.panelOpen) ? Math.min(58, w * 0.045) : 0;
    if (shift) this.camera.setViewOffset(w, h, -shift, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    this.width = w; this.height = h;
    this._needsRender = true;
  }

  /* ---------------------------------------------------------- era */
  setEra(mapData, { instant = false } = {}) {
    this.era = mapData;
    const t0 = performance.now();
    const cnv = this.painter.paint(mapData);
    const tex = new THREE.CanvasTexture(cnv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    tex.needsUpdate = true;
    this.paintMs = performance.now() - t0;

    const next = 1 - this.active;
    const slot = this.slots[next];
    if (slot.tex) slot.tex.dispose();
    slot.tex = tex;
    slot.mat.map = tex;
    slot.mat.opacity = instant ? 1 : 0;
    slot.mat.needsUpdate = true;
    slot.mesh.visible = true;

    if (instant) {
      const cur = this.slots[this.active];
      cur.mat.opacity = 0;
      cur.mesh.visible = false;
      this.active = next;
      slot.mat.opacity = 1;
      this._needsRender = true;
      return Promise.resolve();
    }
    // 交叉淡化
    const from = this.slots[this.active];
    this.active = next;
    return new Promise((resolve) => {
      this._fade = { from, to: slot, t: 0, dur: 460, resolve };
      this._needsRender = true;
    });
  }

  clearSelection() {
    const ctx = this.overlayPainter.getContext('2d');
    ctx.clearRect(0, 0, 4096, 2048);
    this.hlTex.needsUpdate = true;
    this._needsRender = true;
  }

  setSelection(features) {
    const ctx = this.overlayPainter.getContext('2d');
    this.painter.paintOverlay(ctx, this.era, features.map(f => f.id));
    this.hlTex.needsUpdate = true;
    this._needsRender = true;
  }

  /* ---------------------------------------------------------- picking */
  pickAt(clientX, clientY) {
    if (!this.era) return null;
    const rect = this.canvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera({ x: nx, y: ny }, this.camera);
    const hit = this.raycaster.intersectObject(this.slots[this.active].mesh, false)[0];
    if (!hit || !hit.uv) return null;
    const lon = hit.uv.x * 360 - 180;
    const lat = hit.uv.y * 180 - 90;
    const feature = featureAt(this.era, lon, lat);
    return { lon, lat, feature };
  }

  /** 经纬度投影到屏幕坐标 */
  project(lon, lat) {
    const ll = lonLatToVec3(lon, lat, R);
    const world = new THREE.Vector3(ll.x, ll.y, ll.z).applyMatrix4(this.group.matrixWorld);
    const facing = world.clone().normalize().dot(this.camera.position.clone().normalize());
    world.project(this.camera);
    return {
      x: (world.x * 0.5 + 0.5) * this.width,
      y: (-world.y * 0.5 + 0.5) * this.height,
      facing,
      behind: world.z > 1,
    };
  }

  /** 屏幕像素 / 视角度 */
  get pxPerDeg() {
    const fov = this.camera.fov * Math.PI / 180;
    return this.height / (2 * Math.tan(fov / 2)) * (Math.PI / 180) * (this.camera.position.length() / R) / 1.0;
  }

  flyTo(lon, lat, { dist = null, ms = 900 } = {}) {
    const target = lonLatToVec3(lon, lat, 1);
    const tgt = new THREE.Vector3(target.x, target.y, target.z).normalize();
    const cur = this.camera.position.clone();
    const fromDir = cur.clone().normalize();
    const fromDist = cur.length();
    const toDist = dist ?? Math.min(fromDist, 470);
    const q = new THREE.Quaternion().setFromUnitVectors(fromDir, tgt);
    const start = performance.now();
    this.controls.autoRotate = false;
    this._anim = { q, fromDist, toDist, start, ms, base: fromDir.clone() };
    return new Promise((res) => { this._anim.res = res; });
  }

  setAutoRotate(on) { this.controls.autoRotate = on; }

  setPanel(on) {
    if (this.panelOpen === on) return;
    this.panelOpen = on;
    const d = this.camera.position.length();
    if (on) {
      this._prePanelDist = d;
      this._dollyTo(Math.min(680, d * 1.17));
    } else if (this._prePanelDist) {
      this._dollyTo(this._prePanelDist);
      this._prePanelDist = null;
    }
    this._resize();
  }

  _dollyTo(to, ms = 520) {
    this._dolly = { from: this.camera.position.length(), to, start: performance.now(), ms };
  }

  /* ---------------------------------------------------------- loop */
  _tick() {
    if (!this.running) return;
    requestAnimationFrame(this._tick);
    const dt = Math.min(0.05, this.clock.getDelta());
    this._frame++;

    if (this._anim) {
      const a = this._anim;
      const k = Math.min(1, (performance.now() - a.start) / a.ms);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const qi = new THREE.Quaternion().slerp(a.q, e);
      const d = a.base.clone().applyQuaternion(qi).normalize();
      const dist = a.fromDist + (a.toDist - a.fromDist) * e;
      this.camera.position.copy(d.multiplyScalar(dist));
      this.camera.lookAt(0, 0, 0);
      this.controls.update();
      if (k >= 1) { this._anim = null; a.res && a.res(); }
      this._needsRender = true;
    } else {
      if (this._dolly) {
        const dl = this._dolly;
        const k = Math.min(1, (performance.now() - dl.start) / dl.ms);
        const e = 1 - Math.pow(1 - k, 3);
        this.camera.position.setLength(dl.from + (dl.to - dl.from) * e);
        if (k >= 1) this._dolly = null;
        this._needsRender = true;
      }
      this.controls.update();
    }

    // 相机若被任何来源（拖动/滚轮/键盘/程序）改动，必须重绘
    const cp = this.camera.position, cq = this.camera.quaternion;
    const ck = this._camKey;
    if (!ck || Math.abs(cp.x - ck[0]) > 1e-4 || Math.abs(cp.y - ck[1]) > 1e-4 ||
        Math.abs(cp.z - ck[2]) > 1e-4 || Math.abs(cq.x - ck[3]) > 1e-5 ||
        Math.abs(cq.y - ck[4]) > 1e-5 || Math.abs(cq.z - ck[5]) > 1e-5 ||
        Math.abs(cq.w - ck[6]) > 1e-5) {
      this._camKey = [cp.x, cp.y, cp.z, cq.x, cq.y, cq.z, cq.w];
      this._needsRender = true;
    }

    if (this._fade) {
      const f = this._fade;
      f.t += dt * 1000;
      const k = Math.min(1, f.t / f.dur);
      f.to.mat.opacity = k;
      f.from.mat.opacity = 1 - k;
      this._needsRender = true;
      if (k >= 1) {
        f.from.mesh.visible = false;
        f.to.mat.opacity = 1;
        this._fade = null;
        f.resolve && f.resolve();
      }
    }

    if (this.onFrame) this.onFrame(dt, this._frame);

    if (this._needsRender || this.controls.autoRotate || this._fade || this._anim) {
      this.renderer.render(this.scene, this.camera);
      this._needsRender = false;
    }
  }

  markDirty() { this._needsRender = true; }
}