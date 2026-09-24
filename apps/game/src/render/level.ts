import * as THREE from "three";
import { DRYDOCK_09, type MapBox } from "@potlock/shared";
import { StaticBatch } from "./batch.js";
import { BULBS, SPOTS } from "./lights.js";
import type { MaterialLibrary } from "./materials.js";
import { hex, PALETTE } from "./palette.js";
import { buildWater, type Water } from "./water.js";

/**
 * Drydock 09, dressed. Every collision box from the shared map keeps its exact footprint;
 * this module only decides what each one looks like and adds non-colliding dressing that
 * stays out of movement space (inside walls, above head height, flat on the floor).
 *
 * North edge: open-sided warehouse shed with a cantilevered roof and sodium work lamps.
 * South edge: dock kerb, fence and the harbour sheet, cyan floods on poles.
 * East edge: a stacked container wall. West edge: warehouse gable with a roller door.
 * Far south-east over the water: the crane pylon with its red navigation beacon.
 */

type Key =
  | "concrete"
  | "corrugated"
  | "plate"
  | "grating"
  | "livery"
  | "crate"
  | "brass"
  | "rubber"
  | "glass"
  | "sodiumGlow"
  | "cyanGlow"
  | "beacon"
  | "windowGlow"
  | "chain";

const HX = 24;
const HZ = 16;
const WATER_Y = -1.7;
const DOCK_EDGE_Z = -HZ - 1.35;

/** Container paints: rust, blue-grey, livery orange, dark teal-grey. Muted, no brands. */
const CONTAINER_TINTS = [0x6a4a3a, 0x3c4a55, 0xb0603a, 0x34463f, 0x5a3a30, 0x4a4e52];
const STEEL_DARK = 0x4a5058;
const STEEL_MID = 0x6a7078;
const RUST_TINT = 0x8a5a44;
const CONCRETE_TINT = 0xa8a8a8;

export interface Level {
  group: THREE.Group;
  /** Beacon world position for the gated flare. */
  beacon: THREE.Vector3;
  /** Steam vent position (ambient particles). */
  steamVent: THREE.Vector3;
  /** Lamp the moths circle. */
  mothLamp: THREE.Vector3;
  update(time: number): void;
}

function chainTexture(aniso: number): THREE.CanvasTexture {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  if (g) {
    g.fillStyle = "#000";
    g.fillRect(0, 0, size, size);
    g.strokeStyle = "#fff";
    g.lineWidth = 5;
    for (let i = -size; i < size * 2; i += size / 2) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + size, size);
      g.moveTo(i + size, 0);
      g.lineTo(i, size);
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  return t;
}

