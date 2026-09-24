import * as THREE from "three";
import { buildLightRig, setShadowMapSize, type LightRig } from "./render/lights.js";
import { PALETTE } from "./render/palette.js";
import { PostStack } from "./render/post.js";
import { FrameGovernor, initialQuality, saveQuality, settingsFor, type QualityLevel, type QualitySettings } from "./render/quality.js";
import { bakeEnvironment, createSkyDome } from "./render/sky.js";
import {
  AURIC_LANCE,
  DRYDOCK_09,
  MOVEMENT,
  type LanceView,
  type MapBoxKind,
  type PlayerView,
  type Vec3,
  type WeaponId,
} from "@potlock/shared";

/** Late-night quay palette: dark steel, sodium amber, signal cyan. */
const KIND_STYLE: Record<MapBoxKind, { color: number; metal: number; rough: number; emissive?: number }> = {
  floor: { color: 0x22262e, metal: 0.1, rough: 0.9 },
  wall: { color: 0x151922, metal: 0.4, rough: 0.7 },
  container: { color: 0x7a2f28, metal: 0.55, rough: 0.5 },
  crate: { color: 0x5f4a2e, metal: 0.1, rough: 0.8 },
  catwalk: { color: 0x3a4351, metal: 0.8, rough: 0.35 },
  stair: { color: 0x3d4552, metal: 0.7, rough: 0.4 },
  rail: { color: 0xf2b92c, metal: 0.8, rough: 0.3, emissive: 0x3a2a05 },
  tower: { color: 0x202733, metal: 0.6, rough: 0.5 },
  pillar: { color: 0x4d5563, metal: 0.8, rough: 0.35 },
  bollard: { color: 0xf2b92c, metal: 0.6, rough: 0.4, emissive: 0x2a1d02 },
};

const CONTAINER_TINTS = [0x7a2f28, 0x1f5a63, 0x8f6a1c, 0x3b4a6b];

/** Seat colours, readable against the dark map. */
export const SEAT_COLORS = [0x3de0ff, 0xff4d5e, 0x9dff5c, 0xc58bff, 0xff9f3d, 0xf5f5f5];

function gridTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  if (g) {
    g.fillStyle = "#22262e";
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = "#2f3541";
    g.lineWidth = 4;
    g.strokeRect(0, 0, 256, 256);
    g.strokeStyle = "#282d37";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(128, 0);
    g.lineTo(128, 256);
    g.moveTo(0, 128);
    g.lineTo(256, 128);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildLanceModel(): THREE.Group {
  // Original silhouette: a long two-tone spear with a floating ring and crystal tip.
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.05, 1.4, 8),
    new THREE.MeshStandardMaterial({ color: 0x1b2330, metalness: 0.9, roughness: 0.25 }),
  );
  shaft.rotation.z = Math.PI / 2;
  g.add(shaft);
  const tip = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.12, 0),
    new THREE.MeshStandardMaterial({ color: 0xffd36a, emissive: 0xf2b92c, emissiveIntensity: 1.6 }),
  );
  tip.scale.set(2.2, 0.8, 0.8);
  tip.position.x = 0.8;
  g.add(tip);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.16, 0.02, 8, 24),
    new THREE.MeshStandardMaterial({ color: 0x3de0ff, emissive: 0x3de0ff, emissiveIntensity: 1.2 }),
  );
  ring.rotation.y = Math.PI / 2;
  ring.position.x = 0.35;
  g.add(ring);
  return g;
}

class Avatar {
  readonly root = new THREE.Group();
  private readonly body: THREE.Mesh;
  private readonly visor: THREE.Mesh;
  private readonly lance: THREE.Group;
  private readonly bodyMat: THREE.MeshStandardMaterial;

