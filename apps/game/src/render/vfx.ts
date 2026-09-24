import * as THREE from "three";
import { AURIC_LANCE, type Aabb, type Vec3 } from "@potlock/shared";
import { PALETTE } from "./palette.js";
import { radialTexture, scorchTexture, starTexture } from "./textures.js";

/**
 * Combat and ambient VFX with hard caps: 500 particles in two point clouds (additive and
 * alpha), 24 scorch decals fading over 8 s, pooled tracers, muzzle stars and hit bites.
 * Everything is pooled and allocated up front, so combat never creates GPU resources.
 */

const ADD_CAP = 320;
const ALPHA_CAP = 180;
const DECAL_CAP = 24;
const DECAL_LIFE = 8000;

type Kind = "spark" | "dust" | "splash" | "steam" | "moth" | "sparkle" | "ember";

interface Particle {
  kind: Kind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  grow: number;
  r: number;
  g: number;
  b: number;
  alpha: number;
  gravity: number;
  drag: number;
  /** moth orbit */
  cx: number;
  cy: number;
  cz: number;
  a: number;
}

const PARTICLE_VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
uniform float uScale;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(aSize * uScale / max(0.1, -mv.z), 1.0, 256.0);
  gl_Position = projectionMatrix * mv;
  vAlpha = aAlpha;
  vColor = aColor;
}`;

const PARTICLE_FRAG = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
uniform float uSoft;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, uSoft, d) * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor * a, a);
}`;

class Cloud {
  readonly points: THREE.Points;
  readonly list: Particle[] = [];
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  readonly material: THREE.ShaderMaterial;

  constructor(
    readonly cap: number,
    additive: boolean,
  ) {
    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 3);
    this.size = new Float32Array(cap);
    this.alpha = new Float32Array(cap);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aColor", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      uniforms: { uScale: { value: 400 }, uSoft: { value: additive ? 0.0 : 0.15 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    // Alpha cloud uses premultiplied colour so dark dust reads over bright floor.
    if (!additive) this.material.premultipliedAlpha = true;
    if (!additive) this.material.blending = THREE.CustomBlending;
    if (!additive) {
      this.material.blendSrc = THREE.OneFactor;
      this.material.blendDst = THREE.OneMinusSrcAlphaFactor;
    }
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 6 : 4;
  }

  spawn(p: Particle): void {
    if (this.list.length >= this.cap) {
      // Recycle the oldest non-ambient particle rather than dropping combat feedback.
      const i = this.list.findIndex((q) => q.kind !== "moth");
      if (i < 0) return;
      this.list.splice(i, 1);
    }
    this.list.push(p);
  }

  update(dt: number, time: number): void {
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i]!;
      p.life += dt;
      if (p.kind !== "moth" && p.life >= p.max) {
        L[i] = L[L.length - 1]!;
        L.pop();
        continue;
      }
      if (p.kind === "moth") {
        p.a += dt * (2.2 + Math.sin(time * 3 + p.cx) * 1.5);
        p.x = p.cx + Math.cos(p.a) * (0.35 + Math.sin(time * 1.7 + p.cz) * 0.15);
        p.z = p.cz + Math.sin(p.a * 1.3) * 0.35;
        p.y = p.cy + Math.sin(p.a * 2.1) * 0.18;
        continue;
      }
      const drag = Math.exp(-p.drag * dt);
      p.vx *= drag;
      p.vy = p.vy * drag - p.gravity * dt;
      p.vz *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.size += p.grow * dt;
    }
    const n = L.length;
    for (let i = 0; i < n; i++) {
      const p = L[i]!;
      const t = p.max > 0 ? p.life / p.max : 0;
      let a = p.alpha;
      if (p.kind === "spark" || p.kind === "ember") a *= 1 - t * t;
      else if (p.kind === "sparkle") a *= Math.sin(Math.min(1, t) * Math.PI);
      else if (p.kind === "moth") a *= 0.6 + 0.4 * Math.sin(time * 20 + p.cx * 10);
      else a *= Math.sin(Math.min(1, t) * Math.PI) * (1 - t * 0.5);
      this.pos[i * 3] = p.x;
      this.pos[i * 3 + 1] = p.y;
      this.pos[i * 3 + 2] = p.z;
      this.col[i * 3] = p.r;
      this.col[i * 3 + 1] = p.g;
      this.col[i * 3 + 2] = p.b;
      this.size[i] = p.size;
      this.alpha[i] = a;
    }
    const g = this.points.geometry;
    g.setDrawRange(0, n);
    for (const name of ["position", "aColor", "aSize", "aAlpha"]) (g.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
  }
}

