import * as THREE from "three";
import { MOVEMENT, type WeaponId } from "@potlock/shared";
import { StaticBatch } from "./batch.js";
import type { MaterialLibrary } from "./materials.js";
import { hex, PALETTE, SEAT_TRIM } from "./palette.js";
import { radialTexture } from "./textures.js";
import { addKestrel, addLance } from "./weapons.js";

/**
 * Readable humanoid built from bevelled primitives: helmet, jacket, plate rig, pack,
 * with a seat-coloured emissive trim (seats 0-5). About 7 draw calls per player:
 * torso+arms, trim, two legs, sidearm, contact shadow, name plate.
 * Animation is procedural: stride from ground speed, 0.6 s collapse on elimination,
 * cyan fresnel rim during respawn invulnerability, red rim flash when hit.
 */

const GEAR = {
  jacket: 0x2b3038,
  pants: 0x23272d,
  rig: 0x16181b,
  pouch: 0x2e2a24,
  helmet: 0x1d2127,
  glove: 0x121315,
  boot: 0x101113,
  skin: 0x3a302a,
};

type GearKey = "gear";
type TrimKey = "trim";

const trimCache = new Map<number, THREE.MeshStandardMaterial>();
function trimMaterial(seat: number): THREE.MeshStandardMaterial {
  let m = trimCache.get(seat);
  if (!m) {
    const c = SEAT_TRIM[seat % SEAT_TRIM.length] ?? 0xffffff;
    m = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: c, emissiveIntensity: 2.6, roughness: 0.4 });
    trimCache.set(seat, m);
  }
  return m;
}

let blobMat: THREE.MeshBasicMaterial | null = null;
let blobGeo: THREE.PlaneGeometry | null = null;

interface RimUniforms {
  uRim: { value: number };
  uRimColor: { value: THREE.Color };
}