/** Painted stencil text as a transparent decal texture (worn). */
function stencilTexture(text: string, w: number, h: number, color: string, alpha: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (g) {
    g.clearRect(0, 0, w, h);
    g.globalAlpha = alpha;
    g.fillStyle = color;
    g.font = `800 ${Math.floor(h * 0.78)}px "Arial Narrow", "Helvetica Neue", Arial, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, w / 2, h / 2 + h * 0.04);
    // Stencil bridges and wear.
    g.globalCompositeOperation = "destination-out";
    g.fillRect(0, h * 0.47, w, h * 0.04);
    for (let i = 0; i < 600; i++) {
      g.globalAlpha = Math.random() * 0.8;
      const r = Math.random() * h * 0.03;
      g.beginPath();
      g.arc(Math.random() * w, Math.random() * h, r, 0, Math.PI * 2);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function decal(tex: THREE.Texture, w: number, h: number, pos: THREE.Vector3Tuple, rotY: number, lib: MaterialLibrary): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      roughness: 0.6,
      metalness: 0.1,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      normalMap: lib.micro.normal,
    }),
  );
  m.position.set(...pos);
  m.rotation.y = rotY;
  m.receiveShadow = true;
  return m;
}

export function buildLevel(lib: MaterialLibrary, aniso: number): Level {
  const group = new THREE.Group();
  const B = new StaticBatch<Key>();
  const chainMat = new THREE.MeshStandardMaterial({
    color: 0x6a7078,
    metalness: 0.8,
    roughness: 0.4,
    alphaMap: chainTexture(aniso),
    alphaTest: 0.5,
    side: THREE.DoubleSide,
  });
  (chainMat.alphaMap as THREE.Texture).repeat.set(4, 4);
  const windowGlow = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: PALETTE.sodium, emissiveIntensity: 0.9, roughness: 0.5 });

  // ---------- floor ----------
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HX * 2, HZ * 2), lib.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.name = "floor";
  group.add(floor);

  // ---------- map boxes ----------
  let containerIndex = 0;
  for (const box of DRYDOCK_09.boxes) {
    switch (box.kind) {
      case "container":
        container(B, box, CONTAINER_TINTS[containerIndex++ % CONTAINER_TINTS.length] ?? RUST_TINT, containerIndex % 2 === 0);
        break;
      case "crate":
        crate(B, box);
        break;
      case "bollard":
        bollard(B, box);
        break;
      case "catwalk":
        catwalk(B, box);
        break;
      case "rail":
        rail(B, box);
        break;
      case "pillar":
        pillar(B, box);
        break;
      case "stair":
        stair(B, box);
        break;
      case "tower":
        tower(B, box);
        break;
      case "floor":
      case "wall":
        break;
    }
  }

  // ---------- perimeter ----------
  northShed(B);
  southDock(B);
  eastStack(B);
  westGable(B);
  pipeRun(B);
  lampFixtures(B);
  const beacon = crane(B);
  const steamVent = new THREE.Vector3(-7.5, 0.02, 15.35);
  B.aabb("grating", steamVent.x - 0.6, 0.005, steamVent.z - 0.35, steamVent.x + 0.6, 0.03, steamVent.z + 0.35, { tint: STEEL_DARK });
  B.aabb("plate", steamVent.x - 0.7, 0.0, steamVent.z - 0.45, steamVent.x + 0.7, 0.012, steamVent.z + 0.45, { tint: 0x2a2e33 });

  const meshes = B.build(
    {
      concrete: lib.concrete,
      corrugated: lib.corrugated,
      plate: lib.plate,
      grating: lib.grating,
      livery: lib.livery,
      crate: lib.crate,
      brass: lib.brass,
      rubber: lib.rubber,
      glass: lib.glass,
      sodiumGlow: lib.sodiumGlow,
      cyanGlow: lib.cyanGlow,
      beacon: lib.beacon,
      windowGlow,
      chain: chainMat,
    },
    (key) => {
      const glowing = key === "sodiumGlow" || key === "cyanGlow" || key === "beacon" || key === "windowGlow" || key === "glass";
      return { cast: !glowing && key !== "chain", receive: !glowing };
    },
  );
  for (const m of meshes) group.add(m);

  // ---------- stencils ----------
  const livery = hex(PALETTE.livery);
  group.add(decal(stencilTexture("09", 512, 256, livery, 0.8), 7, 3.5, [-HX + 0.02, 11.4, 0], Math.PI / 2, lib));
  group.add(decal(stencilTexture("HOIST CAB", 512, 96, "#c9c2b4", 0.55), 4.2, 0.8, [-14 + 0.02 + 0.0, 4.6, -11.5], Math.PI / 2, lib));
  group.add(decal(stencilTexture("SIGNAL 09", 512, 96, "#c9c2b4", 0.55), 4.2, 0.8, [14 - 0.02, 4.6, 11.5], -Math.PI / 2, lib));
  group.add(decal(stencilTexture("NO STANDING ON EDGE", 1024, 96, livery, 0.6), 5.5, 0.5, [6, 0.45, -HZ + 0.02], 0, lib));

  const water: Water = buildWater(DOCK_EDGE_Z, WATER_Y, aniso);
  group.add(water.group);

  const beaconMat = lib.beacon;
  return {
    group,
    beacon,
    steamVent,
    mothLamp: new THREE.Vector3(...(BULBS[0] ?? [0, 7, 14])),
    update(time: number) {
      water.update(time);
      // Navigation beacon: ~0.8 Hz blink with a soft ramp.
      const phase = (time * 0.8) % 1;
      beaconMat.emissiveIntensity = phase < 0.35 ? 14 * Math.sin((phase / 0.35) * Math.PI) : 0.3;
    },
  };
}

// ---------- pieces ----------

function container(B: StaticBatch<Key>, b: MapBox, tint: number, doorAtMax: boolean): void {
  const sx = b.max.x - b.min.x;
  const sy = b.max.y - b.min.y;
  const sz = b.max.z - b.min.z;
  const alongX = sx >= sz;
  const inset = 0.05;
  // Corrugated body (inset between the frame posts).
  B.aabb("corrugated", b.min.x + (alongX ? 0.12 : inset), b.min.y + 0.12, b.min.z + (alongX ? inset : 0.12), b.max.x - (alongX ? 0.12 : inset), b.max.y - 0.1, b.max.z - (alongX ? inset : 0.12), { tint });
  // Roof plate.
  B.aabb("plate", b.min.x + 0.06, b.max.y - 0.1, b.min.z + 0.06, b.max.x - 0.06, b.max.y - 0.02, b.max.z - 0.06, { tint, shade: 0.85 });
  // Corner posts and rails, slightly darker, bevelled so edges catch light.
  const frame = { tint, shade: 0.55, bevel: 0.02 };
  const p = 0.16;
  for (const x of [b.min.x + p / 2, b.max.x - p / 2]) {
    for (const z of [b.min.z + p / 2, b.max.z - p / 2]) B.box("plate", x, (b.min.y + b.max.y) / 2, z, p, sy, p, frame);
  }
  for (const y of [b.min.y + 0.07, b.max.y - 0.07]) {
    if (alongX) for (const z of [b.min.z + 0.07, b.max.z - 0.07]) B.box("plate", (b.min.x + b.max.x) / 2, y, z, sx, 0.14, 0.14, frame);
    else for (const x of [b.min.x + 0.07, b.max.x - 0.07]) B.box("plate", x, y, (b.min.z + b.max.z) / 2, 0.14, 0.14, sz, frame);
  }
  // Door end: plate doors with four locking bars and cams.
  const endCoord = doorAtMax ? (alongX ? b.max.x : b.max.z) : alongX ? b.min.x : b.min.z;
  const out = doorAtMax ? 1 : -1;
  const width = alongX ? sz : sx;
  const mid = alongX ? (b.min.z + b.max.z) / 2 : (b.min.x + b.max.x) / 2;
  if (alongX) B.aabb("plate", endCoord - out * 0.06, b.min.y + 0.14, b.min.z + 0.14, endCoord - out * 0.01, b.max.y - 0.14, b.max.z - 0.14, { tint, shade: 0.9 });
  else B.aabb("plate", b.min.x + 0.14, b.min.y + 0.14, endCoord - out * 0.06, b.max.x - 0.14, b.max.y - 0.14, endCoord - out * 0.01, { tint, shade: 0.9 });
  for (const f of [-0.38, -0.14, 0.14, 0.38]) {
    const w = mid + f * width;
    const at = endCoord + out * 0.02;
    const bx = alongX ? at : w;
    const bz = alongX ? w : at;
    B.cyl("plate", bx, (b.min.y + b.max.y) / 2, bz, 0.022, 0.022, sy - 0.4, { tint: STEEL_MID, seg: 6 });
    B.box("livery", bx, b.min.y + sy * 0.42, bz, alongX ? 0.05 : 0.08, 0.18, alongX ? 0.08 : 0.05, { tint: 0xffffff });
  }
}

function crate(B: StaticBatch<Key>, b: MapBox): void {
  const s = (b.max.x - b.min.x) * 0.999;
  const cx = (b.min.x + b.max.x) / 2;
  const cz = (b.min.z + b.max.z) / 2;
  const tone = 0.85 + (((cx * 7 + cz * 13) % 5) + 5) / 5 * 0.25;
  B.box("crate", cx, (b.min.y + b.max.y) / 2, cz, s, b.max.y - b.min.y, s, { uv: "keep", tint: 0xffffff, shade: tone, bevel: 0.015 });
  // Pallet skid underneath (inside the collision footprint).
  B.box("crate", cx, b.min.y + 0.05, cz, s * 0.98, 0.1, s * 0.98, { uv: "keep", shade: 0.55 });
}

function bollard(B: StaticBatch<Key>, b: MapBox): void {
  const cx = (b.min.x + b.max.x) / 2;
  const cz = (b.min.z + b.max.z) / 2;
  B.box("plate", cx, 0.02, cz, 0.6, 0.04, 0.6, { tint: STEEL_DARK });
  B.cyl("plate", cx, 0.34, cz, 0.24, 0.27, 0.62, { tint: RUST_TINT, shade: 0.7, seg: 14 });
  B.cyl("livery", cx, 0.52, cz, 0.245, 0.245, 0.1, { tint: 0xffffff, seg: 14 });
  B.cyl("plate", cx, 0.72, cz, 0.3, 0.3, 0.12, { tint: RUST_TINT, shade: 0.6, seg: 14 });
}

function catwalk(B: StaticBatch<Key>, b: MapBox): void {
  const sx = b.max.x - b.min.x;
  const sz = b.max.z - b.min.z;
  const alongX = sx >= sz;
  // Grated deck, a hair below the collision top so feet sit on it.
  B.aabb("grating", b.min.x, b.max.y - 0.03, b.min.z, b.max.x, b.max.y - 0.005, b.max.z, { tint: 0xb0b4b8 });
  // Side stringers (C-channel look) and cross members underneath.
  const st = { tint: STEEL_DARK, bevel: 0.01 };
  if (alongX) {
    for (const z of [b.min.z + 0.04, b.max.z - 0.04]) B.box("plate", (b.min.x + b.max.x) / 2, b.max.y - 0.16, z, sx, 0.3, 0.08, st);
    for (let x = b.min.x + 0.6; x < b.max.x; x += 1.2) B.box("plate", x, b.min.y + 0.06, (b.min.z + b.max.z) / 2, 0.08, 0.12, sz - 0.1, st);
  } else {
    for (const x of [b.min.x + 0.04, b.max.x - 0.04]) B.box("plate", x, b.max.y - 0.16, (b.min.z + b.max.z) / 2, 0.08, 0.3, sz, st);
    for (let z = b.min.z + 0.6; z < b.max.z; z += 1.2) B.box("plate", (b.min.x + b.max.x) / 2, b.min.y + 0.06, z, sx - 0.1, 0.12, 0.08, st);
  }
  // Livery kick strip along the outer edges.
  if (alongX) for (const z of [b.min.z + 0.005, b.max.z - 0.005]) B.box("livery", (b.min.x + b.max.x) / 2, b.max.y - 0.07, z, sx, 0.08, 0.012, {});
}

function rail(B: StaticBatch<Key>, b: MapBox): void {
  const sx = b.max.x - b.min.x;
  const sy = b.max.y - b.min.y;
  const sz = b.max.z - b.min.z;
  if (sx > 0.8 && sz > 0.8) {
    // Winch console on the Signal Booth roof.
    B.aabb("plate", b.min.x, b.min.y, b.min.z, b.max.x, b.max.y - 0.25, b.max.z, { tint: STEEL_DARK, bevel: 0.03 });
    B.aabb("livery", b.min.x - 0.005, b.max.y - 0.25, b.min.z - 0.005, b.max.x + 0.005, b.max.y, b.max.z + 0.005, {});
    B.box("cyanGlow", (b.min.x + b.max.x) / 2, b.min.y + sy * 0.55, b.min.z - 0.01, sx * 0.6, 0.14, 0.02, {});
    return;
  }
  // Solid kick panel (bullets stop here, so it must look solid) with a round top rail.
  const alongX = sx >= sz;
  B.aabb("plate", b.min.x, b.min.y, b.min.z, b.max.x, b.max.y - 0.08, b.max.z, { tint: 0x3a4048 });
  const cy = b.max.y - 0.05;
  if (alongX) B.pipe("livery", [b.min.x, cy, (b.min.z + b.max.z) / 2], [b.max.x, cy, (b.min.z + b.max.z) / 2], Math.min(0.06, sz / 2), {});
  else B.pipe("livery", [(b.min.x + b.max.x) / 2, cy, b.min.z], [(b.min.x + b.max.x) / 2, cy, b.max.z], Math.min(0.06, sx / 2), {});
  // Posts every 1.5 m, proud of the panel.
  const len = alongX ? sx : sz;
  for (let d = 0.1; d < len; d += 1.5) {
    const px = alongX ? b.min.x + d : (b.min.x + b.max.x) / 2;
    const pz = alongX ? (b.min.z + b.max.z) / 2 : b.min.z + d;
    B.box("plate", px, (b.min.y + b.max.y) / 2, pz, alongX ? 0.06 : sx + 0.02, sy, alongX ? sz + 0.02 : 0.06, { tint: STEEL_MID });
  }
}

function pillar(B: StaticBatch<Key>, b: MapBox): void {
  const cx = (b.min.x + b.max.x) / 2;
  const cz = (b.min.z + b.max.z) / 2;
  const sx = b.max.x - b.min.x;
  const sz = b.max.z - b.min.z;
  const h = b.max.y - b.min.y;
  // I-beam: two flanges and a web.
  B.box("plate", cx, h / 2, b.min.z + 0.02, sx, h, 0.04, { tint: STEEL_DARK });
  B.box("plate", cx, h / 2, b.max.z - 0.02, sx, h, 0.04, { tint: STEEL_DARK });
  B.box("plate", cx, h / 2, cz, 0.05, h, sz, { tint: STEEL_DARK });
  B.box("livery", cx, 0.3, cz, sx + 0.01, 0.6, sz + 0.01, {});
  B.box("plate", cx, 0.02, cz, sx + 0.2, 0.04, sz + 0.2, { tint: 0x2a2e33 });
}

function stair(B: StaticBatch<Key>, b: MapBox): void {
  B.aabb("plate", b.min.x, b.min.y, b.min.z, b.max.x, b.max.y - 0.04, b.max.z, { tint: 0x454b52 });
  // Tread: grating with a livery nosing on both x edges.
  B.aabb("grating", b.min.x, b.max.y - 0.04, b.min.z, b.max.x, b.max.y - 0.005, b.max.z, { tint: 0xb0b4b8 });
  for (const x of [b.min.x + 0.03, b.max.x - 0.03]) B.box("livery", x, b.max.y - 0.025, (b.min.z + b.max.z) / 2, 0.06, 0.05, b.max.z - b.min.z, {});
}

function tower(B: StaticBatch<Key>, b: MapBox): void {
  const sx = b.max.x - b.min.x;
  const sz = b.max.z - b.min.z;
  const cx = (b.min.x + b.max.x) / 2;
  const cz = (b.min.z + b.max.z) / 2;
  const h = b.max.y - b.min.y;
  // Plate-clad body over a poured plinth, livery band at the parapet.
  B.aabb("plate", b.min.x, 0.9, b.min.z, b.max.x, h - 0.45, b.max.z, { tint: 0x3d4650 });
  B.aabb("concrete", b.min.x - 0.03, 0, b.min.z - 0.03, b.max.x + 0.03, 0.9, b.max.z + 0.03, { tint: CONCRETE_TINT });
  B.aabb("livery", b.min.x - 0.02, h - 0.45, b.min.z - 0.02, b.max.x + 0.02, h, b.max.z + 0.02, {});
  // Roof deck plate.
  B.aabb("plate", b.min.x + 0.02, h - 0.01, b.min.z + 0.02, b.max.x - 0.02, h + 0.005, b.max.z - 0.02, { tint: 0x5a6068 });
  // Lit slot windows on the two faces that look into the arena.
  const faceX = cx > 0 ? b.min.x : b.max.x;
  const faceZ = cz > 0 ? b.min.z : b.max.z;
  const outX = cx > 0 ? -1 : 1;
  const outZ = cz > 0 ? -1 : 1;
  for (let i = 0; i < 3; i++) {
    const z = b.min.z + sz * (0.2 + i * 0.3);
    B.box("windowGlow", faceX + outX * 0.005, 3.1, z, 0.02, 0.9, sz * 0.18, {});
    B.box("glass", faceX + outX * 0.03, 3.1, z, 0.02, 0.95, sz * 0.19, {});
    B.box("plate", faceX + outX * 0.04, 3.1 - 0.52, z, 0.08, 0.08, sz * 0.21, { tint: STEEL_MID });
  }
  for (let i = 0; i < 4; i++) {
    const x = b.min.x + sx * (0.14 + i * 0.24);
    B.box("windowGlow", x, 3.1, faceZ + outZ * 0.005, sx * 0.14, 0.9, 0.02, {});
    B.box("glass", x, 3.1, faceZ + outZ * 0.03, sx * 0.15, 0.95, 0.02, {});
    B.box("plate", x, 3.1 - 0.52, faceZ + outZ * 0.04, sx * 0.17, 0.08, 0.08, { tint: STEEL_MID });
  }
  // Vertical cladding ribs.
  for (let x = b.min.x + 1; x < b.max.x; x += 2) B.box("plate", x, (0.9 + h - 0.45) / 2, faceZ + outZ * 0.03, 0.1, h - 1.35, 0.06, { tint: STEEL_DARK });
}

// ---------- perimeter ----------

function northShed(B: StaticBatch<Key>): void {
  const z0 = HZ; // inner face of the north wall
  // Back wall: corrugated cladding over a concrete footing.
  B.aabb("corrugated", -HX - 1, 0.6, z0, HX + 1, 10.6, z0 + 0.3, { tint: 0x55636a });
  B.aabb("concrete", -HX - 1, 0, z0 - 0.04, HX + 1, 0.6, z0 + 0.3, { tint: CONCRETE_TINT, shade: 0.8 });
  B.aabb("livery", -HX - 1, 3.4, z0 - 0.02, HX + 1, 3.6, z0 + 0.1, {});
  // Cantilevered roof deck with fascia.
  const roofY = 9.7;
  const front = 9.5;
  B.aabb("corrugated", -HX - 1, roofY, front, HX + 1, roofY + 0.12, z0 + 0.3, { tint: 0x3d474d });
  B.aabb("livery", -HX - 1, roofY - 0.18, front - 0.08, HX + 1, roofY + 0.14, front, {});
  // Ribs: bottom chord, diagonal strut back to the wall, purlins.
  for (let x = -HX; x <= HX; x += 6) {
    B.beam("plate", [x, roofY - 0.2, front + 0.1], [x, roofY - 0.2, z0], 0.14, { tint: STEEL_DARK }, 0.28);
    B.beam("plate", [x, 6.8, z0], [x, roofY - 0.3, front + 3.2], 0.12, { tint: STEEL_DARK });
    B.box("plate", x, 3.5, z0 + 0.05, 0.3, 7, 0.1, { tint: STEEL_DARK });
  }
  for (const z of [front + 1, front + 3.3, z0 - 1]) B.box("plate", 0, roofY - 0.08, z, HX * 2 + 2, 0.12, 0.1, { tint: STEEL_DARK });
  // Cable tray with drooping runs.
  B.aabb("plate", -HX, 5.2, z0 - 0.35, HX, 5.28, z0, { tint: 0x5a6068 });
  for (let x = -HX + 2; x < HX - 4; x += 7) B.cable("rubber", [x, 5.2, z0 - 0.2], [x + 5, 5.2, z0 - 0.2], 0.5, 0.025, {});
  // Tire stops along the wall base.
  for (let x = -20; x < 12; x += 4.2) B.box("rubber", x, 0.07, z0 - 0.18, 1.5, 0.14, 0.2, { bevel: 0.03, uv: "world" });
}

function southDock(B: StaticBatch<Key>): void {
  const z0 = -HZ; // inner face of the south wall
  // Kerb and dock face down to the water.
  B.aabb("concrete", -HX - 1, 0, z0 - 1, HX + 1, 0.9, z0, { tint: CONCRETE_TINT, shade: 0.9, bevel: 0.03 });
  B.aabb("concrete", -HX - 1, WATER_Y - 1.5, DOCK_EDGE_Z, HX + 1, 0, z0 - 1, { tint: CONCRETE_TINT, shade: 0.6 });
  B.aabb("plate", -HX - 1, -0.12, DOCK_EDGE_Z - 0.06, HX + 1, 0.02, DOCK_EDGE_Z + 0.06, { tint: RUST_TINT, shade: 0.8 });
  B.aabb("livery", -HX - 1, 0.86, z0 - 0.02, HX + 1, 0.92, z0 + 0.005, {});
  // Fender tyres on the dock face.
  for (let x = -21; x <= 21; x += 4.5) B.torus("rubber", x, -0.85, DOCK_EDGE_Z - 0.18, 0.42, 0.16, { seg: 14 });
  // Mooring bollards on the kerb, out of reach behind the fence.
  for (let x = -18; x <= 18; x += 9) {
    B.cyl("plate", x, 0.9 + 0.25, z0 - 0.55, 0.18, 0.2, 0.5, { tint: RUST_TINT, shade: 0.7, seg: 12 });
    B.cyl("plate", x, 0.9 + 0.52, z0 - 0.55, 0.24, 0.24, 0.08, { tint: RUST_TINT, shade: 0.6, seg: 12 });
  }
  // Chain-link fence on posts: reads as a boundary you would not climb.
  const top = 3.5;
  B.aabb("chain", -HX, 0.9, z0 - 0.52, HX, top, z0 - 0.5, { tint: 0xffffff });
  for (let x = -HX; x <= HX; x += 3) B.cyl("plate", x, (0.9 + top) / 2, z0 - 0.5, 0.045, 0.045, top - 0.9, { tint: STEEL_MID, seg: 8 });
  B.pipe("plate", [-HX, top, z0 - 0.5], [HX, top, z0 - 0.5], 0.035, { tint: STEEL_MID });
  B.pipe("plate", [-HX, 1.0, z0 - 0.5], [HX, 1.0, z0 - 0.5], 0.03, { tint: STEEL_MID });
}

function eastStack(B: StaticBatch<Key>): void {
  const len = 6.06;
  const hgt = 2.59;
  let i = 0;
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 5; col++) {
      if (row === 3 && (col === 1 || col === 4)) continue;
      const z0 = -HZ + 0.05 + col * (len + 0.42) - (row % 2 ? 0.9 : 0);
      const box: MapBox = {
        kind: "container",
        min: { x: HX + 0.02, y: row * hgt, z: Math.max(-HZ - 0.9, z0) },
        max: { x: HX + 2.46, y: (row + 1) * hgt, z: Math.min(HZ + 0.9, z0 + len) },
      };
      container(B, box, CONTAINER_TINTS[(i++ * 5 + row) % CONTAINER_TINTS.length] ?? RUST_TINT, row % 2 === 0);
    }
  }
}

function westGable(B: StaticBatch<Key>): void {
  const x0 = -HX;
  B.aabb("corrugated", x0 - 0.3, 0.6, -HZ - 1, x0, 14, HZ + 1, { tint: 0x4a585e });
  B.aabb("concrete", x0 - 0.3, 0, -HZ - 1, x0 + 0.04, 0.6, HZ + 1, { tint: CONCRETE_TINT, shade: 0.8 });
  // Gable peak.
  const shape = new THREE.Shape();
  shape.moveTo(-HZ - 1, 0);
  shape.lineTo(HZ + 1, 0);
  shape.lineTo(0, 4);
  shape.closePath();
  const geom = new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: false });
  const m = new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(x0 - 0.3, 14, 0);
  B.add("corrugated", geom, m, { tint: 0x4a585e });
  geom.dispose();
  B.aabb("livery", x0 - 0.02, 9.1, -HZ - 1, x0 + 0.03, 9.4, HZ + 1, {});
  // Roller door at the end of the kill lane, with guide rails and a hood.
  B.aabb("plate", x0 + 0.01, 0.1, -3.6, x0 + 0.06, 6.2, 3.6, { tint: RUST_TINT, shade: 0.9 });
  for (let y = 0.3; y < 6.2; y += 0.3) B.box("plate", x0 + 0.08, y, 0, 0.03, 0.05, 7.2, { tint: RUST_TINT, shade: 0.7 });
  B.aabb("livery", x0 + 0.06, 0.1, -3.6, x0 + 0.1, 0.5, 3.6, {});
  for (const z of [-3.75, 3.75]) B.box("plate", x0 + 0.1, 3.2, z, 0.18, 6.4, 0.2, { tint: STEEL_DARK });
  B.box("plate", x0 + 0.25, 6.6, 0, 0.5, 0.7, 7.9, { tint: STEEL_DARK, bevel: 0.04 });
  // Personnel door with a caged light above, inside the wall line.
  B.aabb("plate", x0 + 0.01, 0.05, 8, x0 + 0.06, 2.4, 9.1, { tint: 0x3c4a55 });
}

/** Pipe run under the north catwalk: the "valve walk". Above head height, clear of movement. */
function pipeRun(B: StaticBatch<Key>): void {
  for (const [dz, r, tint] of [
    [6.35, 0.1, 0x6a4a3a],
    [6.65, 0.08, 0x3c4a55],
  ] as const) {
    for (const s of [1, -1]) {
      const z = dz * s;
      B.pipe("plate", [-17.8 * s, 2.45, z], [5.8 * s, 2.45, z], r, { tint, seg: 12 });
      // Flanges.
      for (let x = -16; x < 6; x += 3) B.cyl("plate", x * s, 2.45, z, r + 0.03, r + 0.03, 0.06, { rotZ: Math.PI / 2, tint: STEEL_MID, seg: 12 });
    }
  }
  // Valve wheels hung under the deck at each pillar line.
  for (const s of [1, -1]) {
    for (const x of [-14, -4, 4]) {
      B.torus("livery", x * s, 2.2, 6.5 * s, 0.18, 0.025, { rotX: Math.PI / 2, seg: 18 });
      B.pipe("plate", [x * s, 2.2, 6.5 * s], [x * s, 2.45, 6.5 * s], 0.025, { tint: STEEL_MID });
    }
  }
}

function lampFixtures(B: StaticBatch<Key>): void {
  for (const s of SPOTS) {
    const [x, y, z] = s.pos;
    const glowKey: Key = s.color === PALETTE.cyan ? "cyanGlow" : "sodiumGlow";
    if (s.model === "shedLamp") {
      // Hanging dome shade on a drop rod from the roof.
      B.pipe("plate", [x, y + 0.2, z], [x, 9.6, z], 0.02, { tint: STEEL_DARK });
      B.cyl("plate", x, y + 0.08, z, 0.12, 0.42, 0.3, { tint: 0x2b3036, open: true, seg: 16 });
      B.cyl("sodiumGlow", x, y - 0.06, z, 0.36, 0.36, 0.02, { seg: 16 });
    } else {
      // Pole in the wall volume with an angled head facing the target.
      const base = s.model === "flood" && z < 0 ? 0.9 : 0;
      if (Math.abs(x) < HX) B.cyl("plate", x, (base + y) / 2, z, 0.1, 0.13, y - base, { tint: STEEL_DARK, seg: 10 });
      const dir = new THREE.Vector3(s.target[0] - x, s.target[1] - y, s.target[2] - z).normalize();
      const head = new THREE.Vector3(x, y, z);
      B.beam("plate", head.toArray(), head.clone().addScaledVector(dir, 0.45).toArray(), 0.62, { tint: 0x2b3036 }, 0.42);
      B.beam(glowKey, head.clone().addScaledVector(dir, 0.46).toArray(), head.clone().addScaledVector(dir, 0.48).toArray(), 0.5, {}, 0.32);
    }
  }
  for (const b of BULBS) {
    const [x, y, z] = b;
    B.pipe("rubber", [x, y + 0.15, z], [x, 9.6, z], 0.012, {});
    B.cyl("sodiumGlow", x, y, z, 0.07, 0.07, 0.16, { seg: 10 });
    // Wire cage.
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI;
      B.torus("plate", x, y, z, 0.12, 0.006, { rotY: a, seg: 12, tint: STEEL_MID });
    }
    B.cyl("plate", x, y + 0.16, z, 0.05, 0.08, 0.08, { tint: STEEL_DARK, seg: 10 });
  }
}

/** Crane pylon far out on the water: unclimbable monument and skyline landmark. */
function crane(B: StaticBatch<Key>): THREE.Vector3 {
  const cx = 16;
  const cz = -46;
  const H = 38;
  const leg = (t: number, sx: number, sz: number): THREE.Vector3Tuple => {
    const spread = 3.2 - 1.6 * t;
    return [cx + sx * spread, WATER_Y + t * (H - WATER_Y), cz + sz * spread];
  };
  const corners: [number, number][] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  const steel = { tint: 0x3a2e28 };
  for (const [sx, sz] of corners) B.beam("plate", leg(0, sx, sz), leg(1, sx, sz), 0.45, steel);
  // Lattice: horizontal rings and X braces every 4 m.
  const levels = 9;
  for (let i = 0; i < levels; i++) {
    const t0 = i / levels;
    const t1 = (i + 1) / levels;
    for (let k = 0; k < 4; k++) {
      const [ax, az] = corners[k] ?? [1, 1];
      const [bx, bz] = corners[(k + 1) % 4] ?? [1, 1];
      B.beam("plate", leg(t1, ax, az), leg(t1, bx, bz), 0.18, steel);
      B.beam("plate", leg(t0, ax, az), leg(t1, bx, bz), 0.12, steel);
      B.beam("plate", leg(t0, bx, bz), leg(t1, ax, az), 0.12, steel);
    }
  }
  // Jib toward the quay and a counter-jib with its counterweight.
  const top = H;
  const jibEnd: THREE.Vector3Tuple = [cx - 26, top + 0.5, cz + 22];
  const tail: THREE.Vector3Tuple = [cx + 10, top + 0.5, cz - 8];
  for (const off of [-0.8, 0.8]) {
    B.beam("livery", [cx + off, top, cz + off], jibEnd, 0.35, {});
    B.beam("plate", [cx + off, top + 2.2, cz + off], jibEnd, 0.22, steel);
    B.beam("plate", [cx + off, top, cz + off], tail, 0.35, steel);
  }
  for (let t = 0.1; t < 1; t += 0.1) {
    const p = new THREE.Vector3(cx, top, cz).lerp(new THREE.Vector3(...jibEnd), t);
    B.beam("plate", [p.x, p.y, p.z], [p.x, p.y + 2.2 * (1 - t), p.z], 0.12, steel);
  }
  B.box("concrete", tail[0], tail[1] - 1.2, tail[2], 3.4, 2.6, 3.4, { tint: CONCRETE_TINT, shade: 0.5, rotY: 0.7 });
  // Apex A-frame, operator cab, hoist line and block.
  const apex: THREE.Vector3Tuple = [cx, top + 6, cz];
  for (const [sx, sz] of corners) B.beam("plate", [cx + sx * 1.2, top, cz + sz * 1.2], apex, 0.25, steel);
  B.box("plate", cx - 1.6, top - 2.4, cz + 1.8, 2.4, 2.2, 2.2, { tint: 0x3c4a55, rotY: 0.7 });
  B.box("windowGlow", cx - 2.4, top - 2.2, cz + 2.6, 1.2, 0.7, 0.05, { rotY: 0.7 });
  const hook = new THREE.Vector3(...jibEnd).lerp(new THREE.Vector3(cx, top, cz), 0.25);
  B.pipe("plate", [hook.x, hook.y, hook.z], [hook.x, 16, hook.z], 0.04, { tint: STEEL_MID });
  B.box("livery", hook.x, 15.4, hook.z, 1.2, 1.2, 0.6, {});
  B.cyl("beacon", apex[0], apex[1] + 0.25, apex[2], 0.22, 0.22, 0.35, { seg: 10 });
  return new THREE.Vector3(apex[0], apex[1] + 0.3, apex[2]);
}
