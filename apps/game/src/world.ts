import * as THREE from "three";
import { DRYDOCK_09, rayAabb, type LanceView, type PlayerView, type Vec3, type WeaponId } from "@potlock/shared";
import { Avatar } from "./render/avatar.js";
import { StaticBatch } from "./render/batch.js";
import { buildLevel, type Level } from "./render/level.js";
import { buildLightRig, setShadowMapSize, type LightRig } from "./render/lights.js";
import { buildMaterials, type MaterialLibrary } from "./render/materials.js";
import { PALETTE } from "./render/palette.js";
import { PostStack } from "./render/post.js";
import { FrameGovernor, initialQuality, saveQuality, settingsFor, type QualityLevel, type QualitySettings } from "./render/quality.js";
import { bakeEnvironment, createSkyDome } from "./render/sky.js";
import { radialTexture } from "./render/textures.js";
import { surfaceNormal, Vfx } from "./render/vfx.js";
import { ViewModel } from "./render/viewmodel.js";
import { addLance, buildPedestal, type PedestalModel } from "./render/weapons.js";

/** Local-player state the renderer needs for weapon feel (never used for game logic). */
export interface LocalView {
  reloading: boolean;
  charging: boolean;
  grounded: boolean;
  vy: number;
}

const WATER_Z = -17.35;
const WATER_Y = -1.7;

interface Stride {
  x: number;
  z: number;
  acc: number;
}

/**
 * Three.js presentation for Drydock 09: the dressed quay, lighting, post, avatars,
 * weapons, pedestal and VFX. It reads snapshots and events; it never decides hits,
 * scores or money.
 */
