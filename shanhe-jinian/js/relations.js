/* ============================================================
   relations.js — 国间关系的大圆弧层
   ============================================================ */
import * as THREE from 'three';
import { lonLatToVec3 } from './maprender.js';

const R = 100;

export const RTYPES = {
  war: { color: 0x8d2f1d, name: '战争', css: 'war' },
  trade: { color: 0xa3762b, name: '贸易', css: 'trade' },
  ally: { color: 0x5b6a32, name: '结盟', css: 'alliance' },
  culture: { color: 0x38566f, name: '文教', css: 'culture' },
  migrate: { color: 0x6d4a76, name: '迁徙', css: 'migrate' },
};

function arcPoints(a, b, lift) {
  const va = new THREE.Vector3(...Object.values(lonLatToVec3(a[0], a[1], 1)));
  const vb = new THREE.Vector3(...Object.values(lonLatToVec3(b[0], b[1], 1)));
  const ang = va.angleTo(vb);
  const n = 54;
  const pts = [];
  const q = new THREE.Quaternion().setFromUnitVectors(va.clone().normalize(), vb.clone().normalize());
  if (ang < 0.001) {
    const p = va.clone().multiplyScalar(R * 1.02);
    for (let i = 0; i <= n; i++) pts.push(p.clone());
    return new THREE.CatmullRomCurve3(pts);
  }
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const d = va.clone().normalize().applyQuaternion(new THREE.Quaternion().slerp(q, t)).normalize();
    const h = Math.sin(Math.PI * t) * lift * (0.62 + 0.38 * Math.min(1, ang / Math.PI * 2));
    d.multiplyScalar(R * 1.004 + h);
    pts.push(d);
  }
  return new THREE.CatmullRomCurve3(pts);
}

