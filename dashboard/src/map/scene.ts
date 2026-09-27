/**
 * three.js operations scene: offline terrain, hex risk grid, PACE routes, units with CEP discs,
 * threats and resources. Data is pushed in with update(); camera is orbit/pan/zoom with easing.
 */
import * as THREE from 'three';
import type { PaceKey, RiskLevel } from '../api/types';
import { RISK_HEX } from '../lib/format';
import { HEX_SIZE_UNITS, terrainHeight as h, type XZ } from './projection';

export interface SceneUnit { id: string; kind: 'car' | 'drone' | 'team'; xz: XZ; cep_m: number; color: number; label: string }
export interface SceneData {
  units: SceneUnit[];
  cells: Array<{ id: string; xz: XZ; level: RiskLevel; score: number }>;
  routes: Array<{ k: PaceKey; path: XZ[] }>;
  activeRoute: PaceKey | null;
  routeMode: 'all' | 'dim' | 'hidden';
  checkpoints: XZ[];
  resources: Array<{ id: string; xz: XZ; label: string; color: number }>;
  threats: Array<{ id: string; xz: XZ; label: string }>;
  hostile: XZ | null;
  sel: string | null;
  layers: { risk: boolean; routes: boolean; units: boolean; terrain: boolean };
  riskOpacity: number;
}

interface Cam { th: number; ph: number; d: number; tg: THREE.Vector3 }
interface UnitObj { mesh: THREE.Mesh; cep: THREE.Mesh; target: THREE.Vector3; kind: SceneUnit['kind'] }

const DRONE_AGL = 22;

export class OpsScene {
  private R: THREE.WebGLRenderer;
  private sc = new THREE.Scene();
  private cam: THREE.PerspectiveCamera;
  private wire: THREE.Mesh;
  private riskGroup = new THREE.Group();
  private cells = new Map<string, { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial }>();
  private routes = new Map<PaceKey, { key: string; mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; curve: THREE.CatmullRomCurve3 }>();
  private cps = new THREE.Group();
  private cpKey = '';
  private units = new Map<string, UnitObj>();
  private statics = new Map<string, THREE.Mesh>();
  private threats = new Map<string, THREE.Mesh>();
  private hostile: THREE.Mesh;
  private selRing: THREE.Mesh;
  private labels = new Map<string, { div: HTMLDivElement; obj: () => THREE.Object3D | undefined }>();
  private labelLayer: HTMLDivElement;
  private cs: Cam = { th: 0.6, ph: 0.95, d: 230, tg: new THREE.Vector3() };
  private ct: Cam = { th: 0.6, ph: 0.95, d: 230, tg: new THREE.Vector3() };
  private view3d = true;
  private data: SceneData | null = null;
  private raf = 0;
  private last = 0;
  private ro: ResizeObserver;
  private cleanup: Array<() => void> = [];