  constructor(color: number, name: string) {
    this.bodyMat = new THREE.MeshStandardMaterial({ color: 0x2b313c, metalness: 0.6, roughness: 0.4, emissive: color, emissiveIntensity: 0.15 });
    this.body = new THREE.Mesh(new THREE.CapsuleGeometry(MOVEMENT.radius, MOVEMENT.height - MOVEMENT.radius * 2, 4, 10), this.bodyMat);
    this.body.position.y = MOVEMENT.height / 2;
    this.root.add(this.body);
    const band = new THREE.Mesh(
      new THREE.TorusGeometry(MOVEMENT.radius + 0.01, 0.04, 6, 20),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1 }),
    );
    band.rotation.x = Math.PI / 2;
    band.position.y = 1.05;
    this.root.add(band);
    this.visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.14, 0.2),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.4 }),
    );
    this.visor.position.set(0, MOVEMENT.eyeHeight - 0.05, -0.3);
    this.root.add(this.visor);
    this.lance = buildLanceModel();
    this.lance.position.set(0.45, 1.1, -0.3);
    this.lance.rotation.y = Math.PI / 2;
    this.lance.visible = false;
    this.root.add(this.lance);
    this.root.add(makeLabel(name, color));
  }

  update(p: { x: number; y: number; z: number; yaw: number }, alive: boolean, invulnerable: boolean, weapon: WeaponId): void {
    this.root.position.set(p.x, p.y, p.z);
    this.root.rotation.y = p.yaw;
    this.root.visible = alive;
    this.bodyMat.opacity = invulnerable ? 0.45 : 1;
    this.bodyMat.transparent = invulnerable;
    this.lance.visible = weapon === "lance";
  }
}

function makeLabel(text: string, color: number): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const g = c.getContext("2d");
  if (g) {
    g.font = "bold 30px 'Chakra Petch', sans-serif";
    g.textAlign = "center";
    g.fillStyle = "rgba(7,8,11,0.6)";
    g.fillRect(0, 12, 256, 40);
    g.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
    g.fillText(text.slice(0, 16), 128, 42);
  }
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: true }));
  sprite.scale.set(1.6, 0.4, 1);
  sprite.position.y = MOVEMENT.height + 0.45;
  return sprite;
}

interface Tracer {
  line: THREE.Line;
  until: number;
}