function particle(kind: Kind, pos: THREE.Vector3 | Vec3, over: Partial<Particle>): Particle {
  return {
    kind,
    x: pos.x,
    y: pos.y,
    z: pos.z,
    vx: 0,
    vy: 0,
    vz: 0,
    life: 0,
    max: 1,
    size: 0.05,
    grow: 0,
    r: 1,
    g: 1,
    b: 1,
    alpha: 1,
    gravity: 0,
    drag: 0,
    cx: 0,
    cy: 0,
    cz: 0,
    a: 0,
    ...over,
  };
}

const C_SPARK = new THREE.Color(0xffc27a);
const C_COMBAT = new THREE.Color(PALETTE.combat);
const C_LANCE = new THREE.Color(PALETTE.lanceCore);
const C_CYAN = new THREE.Color(PALETTE.cyan);

interface Timed<T> {
  obj: T;
  start: number;
  until: number;
}

/** Nearest box face to a point on the map surface; returns the outward normal. */
export function surfaceNormal(p: Vec3, boxes: readonly Aabb[]): THREE.Vector3 | null {
  let best = 0.06;
  let n: THREE.Vector3 | null = null;
  for (const b of boxes) {
    if (p.x < b.min.x - best || p.x > b.max.x + best || p.y < b.min.y - best || p.y > b.max.y + best || p.z < b.min.z - best || p.z > b.max.z + best) continue;
    const faces: [number, THREE.Vector3Tuple][] = [
      [Math.abs(p.x - b.min.x), [-1, 0, 0]],
      [Math.abs(p.x - b.max.x), [1, 0, 0]],
      [Math.abs(p.y - b.min.y), [0, -1, 0]],
      [Math.abs(p.y - b.max.y), [0, 1, 0]],
      [Math.abs(p.z - b.min.z), [0, 0, -1]],
      [Math.abs(p.z - b.max.z), [0, 0, 1]],
    ];
    for (const [d, v] of faces) {
      if (d < best) {
        best = d;
        n = new THREE.Vector3(...v);
      }
    }
  }
  return n;
}

export class Vfx {
  readonly group = new THREE.Group();
  private readonly add = new Cloud(ADD_CAP, true);
  private readonly alpha = new Cloud(ALPHA_CAP, false);
  private readonly decals: Timed<THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>>[] = [];
  private decalNext = 0;
  private readonly tracers: Timed<THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>>[] = [];
  private tracerNext = 0;
  private readonly flashes: Timed<THREE.Sprite>[] = [];
  private flashNext = 0;
  private readonly bites: Timed<THREE.Sprite>[] = [];
  private biteNext = 0;
  private readonly cones = new Map<string, THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>>();
  private readonly coneMat: THREE.ShaderMaterial;
  private readonly coneGeo: THREE.CylinderGeometry;
  private readonly beams: { core: THREE.Mesh; glow: THREE.Mesh; mat: THREE.ShaderMaterial; start: number }[] = [];
  private beamNext = 0;
  private steamAcc = 0;
  private sparkleAcc = 0;
  private lastTime = 0;