  constructor(private el: HTMLElement, private onPick: (id: string) => void) {
    THREE.ColorManagement.enabled = false;
    const R = new THREE.WebGLRenderer({ antialias: true });
    R.outputColorSpace = THREE.LinearSRGBColorSpace;
    (R as unknown as { useLegacyLights: boolean }).useLegacyLights = true;
    R.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    R.setSize(this.W(), this.H(), false);
    Object.assign(R.domElement.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block', cursor: 'grab', touchAction: 'none' });
    el.appendChild(R.domElement);
    this.R = R;
    this.labelLayer = document.createElement('div');
    this.labelLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
    el.appendChild(this.labelLayer);

    const sc = this.sc;
    sc.background = new THREE.Color(0x141622);
    sc.fog = new THREE.Fog(0x141622, 260, 560);
    this.cam = new THREE.PerspectiveCamera(42, this.W() / this.H(), 0.5, 1500);
    sc.add(new THREE.HemisphereLight(0xc9c2ff, 0x0b0c12, 0.65));
    const dl = new THREE.DirectionalLight(0xffffff, 0.85);
    dl.position.set(-80, 140, 60);
    sc.add(dl);

    const g = new THREE.PlaneGeometry(280, 280, 140, 140);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position, col: number[] = [], c1 = new THREE.Color(0x191b29), c2 = new THREE.Color(0x464d72), cc = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const y = h(p.getX(i), p.getZ(i));
      p.setY(i, y);
      cc.copy(c1).lerp(c2, Math.min(1, Math.max(0, (y + 6) / 26)));
      col.push(cc.r, cc.g, cc.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    sc.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 })));
    this.wire = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x9184d9, wireframe: true, transparent: true, opacity: 0.05 }));
    sc.add(this.wire, this.riskGroup, this.cps);

    this.hostile = this.glow(new THREE.ConeGeometry(1.8, 4, 8), 0xef7066);
    this.hostile.visible = false;
    this.selRing = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.3, 8, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
    this.selRing.rotation.x = Math.PI / 2;
    sc.add(this.hostile, this.selRing);

    this.bindControls();
    this.ro = new ResizeObserver(() => { R.setSize(this.W(), this.H(), false); this.cam.aspect = this.W() / this.H(); this.cam.updateProjectionMatrix(); });
    this.ro.observe(el);
    this.loop();
  }

  update(d: SceneData): void {
    this.data = d;
    this.syncCells(d);
    this.syncRoutes(d);
    this.syncUnits(d);
    this.syncStatics(d);
    this.wire.visible = d.layers.terrain;
  }

  setView3d(on: boolean): void { this.view3d = on; this.ct.ph = on ? 0.95 : 0.02; if (!on) this.ct.th = 0; }
  zoom(f: number): void { this.ct.d = Math.max(40, Math.min(420, this.ct.d * f)); }
  resetView(): void { Object.assign(this.ct, { th: this.view3d ? 0.6 : 0, ph: this.view3d ? 0.95 : 0.02, d: 230 }); this.ct.tg.set(0, 0, 0); }
  frame(xz: XZ, d: number): void { this.ct.tg.set(xz[0], 0, xz[1]); this.ct.d = d; }
  flyTo(id: string): void { const u = this.units.get(id); if (u) this.frame([u.target.x, u.target.z], 95); }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    for (const c of this.cleanup) c();
    this.sc.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose(); const mat = m.material; if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose(); });
    this.R.dispose();
    this.R.domElement.remove();
    this.labelLayer.remove();
  }

  private W() { return this.el.clientWidth || 600; }
  private H() { return this.el.clientHeight || 400; }

  private glow(geo: THREE.BufferGeometry, color: number): THREE.Mesh {
    return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4, roughness: 0.5 }));
  }

  private label(key: string, text: string, obj: () => THREE.Object3D | undefined, color = '#e8e6f5'): void {
    let l = this.labels.get(key);
    if (!l) {
      const div = document.createElement('div');
      div.style.cssText = 'position:absolute;left:0;top:0;font:500 11px Vazirmatn,Inter,sans-serif;background:rgba(22,24,38,0.82);padding:2px 7px;border-radius:5px;white-space:nowrap;will-change:transform';
      this.labelLayer.appendChild(div);
      l = { div, obj };
      this.labels.set(key, l);
    }
    if (l.div.textContent !== text) l.div.textContent = text;
    l.div.style.color = color;
    l.obj = obj;
  }

  private dropLabel(key: string): void { this.labels.get(key)?.div.remove(); this.labels.delete(key); }

  private syncCells(d: SceneData): void {
    for (const c of d.cells) {
      let e = this.cells.get(c.id);
      if (!e) {
        const mat = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.55, roughness: 0.8, emissiveIntensity: 0.25 });
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(HEX_SIZE_UNITS * 0.92, HEX_SIZE_UNITS * 0.92, 1, 6), mat);
        this.riskGroup.add(mesh);
        e = { mesh, mat };
        this.cells.set(c.id, e);
      }
      const ht = 0.6 + c.score * 18;
      e.mat.color.setHex(RISK_HEX[c.level]);
      e.mat.emissive.setHex(RISK_HEX[c.level]);
      e.mat.opacity = d.riskOpacity;
      e.mesh.scale.y = ht;
      e.mesh.position.set(c.xz[0], h(c.xz[0], c.xz[1]) + ht / 2, c.xz[1]);
    }
    this.riskGroup.visible = d.layers.risk;
  }

  private syncRoutes(d: SceneData): void {
    for (const r of d.routes) {
      const key = JSON.stringify(r.path);
      let e = this.routes.get(r.k);
      if (!e || e.key !== key) {
        if (e) { this.sc.remove(e.mesh); e.mesh.geometry.dispose(); }
        const base = new THREE.CatmullRomCurve3(r.path.map(([x, z]) => new THREE.Vector3(x, 0, z)));
        const curve = new THREE.CatmullRomCurve3(base.getSpacedPoints(260).map((v) => new THREE.Vector3(v.x, h(v.x, v.z) + 1.1, v.z)));
        const mat = e?.mat ?? new THREE.MeshBasicMaterial({ color: 0x9184d9, transparent: true, opacity: 0.9 });
        const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 360, 0.55, 6, false), mat);
        this.sc.add(mesh);
        e = { key, mesh, mat, curve };
        this.routes.set(r.k, e);
      }
      const act = r.k === d.activeRoute;
      e.mesh.visible = d.layers.routes && (act || d.routeMode !== 'hidden');
      e.mat.color.setHex(act ? 0xb5abfc : 0x5a5f82);
      e.mat.opacity = act ? 0.95 : d.routeMode === 'all' ? 0.55 : 0.22;
    }
    const cpKey = JSON.stringify(d.checkpoints);
    if (cpKey !== this.cpKey) {
      this.cpKey = cpKey;
      while (this.cps.children.length) this.cps.remove(this.cps.children[0]);
      for (const [x, z] of d.checkpoints) {
        const m = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.35, 8, 24), new THREE.MeshBasicMaterial({ color: 0xe8e6f5 }));
        m.rotation.x = Math.PI / 2;
        m.position.set(x, h(x, z) + 1.5, z);
        this.cps.add(m);
      }
    }
    this.cps.visible = d.layers.routes && d.routeMode !== 'hidden';
  }

  private syncUnits(d: SceneData): void {
    const seen = new Set<string>();
    for (const u of d.units) {
      seen.add(u.id);
      let o = this.units.get(u.id);
      if (!o) {
        const geo = u.kind === 'car' ? new THREE.BoxGeometry(3, 1.8, 4.5) : u.kind === 'drone' ? new THREE.OctahedronGeometry(1.9) : new THREE.SphereGeometry(1.9, 16, 12);
        const mesh = this.glow(geo, u.color);
        mesh.userData.id = u.id;
        const cep = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ color: u.color, transparent: true, opacity: 0.16, depthWrite: false }));
        cep.rotation.x = -Math.PI / 2;
        const target = new THREE.Vector3(u.xz[0], 0, u.xz[1]);
        mesh.position.copy(target);
        this.sc.add(mesh, cep);
        o = { mesh, cep, target, kind: u.kind };
        this.units.set(u.id, o);
      }
      (o.mesh.material as THREE.MeshStandardMaterial).color.setHex(u.color);
      (o.mesh.material as THREE.MeshStandardMaterial).emissive.setHex(u.color);
      (o.cep.material as THREE.MeshBasicMaterial).color.setHex(u.color);
      o.target.set(u.xz[0], 0, u.xz[1]);
      o.cep.scale.setScalar(Math.max(1, u.cep_m * 0.9));
      o.mesh.visible = o.cep.visible = d.layers.units;
      const mesh = o.mesh;
      this.label(`u:${u.id}`, u.label, () => mesh);
    }
    for (const [id, o] of this.units) if (!seen.has(id)) { this.sc.remove(o.mesh, o.cep); this.units.delete(id); this.dropLabel(`u:${id}`); }
  }

  private syncStatics(d: SceneData): void {
    for (const r of d.resources) {
      let m = this.statics.get(r.id);
      if (!m) { m = this.glow(new THREE.BoxGeometry(3.5, 3.5, 3.5), r.color); this.sc.add(m); this.statics.set(r.id, m); }
      m.position.set(r.xz[0], h(r.xz[0], r.xz[1]) + 1.8, r.xz[1]);
      const mesh = m;
      this.label(`r:${r.id}`, r.label, () => mesh);
    }
    const seen = new Set<string>();
    for (const t of d.threats) {
      seen.add(t.id);
      let m = this.threats.get(t.id);
      if (!m) {
        m = new THREE.Mesh(new THREE.TorusGeometry(4, 0.45, 8, 32), new THREE.MeshBasicMaterial({ color: 0xef7066 }));
        m.rotation.x = Math.PI / 2;
        this.sc.add(m);
        this.threats.set(t.id, m);
      }
      m.position.set(t.xz[0], h(t.xz[0], t.xz[1]) + 1, t.xz[1]);
      m.visible = d.layers.risk;
      const mesh = m;
      this.label(`t:${t.id}`, t.label, () => (mesh.visible ? mesh : undefined), '#f5a39a');
    }
    for (const [id, m] of this.threats) if (!seen.has(id)) { this.sc.remove(m); m.geometry.dispose(); this.threats.delete(id); this.dropLabel(`t:${id}`); }
    this.hostile.visible = !!d.hostile;
  }

  private bindControls(): void {
    const cv = this.R.domElement;
    let drag: { x: number; y: number; sx: number; sy: number; pan: boolean } | null = null;
    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      cv.addEventListener(type, fn as EventListener, opts);
      this.cleanup.push(() => cv.removeEventListener(type, fn as EventListener));
    };
    on('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, pan: e.button === 2 || e.shiftKey }; cv.setPointerCapture(e.pointerId); cv.style.cursor = 'grabbing'; });
    on('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.pan) {
        const k = this.ct.d * 0.0022, th = this.ct.th;
        this.ct.tg.x -= (Math.cos(th) * dx - Math.sin(th) * dy) * k;
        this.ct.tg.z -= (-Math.sin(th) * dx - Math.cos(th) * dy) * k;
      } else {
        this.ct.th -= dx * 0.006;
        if (this.view3d) this.ct.ph = Math.max(0.12, Math.min(1.35, this.ct.ph - dy * 0.005));
      }
    });
    on('pointerup', (e) => {
      cv.style.cursor = 'grab';
      if (drag && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 5) {
        const rc = cv.getBoundingClientRect();
        const m = new THREE.Vector2(((e.clientX - rc.left) / rc.width) * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1);
        const ray = new THREE.Raycaster();
        ray.setFromCamera(m, this.cam);
        const hit = ray.intersectObjects([...this.units.values()].map((u) => u.mesh))[0];
        if (hit) this.onPick(hit.object.userData.id as string);
      }
      drag = null;
    });
    on('contextmenu', (e) => e.preventDefault());
    on('wheel', (e) => { e.preventDefault(); this.zoom(1 + Math.sign(e.deltaY) * 0.1); }, { passive: false });
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - (this.last || now)) / 1000);
    this.last = now;
    const { cs, ct } = this;
    const f = 1 - Math.pow(0.001, dt);
    cs.th += (ct.th - cs.th) * f; cs.ph += (ct.ph - cs.ph) * f; cs.d += (ct.d - cs.d) * f; cs.tg.lerp(ct.tg, f);
    this.cam.position.set(cs.tg.x + cs.d * Math.sin(cs.ph) * Math.sin(cs.th), cs.tg.y + cs.d * Math.cos(cs.ph), cs.tg.z + cs.d * Math.sin(cs.ph) * Math.cos(cs.th));
    this.cam.lookAt(cs.tg);

    const k = 1 - Math.pow(0.02, dt);
    for (const o of this.units.values()) {
      const cur = o.mesh.position, x = cur.x + (o.target.x - cur.x) * k, z = cur.z + (o.target.z - cur.z) * k;
      const y = h(x, z) + (o.kind === 'drone' ? DRONE_AGL : o.kind === 'car' ? 0.9 : 1.9);
      if (o.kind === 'car' && Math.hypot(o.target.x - cur.x, o.target.z - cur.z) > 0.05) o.mesh.lookAt(o.target.x, y, o.target.z);
      if (o.kind === 'drone') o.mesh.rotation.y += dt * 1.5;
      cur.set(x, y, z);
      o.cep.position.set(x, h(x, z) + 0.6, z);
    }
    for (const m of this.threats.values()) { const p = 1 + 0.25 * Math.sin(now * 0.005); m.scale.set(p, p, p); }
    const d = this.data;
    if (d?.hostile) this.hostile.position.set(d.hostile[0], h(d.hostile[0], d.hostile[1]) + 2, d.hostile[1]);
    const su = d?.sel ? this.units.get(d.sel) : undefined;
    this.selRing.visible = !!su && !!d?.layers.units;
    if (su) { const p = su.mesh.position; this.selRing.position.set(p.x, h(p.x, p.z) + 0.7, p.z); this.selRing.scale.setScalar(1 + 0.08 * Math.sin(now * 0.006)); }

    this.R.render(this.sc, this.cam);
    const W = this.W(), H = this.H(), v = new THREE.Vector3();
    for (const { div, obj } of this.labels.values()) {
      const o = obj();
      if (!o || !o.visible) { div.style.display = 'none'; continue; }
      v.copy(o.position); v.y += 4.5; v.project(this.cam);
      if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) { div.style.display = 'none'; continue; }
      div.style.display = 'block';
      div.style.transform = `translate(${(v.x * 0.5 + 0.5) * W}px,${(-v.y * 0.5 + 0.5) * H}px) translate(-50%,-100%)`;
    }
  };
}