/** Three.js scene for Drydock 09: level blockout, avatars, lance, tracers and view model. */
export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(78, 1, 0.05, 450);
  /** Renders only layer 1 (the viewmodel) with its own FOV after a depth clear. */
  readonly viewCamera = new THREE.PerspectiveCamera(62, 1, 0.01, 10);
  quality: QualitySettings;
  private post: PostStack;
  private readonly governor: FrameGovernor;
  private readonly lights: LightRig;
  private readonly sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private lastRender = performance.now();
  private readonly avatars = new Map<string, Avatar>();
  private readonly tracers: Tracer[] = [];
  private readonly pedestalLance: THREE.Group;
  private readonly telegraphs = new Map<string, THREE.Line>();
  private readonly viewGun: THREE.Group;
  private readonly viewLance: THREE.Group;
  private muzzleUntil = 0;
  private kick = 0;

  constructor(container: HTMLElement) {
    this.quality = settingsFor(initialQuality());
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance", stencil: false, depth: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Tone mapping is done by the grade pass on the HDR buffer; materials render linear.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene.fog = new THREE.FogExp2(PALETTE.fog, 0.019);
    this.scene.background = new THREE.Color(PALETTE.void);
    this.sky = createSkyDome();
    this.scene.add(this.sky);
    this.scene.environment = bakeEnvironment(this.renderer);
    this.scene.environmentIntensity = 0.9;
    this.lights = buildLightRig(this.scene, this.quality.shadowMapSize);
    this.camera.layers.set(0);
    this.viewCamera.layers.set(1);
    this.scene.add(this.viewCamera);
    this.post = new PostStack(this.renderer, this.scene, this.camera, this.viewCamera, this.quality);
    this.governor = new FrameGovernor(() => {
      if (!new URLSearchParams(window.location.search).has("fixedq")) this.stepDown();
    });
    this.buildLevel();

    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.6, 0.8, 0.35, 16),
      new THREE.MeshStandardMaterial({ color: 0x2b313c, metalness: 0.9, roughness: 0.3, emissive: 0x3de0ff, emissiveIntensity: 0.25 }),
    );
    const ped = DRYDOCK_09.lancePedestal;
    pedestal.position.set(ped.x, ped.y + 0.175, ped.z);
    this.scene.add(pedestal);
    this.pedestalLance = buildLanceModel();
    this.scene.add(this.pedestalLance);
    this.scene.add(this.camera);
    this.viewGun = this.buildViewGun();
    this.viewCamera.add(this.viewGun);
    this.viewLance = buildLanceModel();
    this.viewLance.scale.setScalar(0.6);
    this.viewLance.position.set(0.22, -0.2, -0.55);
    this.viewLance.rotation.y = Math.PI / 2 + 0.08;
    this.viewLance.visible = false;
    this.viewCamera.add(this.viewLance);
    for (const g of [this.viewGun, this.viewLance]) g.traverse((o) => o.layers.set(1));
    this.lights.moon.shadow.needsUpdate = true;

    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  private resize(): void {
    const q = this.quality;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.maxPixelRatio) * q.renderScale);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.post.setSize(window.innerWidth, window.innerHeight);
    for (const c of [this.camera, this.viewCamera]) {
      c.aspect = window.innerWidth / window.innerHeight;
      c.updateProjectionMatrix();
    }
  }

  /** Runtime step-down (high → mid → low); geometry and lights stay, so no material recompiles. */
  private stepDown(): void {
    const next: QualityLevel | null = this.quality.level === "high" ? "mid" : this.quality.level === "mid" ? "low" : null;
    if (next) this.setQuality(next);
  }

  setQuality(level: QualityLevel, persist = false): void {
    this.quality = settingsFor(level);
    if (persist) saveQuality(level);
    this.post.dispose();
    this.post = new PostStack(this.renderer, this.scene, this.camera, this.viewCamera, this.quality);
    setShadowMapSize(this.lights.moon, this.quality.shadowMapSize);
    this.resize();
  }

  /** Draw calls and triangles of the last frame (dev overlay and perf checks). */
  stats(): { fps: number; calls: number; triangles: number; quality: QualityLevel; programs: number } {
    const info = this.renderer.info;
    return { fps: this.governor.fps, calls: info.render.calls, triangles: info.render.triangles, quality: this.quality.level, programs: info.programs?.length ?? 0 };
  }

  private buildLevel(): void {
    const floorTex = gridTexture();
    let containerIndex = 0;
    for (const b of DRYDOCK_09.boxes) {
      const sx = b.max.x - b.min.x;
      const sy = b.max.y - b.min.y;
      const sz = b.max.z - b.min.z;
      const style = KIND_STYLE[b.kind];
      const color = b.kind === "container" ? (CONTAINER_TINTS[containerIndex++ % CONTAINER_TINTS.length] ?? style.color) : style.color;
      const mat = new THREE.MeshStandardMaterial({
        color,
        metalness: style.metal,
        roughness: style.rough,
        emissive: style.emissive ?? 0x000000,
      });
      if (b.kind === "floor") {
        const tex = floorTex.clone();
        tex.repeat.set(sx / 4, sz / 4);
        tex.needsUpdate = true;
        mat.map = tex;
        mat.color.set(0xffffff);
      }
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
      mesh.position.set((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
      this.scene.add(mesh);
      if (b.kind === "catwalk" || b.kind === "tower" || b.kind === "container") {
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(mesh.geometry),
          new THREE.LineBasicMaterial({ color: b.kind === "catwalk" ? 0xf2b92c : 0x0b0d12 }),
        );
        edges.position.copy(mesh.position);
        this.scene.add(edges);
      }
    }
    // Lane markings: the open kill lane down the middle.
    const laneMat = new THREE.MeshBasicMaterial({ color: 0xf2b92c });
    for (const z of [-4, 4]) {
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(46, 0.12), laneMat);
      strip.rotation.x = -Math.PI / 2;
      strip.position.set(0, 0.01, z);
      this.scene.add(strip);
    }
  }

  private buildViewGun(): THREE.Group {
    const g = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x2c333f, metalness: 0.9, roughness: 0.3 });
    const accent = new THREE.MeshStandardMaterial({ color: 0x3de0ff, emissive: 0x3de0ff, emissiveIntensity: 0.8 });
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, 0.36), metal);
    slide.position.set(0, 0, -0.12);
    g.add(slide);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.08), metal);
    grip.position.set(0, -0.1, 0.02);
    grip.rotation.x = 0.25;
    g.add(grip);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.012, 0.3), accent);
    stripe.position.set(0, 0.03, -0.12);
    g.add(stripe);
    g.scale.setScalar(0.55);
    g.position.set(0.17, -0.15, -0.36);
    return g;
  }

  /** Ensure one avatar per remote player, remove leavers. */
  syncAvatars(players: PlayerView[], me: string, seatOf: (userId: string) => number, nameOf: (userId: string) => string): void {
    const seen = new Set<string>();
    for (const p of players) {
      if (p.userId === me) continue;
      seen.add(p.userId);
      if (!this.avatars.has(p.userId)) {
        const avatar = new Avatar(SEAT_COLORS[seatOf(p.userId) % SEAT_COLORS.length] ?? 0xffffff, nameOf(p.userId));
        this.avatars.set(p.userId, avatar);
        this.scene.add(avatar.root);
      }
    }
    for (const [id, avatar] of this.avatars) {
      if (!seen.has(id)) {
        this.scene.remove(avatar.root);
        this.avatars.delete(id);
      }
    }
  }

  placeAvatar(userId: string, p: { x: number; y: number; z: number; yaw: number }, alive: boolean, invulnerable: boolean, weapon: WeaponId): void {
    this.avatars.get(userId)?.update(p, alive, invulnerable, weapon);
  }

  setLance(lance: LanceView, time: number): void {
    const at: Vec3 | null = lance.state === "pedestal" || lance.state === "dropped" ? lance.position : null;
    this.pedestalLance.visible = at !== null;
    this.lights.pedestal.intensity = at ? 30 : 0;
    if (at) {
      this.pedestalLance.position.set(at.x, at.y + 1.1 + Math.sin(time * 2.2) * 0.08, at.z);
      this.pedestalLance.rotation.y = time * 0.9;
      this.lights.pedestal.position.set(at.x, at.y + 1.4, at.z);
    }
  }

  /** Visible 0.35s beam telegraph from a charging lance holder along their aim. */
  setTelegraph(userId: string, from: Vec3 | null, dir: Vec3 | null, time: number): void {
    let line = this.telegraphs.get(userId);
    if (!from || !dir) {
      if (line) line.visible = false;
      return;
    }
    if (!line) {
      line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
        new THREE.LineBasicMaterial({ color: 0xff4d5e, transparent: true }),
      );
      this.telegraphs.set(userId, line);
      this.scene.add(line);
    }
    line.visible = true;
    const end = new THREE.Vector3(from.x + dir.x * AURIC_LANCE.range, from.y + dir.y * AURIC_LANCE.range, from.z + dir.z * AURIC_LANCE.range);
    line.geometry.setFromPoints([new THREE.Vector3(from.x, from.y - 0.3, from.z), end]);
    (line.material as THREE.LineBasicMaterial).opacity = 0.4 + 0.6 * Math.abs(Math.sin(time * 30));
  }

  addTracer(from: Vec3, to: Vec3, weapon: WeaponId, now: number): void {
    const color = weapon === "lance" ? 0xffd36a : 0x9ff3ff;
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(from.x, from.y - 0.12, from.z), new THREE.Vector3(to.x, to.y, to.z)]),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 }),
    );
    this.scene.add(line);
    this.tracers.push({ line, until: now + (weapon === "lance" ? 500 : 90) });
  }

  localFire(now: number, weapon: WeaponId): void {
    if (weapon === "kestrel") {
      this.muzzleUntil = now + 50;
      this.kick = 1;
    }
  }

  render(eye: Vec3, yaw: number, pitch: number, weapon: WeaponId, showViewModel: boolean, now: number): void {
    this.camera.position.set(eye.x, eye.y, eye.z);
    this.camera.rotation.set(pitch, yaw, 0, "YXZ");
    this.viewCamera.position.copy(this.camera.position);
    this.viewCamera.quaternion.copy(this.camera.quaternion);
    this.sky.position.copy(this.camera.position);
    this.sky.material.uniforms.uTime!.value = now / 1000;
    this.viewGun.visible = showViewModel && weapon === "kestrel";
    this.viewLance.visible = showViewModel && weapon === "lance";
    this.kick *= 0.82;
    this.viewGun.position.z = -0.36 + this.kick * 0.04;
    this.viewGun.rotation.x = this.kick * 0.25;
    const muzzleOn = now < this.muzzleUntil;
    this.lights.muzzle.intensity = muzzleOn ? 60 : 0;
    if (muzzleOn) this.lights.muzzle.position.copy(this.camera.localToWorld(new THREE.Vector3(0.25, -0.15, -0.8)));
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      if (!t) continue;
      if (now >= t.until) {
        this.scene.remove(t.line);
        t.line.geometry.dispose();
        this.tracers.splice(i, 1);
      }
    }
    const dt = Math.min(0.1, (now - this.lastRender) / 1000);
    this.lastRender = now;
    this.post.update(now, 0);
    this.renderer.info.reset();
    this.post.render(dt);
    this.governor.tick(now, showViewModel);
  }
}