export class Relations {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.visible = true;
    scene.add(this.group);
    this.items = [];
    this.time = 0;
    this.visible = true;
  }

  clear() {
    for (const it of this.items) {
      it.obj.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
          else o.material.dispose();
        }
      });
      this.group.remove(it.obj);
    }
    this.items = [];
  }

  show(events, { animate = true } = {}) {
    this.clear();
    this.time = 0;
    events.forEach((ev, i) => {
      const type = RTYPES[ev.t] || RTYPES.war;
      const s = Math.max(1, Math.min(3, ev.s || 2));
      const lift = 0.72 + s * 0.42;
      const curve = arcPoints(ev.p[0], ev.p[1], lift);
      const anchors = [ev.p[0], ev.p[1]].map(p => {
        const v = lonLatToVec3(p[0], p[1], 1);
        return new THREE.Vector3(v.x, v.y, v.z).normalize();
      });
      const obj = new THREE.Group();
      obj.userData.anchors = anchors;
      const mats = [];
      const sparks = [];

      let baseOpacity = 0.62;
      if (ev.t === 'war') {
        const geo = new THREE.TubeGeometry(curve, 72, 0.42 + s * 0.26, 6, false);
        const mat = new THREE.MeshBasicMaterial({ color: type.color, transparent: true, opacity: 0, depthWrite: false });
        obj.add(new THREE.Mesh(geo, mat));
        mats.push(mat);
        // 端点沉降圈
        for (const p of [ev.p[0], ev.p[1]]) {
          const ringGeo = new THREE.RingGeometry(0.55 + s * 0.3, 0.95 + s * 0.38, 18);
          const ringMat = new THREE.MeshBasicMaterial({
            color: type.color, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false,
          });
          const rr = new THREE.Mesh(ringGeo, ringMat);
          const v = lonLatToVec3(p[0], p[1], R * 1.008);
          rr.position.set(v.x, v.y, v.z);
          rr.lookAt(0, 0, 0);
          obj.add(rr);
          mats.push(ringMat);
          sparks.push({ mesh: rr, kind: 'ring', phase: Math.random() });
        }
        baseOpacity = 0.70;
      } else {
        const pts = curve.getPoints(120);
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const dashed = { trade: [2.0, 1.5], ally: [0.6, 1.5], migrate: [3.4, 2.0] }[ev.t];
        const mat = dashed
          ? new THREE.LineDashedMaterial({
            color: type.color, transparent: true, opacity: 0,
            dashSize: dashed[0], gapSize: dashed[1], depthWrite: false,
          })
          : new THREE.LineBasicMaterial({ color: type.color, transparent: true, opacity: 0, depthWrite: false });
        const line = new THREE.Line(geo, mat);
        if (dashed) line.computeLineDistances();
        obj.add(line);
        mats.push(mat);

        // 沿线的行进光点
        const dotGeo = new THREE.SphereGeometry(0.30 + s * 0.09, 8, 6);
        const dotMat = new THREE.MeshBasicMaterial({ color: type.color, transparent: true, opacity: 0, depthWrite: false });
        const nDots = ev.t === 'trade' ? 3 : 2;
        for (let k = 0; k < nDots; k++) {
          const dot = new THREE.Mesh(dotGeo, dotMat);
          obj.add(dot);
          sparks.push({ mesh: dot, kind: 'dot', phase: k / nDots + Math.random() * 0.12 });
        }
        mats.push(dotMat);
        baseOpacity = 0.58;
      }

      obj.userData.baseOpacity = baseOpacity;
      obj.userData.mats = mats;
      if (animate) {
        mats.forEach(m => { m.userData.delay = 90 + i * 70; });
      } else {
        mats.forEach(m => { m.opacity = baseOpacity; m.userData.delay = 0; });
      }
      this.group.add(obj);
      this.items.push({
        ev, obj, mats, sparks, curve, type, s, anchors, t0: performance.now(),
        samples: curve.getPoints(14).map(p => p.clone().normalize()),
      });
    });
    if (!animate) {
      // 立即显示
      for (const it of this.items) it.mats.forEach(m => { m.opacity = it.obj.userData.baseOpacity; });
    }
  }

  update(dt, playing, camDir) {
    this.time += dt;
    const now = performance.now();
    const speed = playing ? 1.9 : 0.55;
    if (camDir) {
      for (const it of this.items) {
        const a = it.anchors[0], b = it.anchors[1];
        const fa = a.x * camDir.x + a.y * camDir.y + a.z * camDir.z;
        const fb = b.x * camDir.x + b.y * camDir.y + b.z * camDir.z;
        let minD = Math.min(fa, fb);
        if (minD > 0.22) {
          for (const sm of it.samples) {
            const d = sm.x * camDir.x + sm.y * camDir.y + sm.z * camDir.z;
            if (d < minD) minD = d;
          }
        }
        it.obj.visible = minD > 0.40;
      }
    }
    for (const it of this.items) {
      const base = it.obj.userData.baseOpacity;
      for (const m of it.mats) {
        const delay = m.userData.delay || 0;
        const k = Math.min(1, Math.max(0, (now - it.t0 - delay) / 420));
        if (k > 0) {
          let o = base * k;
          if (it.type.color === RTYPES.war.color) {
            o *= 0.86 + 0.14 * Math.sin(this.time * 6.2 + it.t0 * 0.001);
          }
          m.opacity = Math.min(1, o * (m.userData.dim ? 0.55 : 1));
        }
      }
      for (const sp of it.sparks) {
        const t = ((this.time * speed * 0.22 + sp.phase) % 1);
        if (sp.kind === 'dot') {
          const p = it.curve.getPointAt(Math.min(0.999, t));
          sp.mesh.position.copy(p);
          const m = sp.mesh.material;
          if (m) m.opacity = Math.min(1, base) * (0.35 + 0.65 * Math.sin(Math.PI * t));
        } else {
          const sc = 1 + 0.55 * ((this.time * 0.9 + sp.phase) % 1);
          sp.mesh.scale.setScalar(sc);
          if (sp.mesh.material) {
            sp.mesh.material.opacity = Math.max(0, 0.55 * (1 - ((this.time * 0.9 + sp.phase) % 1)) * Math.min(1, base));
          }
        }
      }
    }
  }

  setVisible(v) {
    this.visible = v;
    this.group.visible = v;
  }
}