  constructor(
    private readonly env: { steamVent: THREE.Vector3; mothLamp: THREE.Vector3; waterZ: number; waterY: number },
    private readonly puddles: { x: number; z: number; r: number }[],
  ) {
    this.group.add(this.add.points, this.alpha.points);
    const scorch = scorchTexture(64);
    const decalGeo = new THREE.PlaneGeometry(0.22, 0.22);
    for (let i = 0; i < DECAL_CAP; i++) {
      const m = new THREE.Mesh(
        decalGeo,
        new THREE.MeshBasicMaterial({ map: scorch, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, opacity: 0 }),
      );
      m.visible = false;
      m.renderOrder = 2;
      this.group.add(m);
      this.decals.push({ obj: m, start: 0, until: 0 });
    }
    const tracerGeo = new THREE.CylinderGeometry(0.008, 0.008, 1, 5, 1, true);
    tracerGeo.translate(0, 0.5, 0);
    tracerGeo.rotateX(Math.PI / 2);
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xbff6ff).multiplyScalar(3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.visible = false;
      this.group.add(m);
      this.tracers.push({ obj: m, start: 0, until: 0 });
    }
    const star = starTexture(128);
    for (let i = 0; i < 8; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: star, color: new THREE.Color(0xffd9a0).multiplyScalar(4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      s.visible = false;
      this.group.add(s);
      this.flashes.push({ obj: s, start: 0, until: 0 });
    }
    const ring = radialTexture(64, "rgba(255,255,255,1)", "rgba(255,255,255,0)");
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: ring, color: new THREE.Color(PALETTE.combat).multiplyScalar(4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      s.visible = false;
      this.group.add(s);
      this.bites.push({ obj: s, start: 0, until: 0 });
    }
    // Lance telegraph: a thick translucent cone along the aim, pulsing as the charge builds.
    this.coneGeo = new THREE.CylinderGeometry(0.9, 0.05, 16, 20, 1, true);
    this.coneGeo.translate(0, 8, 0);
    this.coneGeo.rotateX(Math.PI / 2);
    this.coneMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(PALETTE.lanceCore) } },
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying float vFacing;
        void main() {
          vUv = uv;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vec3 n = normalize(mat3(modelMatrix) * normal);
          vFacing = abs(dot(n, normalize(cameraPosition - w.xyz)));
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uColor; varying vec2 vUv; varying float vFacing;
        void main() {
          float along = vUv.y;
          float bands = 0.6 + 0.4 * sin(along * 60.0 - uTime * 30.0);
          float a = pow(vFacing, 1.5) * (0.12 + 0.2 * along) * bands * smoothstep(0.0, 0.15, 1.0 - along + 0.05);
          gl_FragColor = vec4(uColor * a * 3.0, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    // A hidden cone so the telegraph program is compiled during warm-up.
    const warmCone = new THREE.Mesh(this.coneGeo, this.coneMat);
    warmCone.visible = false;
    this.group.add(warmCone);
    // Lance beam: molten core + wide glow, dissolving into heat noise over ~0.5 s.
    const beamMat = (): THREE.ShaderMaterial =>
      new THREE.ShaderMaterial({
        uniforms: { uT: { value: 1 }, uColor: { value: new THREE.Color(PALETTE.lanceCore) }, uHot: { value: new THREE.Color(PALETTE.lanceRim) } },
        vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vW; void main() { vUv = uv; vW = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uT; uniform vec3 uColor; uniform vec3 uHot; varying vec2 vUv; varying vec3 vW;
          float h(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
          void main() {
            float flash = 1.0 - smoothstep(0.0, 0.16, uT);
            float n = h(floor(vW * 14.0));
            float dissolve = step(uT * 1.15, n);
            float edge = 1.0 - abs(vUv.x * 2.0 - 1.0);
            float a = (dissolve * (1.0 - uT) + flash) * 0.9;
            vec3 c = mix(uColor, uHot, flash) * (2.5 + flash * 6.0);
            gl_FragColor = vec4(c * a, a);
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
    const coreGeo = new THREE.CylinderGeometry(0.035, 0.035, 1, 8, 1, true);
    coreGeo.translate(0, 0.5, 0);
    coreGeo.rotateX(Math.PI / 2);
    const glowGeo = new THREE.CylinderGeometry(0.14, 0.14, 1, 10, 1, true);
    glowGeo.translate(0, 0.5, 0);
    glowGeo.rotateX(Math.PI / 2);
    for (let i = 0; i < 2; i++) {
      const mat = beamMat();
      const core = new THREE.Mesh(coreGeo, mat);
      const glowMat = mat.clone();
      glowMat.uniforms = mat.uniforms;
      const glow = new THREE.Mesh(glowGeo, glowMat);
      core.visible = glow.visible = false;
      core.renderOrder = glow.renderOrder = 7;
      this.group.add(core, glow);
      this.beams.push({ core, glow, mat, start: -1e9 });
    }
    // Moths around one caged bulb: persistent ambient.
    for (let i = 0; i < 7; i++) {
      this.add.spawn(
        particle("moth", env.mothLamp, { cx: env.mothLamp.x, cy: env.mothLamp.y - 0.1, cz: env.mothLamp.z, a: i, size: 0.018, r: 1, g: 0.8, b: 0.55, alpha: 0.9, max: 0 }),
      );
    }
  }

  setViewport(heightPx: number, camera: THREE.PerspectiveCamera): void {
    const scale = (heightPx * 0.5) / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    this.add.material.uniforms.uScale!.value = scale;
    this.alpha.material.uniforms.uScale!.value = scale;
  }

  // ---------- combat ----------

  muzzle(pos: THREE.Vector3, now: number, scale = 0.35): void {
    const f = this.flashes[this.flashNext++ % this.flashes.length]!;
    f.obj.position.copy(pos);
    f.obj.scale.setScalar(scale);
    f.obj.material.rotation = Math.random() * Math.PI;
    f.obj.visible = true;
    f.start = now;
    f.until = now + 35;
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, now: number): void {
    const t = this.tracers[this.tracerNext++ % this.tracers.length]!;
    const len = from.distanceTo(to);
    t.obj.position.copy(from);
    t.obj.lookAt(to);
    t.obj.scale.set(1, 1, len);
    t.obj.visible = true;
    t.obj.material.opacity = 1;
    t.start = now;
    t.until = now + 70;
  }

  impact(at: Vec3, normal: THREE.Vector3 | null, now: number, onPlayer: boolean): void {
    const n = normal ?? new THREE.Vector3(0, 1, 0);
    const color = onPlayer ? C_COMBAT : C_SPARK;
    const count = onPlayer ? 10 : 7;
    for (let i = 0; i < count; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(1.4).add(n).normalize().multiplyScalar(2 + Math.random() * 4);
      this.add.spawn(
        particle("spark", at, { vx: v.x, vy: v.y, vz: v.z, max: 0.18 + Math.random() * 0.25, size: 0.03 + Math.random() * 0.03, r: color.r * 3, g: color.g * 3, b: color.b * 3, gravity: 9, drag: 3 }),
      );
    }
    if (onPlayer) {
      const b = this.bites[this.biteNext++ % this.bites.length]!;
      b.obj.position.set(at.x, at.y, at.z);
      b.obj.scale.setScalar(0.25);
      b.obj.visible = true;
      b.start = now;
      b.until = now + 160;
      return;
    }
    if (!normal) return;
    const d = this.decals[this.decalNext++ % DECAL_CAP]!;
    d.obj.position.set(at.x, at.y, at.z).addScaledVector(n, 0.004);
    d.obj.lookAt(d.obj.position.clone().add(n));
    d.obj.rotateZ(Math.random() * Math.PI * 2);
    d.obj.scale.setScalar(0.8 + Math.random() * 0.5);
    d.obj.visible = true;
    d.start = now;
    d.until = now + DECAL_LIFE;
    // A wisp of dust off the wall.
    this.alpha.spawn(particle("dust", at, { vx: n.x * 0.6, vy: n.y * 0.6 + 0.2, vz: n.z * 0.6, max: 0.7, size: 0.12, grow: 0.5, r: 0.09, g: 0.09, b: 0.1, alpha: 0.3, drag: 2 }));
  }

  /** Elimination burst where the victim stood. */
  elimination(at: Vec3, lance: boolean): void {
    const c = lance ? C_LANCE : C_COMBAT;
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 3 + 1;
      this.add.spawn(
        particle(lance ? "ember" : "spark", { x: at.x, y: at.y + 1.1, z: at.z }, { vx: Math.cos(a) * 2.5, vy: up, vz: Math.sin(a) * 2.5, max: 0.4 + Math.random() * 0.5, size: 0.04, r: c.r * 3, g: c.g * 3, b: c.b * 3, gravity: 6, drag: 1.5 }),
      );
    }
  }

  lanceBeam(from: THREE.Vector3, to: THREE.Vector3, now: number): void {
    const b = this.beams[this.beamNext++ % this.beams.length]!;
    const len = Math.max(0.1, from.distanceTo(to));
    for (const m of [b.core, b.glow]) {
      m.position.copy(from);
      m.lookAt(to);
      m.scale.set(1, 1, len);
      m.visible = true;
    }
    b.start = now;
    for (let i = 0; i < 18; i++) {
      const t = Math.random();
      const p = from.clone().lerp(to, t);
      this.add.spawn(
        particle("ember", p, { vx: (Math.random() - 0.5) * 0.8, vy: Math.random() * 0.8, vz: (Math.random() - 0.5) * 0.8, max: 0.5 + Math.random() * 0.4, size: 0.035, r: C_LANCE.r * 3, g: C_LANCE.g * 3, b: C_LANCE.b * 3, gravity: -0.3, drag: 1 }),
      );
    }
  }

  /** Charging telegraph cone for one holder; pass null to hide. */
  telegraph(id: string, from: Vec3 | null, dir: Vec3 | null): void {
    let cone = this.cones.get(id);
    if (!from || !dir) {
      if (cone) cone.visible = false;
      return;
    }
    if (!cone) {
      cone = new THREE.Mesh(this.coneGeo, this.coneMat);
      cone.renderOrder = 7;
      this.cones.set(id, cone);
      this.group.add(cone);
    }
    cone.visible = true;
    cone.position.set(from.x, from.y - 0.25, from.z);
    cone.lookAt(from.x + dir.x * AURIC_LANCE.range, from.y - 0.25 + dir.y * AURIC_LANCE.range, from.z + dir.z * AURIC_LANCE.range);
  }

  // ---------- movement ----------

  footstep(at: Vec3): void {
    const wet = this.puddles.some((p) => Math.hypot(at.x - p.x, at.z - p.z) < p.r * 0.8);
    if (wet) {
      for (let i = 0; i < 5; i++) {
        this.alpha.spawn(
          particle("splash", { x: at.x, y: at.y + 0.03, z: at.z }, { vx: (Math.random() - 0.5) * 1.2, vy: 1.2 + Math.random(), vz: (Math.random() - 0.5) * 1.2, max: 0.35, size: 0.035, r: 0.05, g: 0.07, b: 0.09, alpha: 0.85, gravity: 9 }),
        );
      }
    } else {
      this.alpha.spawn(particle("dust", { x: at.x, y: at.y + 0.05, z: at.z }, { vy: 0.15, max: 0.6, size: 0.14, grow: 0.35, r: 0.1, g: 0.1, b: 0.11, alpha: 0.28, drag: 2 }));
    }
  }

  // ---------- per frame ----------

  update(now: number, camera: THREE.Camera): void {
    const time = now / 1000;
    const dt = this.lastTime === 0 ? 0.016 : Math.min(0.1, time - this.lastTime);
    this.lastTime = time;
    // Ambient: steam from the vent, sparkles on the water near the dock.
    this.steamAcc += dt;
    while (this.steamAcc > 0.12) {
      this.steamAcc -= 0.12;
      const v = this.env.steamVent;
      this.alpha.spawn(
        particle("steam", { x: v.x + (Math.random() - 0.5) * 0.8, y: v.y, z: v.z + (Math.random() - 0.5) * 0.4 }, { vx: (Math.random() - 0.5) * 0.2, vy: 0.55 + Math.random() * 0.3, vz: -0.08, max: 3.2 + Math.random(), size: 0.35, grow: 0.7, r: 0.16, g: 0.17, b: 0.18, alpha: 0.18, drag: 0.3 }),
      );
    }
    this.sparkleAcc += dt;
    while (this.sparkleAcc > 0.06) {
      this.sparkleAcc -= 0.06;
      const cx = camera.position.x + (Math.random() - 0.5) * 50;
      const z = this.env.waterZ - 0.8 - Math.random() * 30;
      this.add.spawn(particle("sparkle", { x: cx, y: this.env.waterY + 0.02, z }, { max: 0.25 + Math.random() * 0.3, size: 0.05 + Math.random() * 0.06, r: C_CYAN.r * 1.6 + 0.4, g: C_CYAN.g * 1.6 + 0.4, b: C_CYAN.b * 1.6 + 0.4, alpha: 0.7 }));
    }
    this.add.update(dt, time);
    this.alpha.update(dt, time);
    this.coneMat.uniforms.uTime!.value = time;

    for (const d of this.decals) {
      if (!d.obj.visible) continue;
      const t = (now - d.start) / (d.until - d.start);
      if (t >= 1) d.obj.visible = false;
      else d.obj.material.opacity = t < 0.02 ? 1 : 0.9 * (1 - t) ** 0.7;
    }
    for (const list of [this.tracers, this.flashes, this.bites] as Timed<THREE.Mesh | THREE.Sprite>[][]) {
      for (const f of list) {
        if (!f.obj.visible) continue;
        if (now >= f.until) f.obj.visible = false;
        else if (f.obj instanceof THREE.Sprite && list === this.bites) {
          const k = (now - f.start) / (f.until - f.start);
          f.obj.scale.setScalar(0.25 + k * 0.35);
          f.obj.material.opacity = 1 - k;
        }
      }
    }
    for (const b of this.beams) {
      const t = (now - b.start) / 550;
      const on = t >= 0 && t < 1;
      b.core.visible = b.glow.visible = on;
      if (on) b.mat.uniforms.uT!.value = t;
    }
  }

  /** Current live particle count (budget check). */
  particleCount(): number {
    return this.add.list.length + this.alpha.list.length;
  }
}