export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(78, 1, 0.05, 450);
  /** Renders only layer 1 (the viewmodel) with its own FOV after a depth clear. */
  readonly viewCamera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
  quality: QualitySettings;
  private post: PostStack;
  private readonly governor: FrameGovernor;
  private readonly lights: LightRig;
  private readonly sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly materials: MaterialLibrary;
  private readonly level: Level;
  private readonly vfx: Vfx;
  private readonly viewModel: ViewModel;
  private readonly pedestal: PedestalModel;
  private readonly pedestalLance = new THREE.Group();
  private readonly flare: THREE.Sprite;
  private readonly avatars = new Map<string, Avatar>();
  private readonly strides = new Map<string, Stride>();
  private readonly localStride: Stride = { x: Number.NaN, z: 0, acc: 0 };
  private readonly lastEye = new THREE.Vector3(Number.NaN, 0, 0);
  private lastRender = performance.now();
  private frameDt = 1 / 60;
  private lastYaw = 0;
  private lastPitch = 0;
  private lastLance: LanceView["state"] | null = null;
  private flashUntil = 0;
  private flashWeapon: WeaponId = "kestrel";
  private punchUntil = 0;
  private punchRoll = 0;
  private dip = 0;
  private dipV = 0;
  private wasGrounded = true;
  private lastVy = 0;
  private strideK = 0;
  private flareCheckAt = 0;
  private flareVisible = true;

  constructor(container: HTMLElement) {
    this.quality = settingsFor(initialQuality());
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance", stencil: false, depth: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Materials render linear HDR into the composer; the grade pass applies ACES filmic.
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
    this.scene.add(this.camera, this.viewCamera);

    const aniso = this.quality.level === "low" ? 2 : 8;
    this.materials = buildMaterials(this.quality.level, 24, 16);
    this.level = buildLevel(this.materials, aniso);
    this.scene.add(this.level.group);

    const ped = DRYDOCK_09.lancePedestal;
    this.pedestal = buildPedestal(this.materials, new THREE.Vector3(ped.x, ped.y, ped.z));
    this.scene.add(this.pedestal.group);
    const lanceB = new StaticBatch<"brass" | "ceramic" | "core">();
    addLance(lanceB, new THREE.Matrix4().makeTranslation(0, 0, 0.45), { brass: "brass", ceramic: "ceramic", core: "core" });
    const lanceMats = { brass: this.materials.brass, ceramic: this.materials.ceramic, core: this.materials.lanceCore };
    for (const m of lanceB.build(lanceMats, () => ({ cast: false, receive: false }))) this.pedestalLance.add(m);
    this.pedestalLance.scale.setScalar(1.25);
    this.scene.add(this.pedestalLance);

    this.vfx = new Vfx({ steamVent: this.level.steamVent, mothLamp: this.level.mothLamp, waterZ: WATER_Z, waterY: WATER_Y }, this.materials.floorLayout.puddles);
    this.scene.add(this.vfx.group);

    this.viewModel = new ViewModel(this.materials);
    this.viewCamera.add(this.viewModel.root);

    // Tiny gated flare on the crane beacon: hidden when the map occludes it.
    this.flare = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: radialTexture(64, "rgba(255,255,255,1)", "rgba(255,255,255,0)"),
        color: new THREE.Color(PALETTE.beacon).multiplyScalar(6),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: false,
        fog: false,
      }),
    );
    this.flare.position.copy(this.level.beacon);
    this.flare.scale.setScalar(0.035);
    this.flare.renderOrder = 8;
    this.scene.add(this.flare);

    this.post = new PostStack(this.renderer, this.scene, this.camera, this.viewCamera, this.quality);
    this.governor = new FrameGovernor(() => {
      if (!new URLSearchParams(window.location.search).has("fixedq")) this.stepDown();
    });
    this.lights.moon.shadow.needsUpdate = true;
    this.resize();
    this.warmUp();
    window.addEventListener("resize", () => this.resize());
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /** Compile every program (avatars, Lance, beams, cones) up front so combat never hitches. */
  private warmUp(): void {
    const warm = new THREE.Group();
    const probe = new Avatar(this.materials, 0, "warm");
    probe.update({ x: 0, y: 0, z: 0, yaw: 0 }, true, true, "lance", false, 0, 0.016);
    warm.add(probe.root);
    this.scene.add(warm);
    const hidden: THREE.Object3D[] = [];
    this.scene.traverse((o) => {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
    });
    this.renderer.compile(this.scene, this.camera);
    this.renderer.compile(this.scene, this.viewCamera);
    for (const o of hidden) o.visible = false;
    this.scene.remove(warm);
    probe.dispose();
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
    this.vfx.setViewport(window.innerHeight * this.renderer.getPixelRatio(), this.camera);
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

  /** Frame stats for the dev overlay and perf checks. */
  stats(): { fps: number; calls: number; triangles: number; quality: QualityLevel; programs: number; particles: number; lights: number } {
    const info = this.renderer.info;
    return {
      fps: Math.round(this.governor.fps * 10) / 10,
      calls: info.render.calls,
      triangles: info.render.triangles,
      quality: this.quality.level,
      programs: info.programs?.length ?? 0,
      particles: this.vfx.particleCount(),
      lights: this.lights.all.length,
    };
  }

  // ---------- players ----------

  /** Ensure one avatar per remote player, remove leavers. */
  syncAvatars(players: PlayerView[], me: string, seatOf: (userId: string) => number, nameOf: (userId: string) => string): void {
    const seen = new Set<string>();
    for (const p of players) {
      if (p.userId === me) continue;
      seen.add(p.userId);
      if (!this.avatars.has(p.userId)) {
        const avatar = new Avatar(this.materials, seatOf(p.userId), nameOf(p.userId));
        this.avatars.set(p.userId, avatar);
        this.scene.add(avatar.root);
      }
    }
    for (const [id, avatar] of this.avatars) {
      if (!seen.has(id)) {
        this.scene.remove(avatar.root);
        avatar.dispose();
        this.avatars.delete(id);
        this.strides.delete(id);
      }
    }
  }

  placeAvatar(userId: string, p: { x: number; y: number; z: number; yaw: number }, alive: boolean, invulnerable: boolean, weapon: WeaponId, charging = false): void {
    const avatar = this.avatars.get(userId);
    if (!avatar) return;
    avatar.update(p, alive, invulnerable, weapon, charging, performance.now(), this.frameDt);
    if (!alive) return;
    let s = this.strides.get(userId);
    if (!s) this.strides.set(userId, (s = { x: p.x, z: p.z, acc: 0 }));
    this.stride(s, p);
  }

  /** Footstep dust (or a puddle splash) every ~1.5 m of ground travel. */
  private stride(s: Stride, p: Vec3): void {
    const d = Number.isNaN(s.x) ? 0 : Math.hypot(p.x - s.x, p.z - s.z);
    s.x = p.x;
    s.z = p.z;
    if (d > 1.5) return; // respawn teleport
    s.acc += d;
    if (s.acc > 1.5 && p.y < 0.05) {
      s.acc = 0;
      this.vfx.footstep(p);
    }
  }

  // ---------- Lance ----------

  setLance(lance: LanceView, time: number): void {
    const at: Vec3 | null = lance.state === "pedestal" || lance.state === "dropped" ? lance.position : null;
    this.pedestalLance.visible = at !== null;
    const onPedestal = lance.state === "pedestal";
    if (onPedestal && this.lastLance !== null && this.lastLance !== "pedestal") this.pedestal.pulse(time);
    this.lastLance = lance.state;
    this.pedestal.setAvailable(onPedestal ? 1 : 0, time);
    this.lights.pedestal.intensity = onPedestal ? 45 + Math.sin(time * 3) * 8 : at ? 25 : 4;
    const ped = DRYDOCK_09.lancePedestal;
    this.lights.pedestal.position.set(at?.x ?? ped.x, (at?.y ?? ped.y) + 1.3, at?.z ?? ped.z);
    if (at) {
      this.pedestalLance.position.set(at.x, at.y + 1.25 + Math.sin(time * 2.2) * 0.07, at.z);
      this.pedestalLance.rotation.set(0.12, time * 0.7, 0);
    }
  }

  /** Charging telegraph cone from a Lance holder along their aim. */
  setTelegraph(userId: string, from: Vec3 | null, dir: Vec3 | null): void {
    this.vfx.telegraph(userId, from, dir);
  }

  // ---------- combat events ----------

  /** A shot event from the server. `local` = fired by this client (the viewmodel already kicked). */
  shot(e: { from: Vec3; to: Vec3; weapon: WeaponId; hitId: string | null; damage: number }, local: boolean, now: number): void {
    const from = new THREE.Vector3(e.from.x, e.from.y, e.from.z);
    const to = new THREE.Vector3(e.to.x, e.to.y, e.to.z);
    const dir = to.clone().sub(from).normalize();
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    const drop = local ? 0.14 : 0.24;
    const muzzle = from.clone().addScaledVector(dir, 0.55).addScaledVector(right, local ? 0.14 : 0.12);
    muzzle.y -= drop;
    if (e.weapon === "lance") {
      if (local) this.viewModel.fire(now, "lance");
      this.vfx.lanceBeam(muzzle, to, now);
      this.flashUntil = now + 80;
      this.flashWeapon = "lance";
      this.lights.flash.position.copy(muzzle).lerp(to, 0.08);
      this.post.kick(now, 1, 320);
    } else {
      if (!local) this.vfx.muzzle(muzzle, now);
      this.vfx.tracer(muzzle, to, now);
    }
    if (e.hitId) {
      this.vfx.impact(e.to, null, now, true);
      if (e.damage > 0) this.avatars.get(e.hitId)?.hit(now);
    } else {
      this.vfx.impact(e.to, surfaceNormal(e.to, DRYDOCK_09.boxes), now, false);
    }
  }

  /** Elimination burst; chromatic fringe only when the local player is involved. */
  elimination(at: Vec3 | null, weapon: WeaponId, involvesMe: boolean, now: number): void {
    if (at) this.vfx.elimination(at, weapon === "lance");
    if (involvesMe) this.post.kick(now, weapon === "lance" ? 1 : 0.6, 380);
  }

  /** 40 ms camera punch when the local player is hit. */
  hurt(now: number): void {
    this.punchUntil = now + 40;
    this.punchRoll = (Math.random() - 0.5) * 0.02;
  }

  localFire(now: number, weapon: WeaponId): void {
    this.viewModel.fire(now, weapon);
    if (weapon === "kestrel") {
      this.flashUntil = now + 45;
      this.flashWeapon = "kestrel";
    }
  }

  // ---------- frame ----------

  render(eye: Vec3, yaw: number, pitch: number, weapon: WeaponId, showViewModel: boolean, now: number, local?: LocalView): void {
    const dt = Math.min(0.1, Math.max(0.001, (now - this.lastRender) / 1000));
    this.frameDt = dt;
    this.lastRender = now;
    const time = now / 1000;

    // Landing dip from fall speed at touchdown; local footsteps.
    if (local) {
      if (local.grounded && !this.wasGrounded && this.lastVy < -3) {
        this.dipV -= Math.min(0.9, -this.lastVy * 0.06);
        this.viewModel.land(-this.lastVy);
      }
      this.wasGrounded = local.grounded;
      this.lastVy = local.vy;
      if (showViewModel && local.grounded) this.stride(this.localStride, { x: eye.x, y: eye.y - 1.6, z: eye.z });
    }
    this.dipV += (-this.dip * 160 - this.dipV * 15) * dt;
    this.dip += this.dipV * dt;

    const punch = now < this.punchUntil ? (this.punchUntil - now) / 40 : 0;
    this.camera.position.set(eye.x, eye.y + this.dip * 0.08, eye.z);
    this.camera.rotation.set(pitch + punch * 0.018, yaw, this.punchRoll * punch, "YXZ");
    this.viewCamera.position.copy(this.camera.position);
    this.viewCamera.quaternion.copy(this.camera.quaternion);
    this.sky.position.copy(this.camera.position);
    this.sky.material.uniforms.uTime!.value = time;
    this.level.update(time);

    // Viewmodel feel from look deltas and ground speed.
    let dYaw = yaw - this.lastYaw;
    while (dYaw > Math.PI) dYaw -= Math.PI * 2;
    while (dYaw < -Math.PI) dYaw += Math.PI * 2;
    const dPitch = pitch - this.lastPitch;
    this.lastYaw = yaw;
    this.lastPitch = pitch;
    const stride = this.strideSpeed(eye, dt);
    this.viewModel.update(now, dt, {
      weapon,
      visible: showViewModel,
      reloading: local?.reloading ?? false,
      charging: local?.charging ?? false,
      stride: local?.grounded ? stride : 0,
      lookDX: (dYaw / dt) * 8,
      lookDY: (dPitch / dt) * 8,
    });

    // Muzzle and Lance flash lights (fixed light count; only intensity changes).
    const flashing = now < this.flashUntil;
    this.lights.muzzle.intensity = flashing && this.flashWeapon === "kestrel" ? 25 : 0;
    if (flashing && this.flashWeapon === "kestrel") this.lights.muzzle.position.copy(this.camera.localToWorld(new THREE.Vector3(0.25, -0.05, -1.4)));
    this.lights.flash.intensity = flashing && this.flashWeapon === "lance" ? 900 : Math.max(0, this.lights.flash.intensity * 0.8 - 1);

    // Beacon flare, gated by a cheap ray test against the map boxes.
    if (now > this.flareCheckAt) {
      this.flareCheckAt = now + 120;
      const o = this.camera.position;
      const d = this.level.beacon.clone().sub(o);
      const dist = d.length();
      d.normalize();
      const dir = { x: d.x, y: d.y, z: d.z };
      const origin = { x: o.x, y: o.y, z: o.z };
      // Walls are rendered lower than their collision height on the water side, so skip them.
      this.flareVisible = !DRYDOCK_09.boxes.some((b) => b.kind !== "wall" && b.kind !== "floor" && rayAabb(origin, dir, b, dist) !== null);
    }
    this.flare.visible = this.flareVisible && (time * 0.8) % 1 < 0.35;

    this.vfx.update(now, this.camera);
    this.post.update(now, punch);
    this.renderer.info.reset();
    this.post.render(dt);
    this.governor.tick(now, showViewModel);
  }

  private strideSpeed(eye: Vec3, dt: number): number {
    const d = Number.isNaN(this.lastEye.x) ? 0 : Math.hypot(eye.x - this.lastEye.x, eye.z - this.lastEye.z);
    this.lastEye.set(eye.x, eye.y, eye.z);
    const v = d > 1 ? 0 : d / dt / 6.5;
    this.strideK += (Math.min(1, v) - this.strideK) * Math.min(1, dt * 8);
    return this.strideK;
  }
}