function gearMaterial(lib: MaterialLibrary): { mat: THREE.MeshStandardMaterial; rim: RimUniforms } {
  const rim: RimUniforms = { uRim: { value: 0 }, uRimColor: { value: new THREE.Color(PALETTE.cyan) } };
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.62,
    metalness: 0.15,
    normalMap: lib.micro.normal,
    envMapIntensity: 0.9,
  });
  mat.normalScale.set(0.6, 0.6);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = rim.uRim;
    shader.uniforms.uRimColor = rim.uRimColor;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uRim;\nuniform vec3 uRimColor;")
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        float rimF = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 2.2);
        totalEmissiveRadiance += uRimColor * uRim * rimF * 3.0;`,
      );
  };
  mat.customProgramCacheKey = () => "potlock-gear-rim";
  return { mat, rim };
}

function legGeometry(lib: MaterialLibrary): THREE.BufferGeometry {
  void lib;
  const B = new StaticBatch<GearKey>();
  const m = new THREE.Matrix4();
  const cap = (r: number, len: number, y: number, tint: number, z = 0): void => {
    const g = new THREE.CapsuleGeometry(r, len, 3, 8);
    B.add("gear", g, m.makeTranslation(0, y, z), { uv: "keep", tint });
    g.dispose();
  };
  cap(0.085, 0.3, -0.22, GEAR.pants);
  cap(0.07, 0.3, -0.62, GEAR.pants);
  B.box("gear", 0, -0.46, -0.07, 0.11, 0.12, 0.05, { tint: GEAR.rig, bevel: 0.02, uv: "keep" });
  B.box("gear", 0, -0.86, -0.045, 0.12, 0.11, 0.27, { tint: GEAR.boot, bevel: 0.03, uv: "keep" });
  const [mesh] = B.build({ gear: new THREE.MeshBasicMaterial() }, () => ({ cast: false, receive: false }));
  return mesh ? mesh.geometry : new THREE.BufferGeometry();
}

let sharedLeg: THREE.BufferGeometry | null = null;
const torsoCache = new Map<string, { gear: THREE.BufferGeometry; trim: THREE.BufferGeometry }>();

function torsoGeometry(): { gear: THREE.BufferGeometry; trim: THREE.BufferGeometry } {
  const cached = torsoCache.get("t");
  if (cached) return cached;
  const G = new StaticBatch<GearKey>();
  const T = new StaticBatch<TrimKey>();
  const k = { uv: "keep" as const };
  // Pelvis, jacket, rig plate, pouches, pack.
  G.box("gear", 0, 0.98, 0, 0.34, 0.2, 0.22, { ...k, tint: GEAR.pants, bevel: 0.05 });
  G.box("gear", 0, 1.3, 0.0, 0.44, 0.5, 0.26, { ...k, tint: GEAR.jacket, bevel: 0.08 });
  G.box("gear", 0, 1.33, -0.13, 0.36, 0.3, 0.06, { ...k, tint: GEAR.rig, bevel: 0.02 });
  for (const x of [-0.11, 0, 0.11]) G.box("gear", x, 1.17, -0.17, 0.09, 0.1, 0.05, { ...k, tint: GEAR.pouch, bevel: 0.015 });
  G.box("gear", 0, 1.34, 0.17, 0.28, 0.32, 0.1, { ...k, tint: GEAR.rig, bevel: 0.025 });
  for (const x of [-0.25, 0.25]) G.box("gear", x, 1.5, 0, 0.14, 0.1, 0.22, { ...k, tint: GEAR.rig, bevel: 0.04 });
  // Neck, helmet shell and brim, visor recess.
  G.cyl("gear", 0, 1.58, 0, 0.06, 0.07, 0.08, { tint: GEAR.skin, seg: 10 });
  const helmet = new THREE.SphereGeometry(0.135, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62);
  G.add("gear", helmet, new THREE.Matrix4().makeScale(1, 0.95, 1.1).setPosition(0, 1.66, 0.01), { uv: "keep", tint: GEAR.helmet });
  helmet.dispose();
  G.box("gear", 0, 1.64, -0.1, 0.22, 0.09, 0.07, { ...k, tint: 0x0b0c0e, bevel: 0.03 });
  // Arms in a two-handed sidearm hold.
  const arm = (sh: THREE.Vector3Tuple, el: THREE.Vector3Tuple, ha: THREE.Vector3Tuple): void => {
    G.pipe("gear", sh, el, 0.058, { tint: GEAR.jacket, seg: 8 });
    G.pipe("gear", el, ha, 0.048, { tint: GEAR.jacket, seg: 8 });
    G.box("gear", ha[0], ha[1], ha[2], 0.08, 0.08, 0.09, { ...k, tint: GEAR.glove, bevel: 0.03 });
  };
  arm([0.25, 1.48, 0], [0.2, 1.26, -0.2], [0.07, 1.34, -0.42]);
  arm([-0.25, 1.48, 0], [-0.19, 1.24, -0.2], [0.0, 1.32, -0.4]);
  // Seat trim: visor slit, shoulder bars, chest bar, pack light, arm bands.
  T.box("trim", 0, 1.645, -0.137, 0.18, 0.022, 0.01, k);
  for (const x of [-0.25, 0.25]) T.box("trim", x, 1.555, 0, 0.142, 0.012, 0.2, k);
  T.box("trim", 0, 1.48, -0.162, 0.3, 0.018, 0.012, k);
  T.box("trim", 0, 1.34, 0.223, 0.03, 0.2, 0.01, k);
  for (const x of [-0.235, 0.235]) T.box("trim", x, 1.38, -0.06, 0.12, 0.02, 0.12, k);
  const [g] = G.build({ gear: new THREE.MeshBasicMaterial() }, () => ({ cast: false, receive: false }));
  const [t] = T.build({ trim: new THREE.MeshBasicMaterial() }, () => ({ cast: false, receive: false }));
  const out = { gear: g?.geometry ?? new THREE.BufferGeometry(), trim: t?.geometry ?? new THREE.BufferGeometry() };
  torsoCache.set("t", out);
  return out;
}

let gunGeo: THREE.BufferGeometry | null = null;
function gunGeometry(): THREE.BufferGeometry {
  if (gunGeo) return gunGeo;
  const B = new StaticBatch<GearKey>();
  const base = new THREE.Matrix4().compose(new THREE.Vector3(0.05, 1.37, -0.45), new THREE.Quaternion(), new THREE.Vector3(1.3, 1.3, 1.3));
  addKestrel(B, base, { slide: "gear", frame: "gear", steel: "gear", led: "gear" });
  const [m] = B.build({ gear: new THREE.MeshBasicMaterial() }, () => ({ cast: false, receive: false }));
  gunGeo = m?.geometry ?? new THREE.BufferGeometry();
  // Tint the merged gun dark nitride.
  const col = gunGeo.getAttribute("color") as THREE.BufferAttribute | undefined;
  if (col) {
    const c = new THREE.Color(PALETTE.nitride);
    for (let i = 0; i < col.count; i++) col.setXYZ(i, c.r, c.g, c.b);
  }
  return gunGeo;
}

function lanceGroup(lib: MaterialLibrary): THREE.Group {
  const B = new StaticBatch<"brass" | "ceramic" | "core">();
  const base = new THREE.Matrix4().makeTranslation(0.05, 1.33, -0.2);
  addLance(B, base, { brass: "brass", ceramic: "ceramic", core: "core" });
  const g = new THREE.Group();
  for (const m of B.build({ brass: lib.brass, ceramic: lib.ceramic, core: lib.lanceCore }, () => ({ cast: false, receive: false }))) g.add(m);
  return g;
}

function nameplate(text: string, color: number): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const g = c.getContext("2d");
  if (g) {
    g.font = "600 26px 'Chakra Petch', 'Arial Narrow', sans-serif";
    g.textAlign = "center";
    const w = Math.min(240, g.measureText(text.slice(0, 16)).width + 28);
    g.fillStyle = "rgba(7,8,12,0.72)";
    g.fillRect(128 - w / 2, 14, w, 34);
    g.fillStyle = hex(color);
    g.fillRect(128 - w / 2, 46, w, 3);
    g.fillStyle = "#e9e4d8";
    g.fillText(text.slice(0, 16).toUpperCase(), 128, 40);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true, fog: false }));
  sprite.scale.set(1.3, 0.325, 1);
  sprite.position.y = MOVEMENT.height + 0.35;
  sprite.renderOrder = 5;
  return sprite;
}

export class Avatar {
  readonly root = new THREE.Group();
  /** Pivot at the feet: collapse rotates this, not the root (root follows the snapshot). */
  private readonly body = new THREE.Group();
  private readonly torso: THREE.Mesh;
  private readonly trim: THREE.Mesh;
  private readonly legL: THREE.Mesh;
  private readonly legR: THREE.Mesh;
  private readonly gun: THREE.Mesh;
  private readonly lance: THREE.Group;
  private readonly blob: THREE.Mesh;
  private readonly rim: RimUniforms;
  readonly trimMat: THREE.MeshStandardMaterial;
  private readonly baseTrim: THREE.Color;
  private last = new THREE.Vector3(Number.NaN, 0, 0);
  private speed = 0;
  private phase = 0;
  private wasAlive = true;
  private deathAt = -1;
  private hitUntil = 0;
  private dir = 1;

  constructor(lib: MaterialLibrary, seat: number, name: string) {
    const { mat, rim } = gearMaterial(lib);
    this.rim = rim;
    const t = torsoGeometry();
    this.torso = new THREE.Mesh(t.gear, mat);
    this.trimMat = trimMaterial(seat);
    this.baseTrim = this.trimMat.emissive.clone();
    this.trim = new THREE.Mesh(t.trim, this.trimMat);
    sharedLeg ??= legGeometry(lib);
    this.legL = new THREE.Mesh(sharedLeg, mat);
    this.legR = new THREE.Mesh(sharedLeg, mat);
    this.legL.position.set(-0.11, 0.92, 0);
    this.legR.position.set(0.11, 0.92, 0);
    this.gun = new THREE.Mesh(gunGeometry(), mat);
    this.lance = lanceGroup(lib);
    this.lance.visible = false;
    this.body.add(this.torso, this.trim, this.legL, this.legR, this.gun, this.lance);
    this.root.add(this.body);

    blobMat ??= new THREE.MeshBasicMaterial({ map: radialTexture(64, "rgba(0,0,0,0.85)", "rgba(0,0,0,0)"), transparent: true, depthWrite: false, color: 0xffffff });
    blobGeo ??= new THREE.PlaneGeometry(1.1, 1.1);
    this.blob = new THREE.Mesh(blobGeo, blobMat);
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.position.y = 0.02;
    this.blob.renderOrder = 1;
    this.root.add(this.blob);
    this.root.add(nameplate(name, SEAT_TRIM[seat % SEAT_TRIM.length] ?? 0xffffff));
    this.root.traverse((o) => {
      o.castShadow = false;
      o.receiveShadow = o !== this.blob;
    });
  }

  /** Brief red rim when this player takes a hit. */
  hit(now: number): void {
    this.hitUntil = now + 120;
  }

  update(p: { x: number; y: number; z: number; yaw: number }, alive: boolean, invulnerable: boolean, weapon: WeaponId, charging: boolean, now: number, dt: number): void {
    this.root.position.set(p.x, p.y, p.z);
    this.root.rotation.y = p.yaw;
    // Death: keep the body for a 0.6 s collapse, then hide until respawn.
    if (this.wasAlive && !alive) this.deathAt = now;
    if (!this.wasAlive && alive) {
      this.deathAt = -1;
      this.body.rotation.set(0, 0, 0);
      this.body.position.set(0, 0, 0);
      this.last.set(Number.NaN, 0, 0);
    }
    this.wasAlive = alive;
    if (!alive) {
      const t = this.deathAt < 0 ? 1 : Math.min(1, (now - this.deathAt) / 600);
      const e = 1 - Math.pow(1 - t, 3);
      this.body.rotation.x = e * 1.35 * this.dir;
      this.body.position.y = -e * 0.25;
      this.root.visible = t < 1;
      this.blob.visible = false;
      this.rim.uRimColor.value.set(PALETTE.combat);
      this.rim.uRim.value = (1 - t) * 1.2;
      return;
    }
    this.root.visible = true;
    this.blob.visible = true;

    // Stride from ground speed.
    if (!Number.isNaN(this.last.x) && dt > 0) {
      const d = Math.hypot(p.x - this.last.x, p.z - this.last.z);
      const v = Math.min(8, d / dt);
      this.speed += (v - this.speed) * Math.min(1, dt * 10);
    }
    this.last.set(p.x, p.y, p.z);
    const k = Math.min(1, this.speed / MOVEMENT.runSpeed);
    this.phase += this.speed * dt * 2.4;
    const swing = Math.sin(this.phase) * 0.55 * k;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.body.position.y = Math.abs(Math.cos(this.phase)) * 0.035 * k;
    this.dir = Math.random() < 0.5 ? 1 : -1;

    this.gun.visible = weapon !== "lance";
    this.lance.visible = weapon === "lance";
    // Rim: red hit flash wins, then cyan invulnerability pulse.
    if (now < this.hitUntil) {
      this.rim.uRimColor.value.set(PALETTE.combat);
      this.rim.uRim.value = 1.3;
    } else if (invulnerable) {
      this.rim.uRimColor.value.set(PALETTE.cyan);
      this.rim.uRim.value = 0.8 + Math.sin(now / 60) * 0.3;
    } else this.rim.uRim.value = 0;
    // Charging the Lance lights the holder's arms and trim molten gold.
    if (charging) this.trimMat.emissive.set(PALETTE.lanceCore).multiplyScalar(1.6 + Math.sin(now / 25) * 0.4);
    else this.trimMat.emissive.copy(this.baseTrim);
  }

  dispose(): void {
    (this.torso.material as THREE.Material).dispose();
  }
}
