import * as THREE from "three";
import { hex, PALETTE } from "./palette.js";

/**
 * Procedural PBR texture sets. Everything is generated once at load from seeded noise,
 * so the client ships no image assets and every surface is original.
 * Maps: sRGB albedo, tangent-space normal, and a packed ORM (R = AO, G = roughness, B = metalness).
 */

export interface TexSet {
  map: THREE.Texture;
  normal: THREE.Texture;
  orm: THREE.Texture;
}

interface Texel {
  r: number;
  g: number;
  b: number;
  /** Height used to derive the normal map, roughly 0..1. */
  h: number;
  rough: number;
  metal: number;
  ao: number;
}

// ---------- noise ----------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LATTICE = 256;

/** Tileable value noise on a 256 lattice; `period` cells repeat across the texture. */
export class Noise {
  private readonly v = new Float32Array(LATTICE * LATTICE);
  constructor(seed: number) {
    const rnd = mulberry32(seed);
    for (let i = 0; i < this.v.length; i++) this.v[i] = rnd();
  }

  /** Bilinear value noise in [0,1]. x,y are in lattice cells; wraps every `period` cells. */
  sample(x: number, y: number, period: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    let fx = x - xi;
    let fy = y - yi;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % period) + period) % period;
    const y0 = ((yi % period) + period) % period;
    const x1 = (x0 + 1) % period;
    const y1 = (y0 + 1) % period;
    const v = this.v;
    const a = v[y0 * LATTICE + x0]!;
    const b = v[y0 * LATTICE + x1]!;
    const c = v[y1 * LATTICE + x0]!;
    const d = v[y1 * LATTICE + x1]!;
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }

  /** Fractal sum of octaves in [0,1]. u,v in [0,1) texture space; `base` = cells across at octave 0. */
  fbm(u: number, v: number, base: number, octaves = 4): number {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    let p = base;
    for (let o = 0; o < octaves; o++) {
      const period = Math.min(LATTICE, p);
      sum += this.sample(u * p, v * p, period) * amp;
      norm += amp;
      amp *= 0.5;
      p *= 2;
    }
    return sum / norm;
  }
}

const N = new Noise(9);
const N2 = new Noise(4242);

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function rgb(c: number): [number, number, number] {
  return [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
}

// ---------- baking ----------

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) throw new Error("2D canvas unavailable");
  return { c, g };
}

function toTexture(c: HTMLCanvasElement, srgb: boolean, anisotropy: number): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = anisotropy;
  t.needsUpdate = true;
  return t;
}

/** Sobel normal from a wrapped height field. */
function normalFromHeight(h: Float32Array, w: number, hh: number, strength: number, wrap: boolean): ImageData {
  const out = new ImageData(w, hh);
  const d = out.data;
  const at = (x: number, y: number): number => {
    if (wrap) {
      x = (x + w) % w;
      y = (y + hh) % hh;
    } else {
      x = Math.min(w - 1, Math.max(0, x));
      y = Math.min(hh - 1, Math.max(0, y));
    }
    return h[y * w + x]!;
  };
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      // Canvas rows run top-down while texture v runs bottom-up, so flip the y gradient.
      const dy = (at(x, y - 1) - at(x, y + 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      d[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      d[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      d[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  return out;
}

export interface BakeOptions {
  w: number;
  h: number;
  normalStrength: number;
  anisotropy: number;
  wrap?: boolean;
  /** Optional canvas painter run over the albedo after the texel pass (text, stencils). */
  paint?: (g: CanvasRenderingContext2D, w: number, h: number) => void;
}

/** Runs `fn` for every texel (u,v in [0,1), v down the canvas) and bakes the three maps. */
export function bake(fn: (u: number, v: number, px: number, py: number, t: Texel) => void, o: BakeOptions): TexSet {
  const { w, h } = o;
  const color = canvas(w, h);
  const orm = canvas(w, h);
  const cImg = color.g.createImageData(w, h);
  const oImg = orm.g.createImageData(w, h);
  const height = new Float32Array(w * h);
  const t: Texel = { r: 0, g: 0, b: 0, h: 0, rough: 0.5, metal: 0, ao: 1 };
  for (let py = 0; py < h; py++) {
    const v = py / h;
    for (let px = 0; px < w; px++) {
      const u = px / w;
      t.r = t.g = t.b = 0.5;
      t.h = 0;
      t.rough = 0.5;
      t.metal = 0;
      t.ao = 1;
      fn(u, v, px, py, t);
      const i = py * w + px;
      const j = i * 4;
      cImg.data[j] = t.r * 255;
      cImg.data[j + 1] = t.g * 255;
      cImg.data[j + 2] = t.b * 255;
      cImg.data[j + 3] = 255;
      oImg.data[j] = t.ao * 255;
      oImg.data[j + 1] = t.rough * 255;
      oImg.data[j + 2] = t.metal * 255;
      oImg.data[j + 3] = 255;
      height[i] = t.h;
    }
  }
  color.g.putImageData(cImg, 0, 0);
  if (o.paint) o.paint(color.g, w, h);
  orm.g.putImageData(oImg, 0, 0);
  const nrm = canvas(w, h);
  nrm.g.putImageData(normalFromHeight(height, w, h, o.normalStrength, o.wrap ?? true), 0, 0);
  return {
    map: toTexture(color.c, true, o.anisotropy),
    normal: toTexture(nrm.c, false, o.anisotropy),
    orm: toTexture(orm.c, false, o.anisotropy),
  };
}

// ---------- material recipes ----------

const CONCRETE = rgb(PALETTE.wetConcrete);
const RUST = rgb(PALETTE.rustSteel);
const LIVERY = rgb(PALETTE.livery);

/** Poured concrete, tileable, for towers, parapets and plinths (1 tile ≈ 4 m). */
export function concreteSet(aniso: number, size = 512): TexSet {
  return bake(
    (u, v, _x, _y, t) => {
      const n = N.fbm(u, v, 8, 5);
      const fine = N2.fbm(u, v, 64, 2);
      const stain = smooth(0.55, 0.8, N2.fbm(u + 0.3, v, 4, 3));
      const k = 0.85 + n * 0.35 - stain * 0.25 + (fine - 0.5) * 0.08;
      t.r = CONCRETE[0] * k * 1.35;
      t.g = CONCRETE[1] * k * 1.35;
      t.b = CONCRETE[2] * k * 1.35;
      t.h = n * 0.5 + fine * 0.5;
      t.rough = 0.62 - stain * 0.15 + (fine - 0.5) * 0.1;
      t.metal = 0;
      t.ao = 0.85 + n * 0.15;
    },
    { w: size, h: size, normalStrength: 2.2, anisotropy: aniso },
  );
}

/** Corrugated sheet steel with chipped paint and rust runs. Albedo is light so vertex colour tints it. */
export function corrugatedSet(aniso: number, size = 512): TexSet {
  return bake(
    (u, v, _x, _y, t) => {
      // 16 ribs per tile (1 tile ≈ 2 m).
      const rib = Math.sin(u * Math.PI * 2 * 16);
      const ribH = Math.pow(Math.abs(rib), 0.6) * Math.sign(rib);
      const chip = N.fbm(u, v, 16, 4);
      const runs = N2.fbm(u * 3, v * 0.25, 8, 3); // vertical rust runs
      const rust = smooth(0.58, 0.72, chip * 0.6 + runs * 0.5 + (1 - v) * 0.08);
      const grime = N2.fbm(u, v, 4, 3);
      const paint = 0.62 + (grime - 0.5) * 0.25;
      t.r = mix(paint, RUST[0] * 1.6, rust);
      t.g = mix(paint, RUST[1] * 1.6, rust);
      t.b = mix(paint, RUST[2] * 1.6, rust);
      t.h = ribH * 0.5 + 0.5 - rust * 0.06 + chip * 0.04;
      t.rough = mix(0.5, 0.78, rust) + (grime - 0.5) * 0.12;
      t.metal = mix(0.35, 0.7, rust);
      t.ao = 0.75 + 0.25 * (ribH * 0.5 + 0.5);
    },
    { w: size, h: size, normalStrength: 5, anisotropy: aniso },
  );
}

/** Painted steel plate with panel seams, rivets and worn edges (1 tile ≈ 2 m). */
export function plateSet(aniso: number, size = 512): TexSet {
  return bake(
    (u, v, px, py, t) => {
      const cell = 1 / 2; // two panels per tile
      const fu = (u % cell) / cell;
      const fv = (v % cell) / cell;
      const edge = Math.min(fu, fv, 1 - fu, 1 - fv);
      const seam = 1 - smooth(0.004, 0.012, edge);
      const ry = (((fv * 8) % 1) - 0.5) / 8;
      const rivetD = Math.min(Math.hypot(fu - 0.04, ry), Math.hypot(fu - 0.96, ry));
      const rivets = 1 - smooth(0.006, 0.011, rivetD);
      const wear = smooth(0.62, 0.75, N.fbm(u, v, 12, 4) + (1 - smooth(0, 0.06, edge)) * 0.35);
      const grime = N2.fbm(u, v, 6, 3);
      const base = 0.55 + (grime - 0.5) * 0.2;
      const bare = 0.68;
      t.r = mix(base, bare, wear) * (1 - seam * 0.6);
      t.g = mix(base, bare, wear) * (1 - seam * 0.6);
      t.b = mix(base, bare * 1.03, wear) * (1 - seam * 0.6);
      t.h = 0.5 - seam * 0.5 + rivets * 0.4 + N2.sample(px * 0.25, py * 0.25, 128) * 0.03;
      t.rough = mix(0.55, 0.32, wear) + (grime - 0.5) * 0.15;
      t.metal = mix(0.45, 0.95, wear);
      t.ao = 1 - seam * 0.5;
    },
    { w: size, h: size, normalStrength: 3, anisotropy: aniso },
  );
}

/** Welded bar grating for the catwalks; albedo alpha is carried by the ORM-free alpha map. */
export function gratingSet(aniso: number, size = 256): TexSet & { alpha: THREE.Texture } {
  const bars = 8; // bars per tile (1 tile ≈ 0.5 m)
  const set = bake(
    (u, v, _x, _y, t) => {
      const bu = (u * bars) % 1;
      const bv = (v * bars * 0.5) % 1;
      const barU = bu < 0.22 ? 1 : 0;
      const barV = bv < 0.12 ? 1 : 0;
      const solid = Math.max(barU, barV);
      const wear = N.fbm(u, v, 8, 3);
      t.r = t.g = t.b = 0.35 + wear * 0.2;
      t.h = solid * (barU ? 1 - Math.abs(bu - 0.11) * 4 : 1);
      t.rough = 0.45 + wear * 0.2;
      t.metal = 0.85;
      t.ao = solid ? 1 : 0.4;
    },
    { w: size, h: size, normalStrength: 4, anisotropy: aniso },
  );
  const a = canvas(size, size);
  const img = a.g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const solid = (u * bars) % 1 < 0.22 || (v * bars * 0.5) % 1 < 0.12;
      const i = (y * size + x) * 4;
      const c = solid ? 255 : 0;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = c;
      img.data[i + 3] = 255;
    }
  }
  a.g.putImageData(img, 0, 0);
  return { ...set, alpha: toTexture(a.c, false, aniso) };
}

/** Worn diagonal hazard stripes in the warning livery (1 tile ≈ 1 m). */
export function liverySet(aniso: number, size = 256): TexSet {
  return bake(
    (u, v, _x, _y, t) => {
      const stripe = ((u + v) * 4) % 1 < 0.5;
      const wear = smooth(0.6, 0.72, N.fbm(u, v, 8, 4));
      const dark = [0.06, 0.06, 0.07];
      const paint = stripe ? LIVERY : dark;
      const bare = [0.3, 0.29, 0.28];
      t.r = mix(paint[0]!, bare[0]!, wear);
      t.g = mix(paint[1]!, bare[1]!, wear);
      t.b = mix(paint[2]!, bare[2]!, wear);
      t.h = 0.5 + (stripe ? 0.05 : 0) - wear * 0.1;
      t.rough = mix(0.5, 0.35, wear);
      t.metal = mix(0.2, 0.9, wear);
    },
    { w: size, h: size, normalStrength: 2, anisotropy: aniso },
  );
}

/** Slatted crate boards with steel corner straps (1 tile = 1 crate face). */
export function crateSet(aniso: number, size = 256): TexSet {
  return bake(
    (u, v, _x, _y, t) => {
      const slat = (v * 5) % 1;
      const gap = slat < 0.05 ? 1 : 0;
      const grain = N.fbm(u * 0.2, v * 5, 16, 4);
      const frame = u < 0.08 || u > 0.92 || v < 0.08 || v > 0.92 ? 1 : 0;
      const k = 0.55 + grain * 0.5;
      t.r = frame ? 0.22 : RUST[0] * k * 2.1;
      t.g = frame ? 0.22 : RUST[1] * k * 2.1;
      t.b = frame ? 0.23 : RUST[2] * k * 2.1;
      t.h = gap ? 0 : frame ? 0.9 : 0.6 + grain * 0.1;
      t.rough = frame ? 0.4 : 0.75;
      t.metal = frame ? 0.8 : 0;
      t.ao = gap ? 0.4 : 1;
    },
    { w: size, h: size, normalStrength: 3, anisotropy: aniso },
  );
}

/** Brushed brass with faint tarnish. */
export function brassSet(aniso: number, size = 256): TexSet {
  return bake(
    (u, v, _x, _y, t) => {
      const brush = N.fbm(u * 0.05, v, 128, 2);
      const tarnish = smooth(0.55, 0.8, N2.fbm(u, v, 4, 3));
      t.r = mix(0.95, 0.5, tarnish);
      t.g = mix(0.9, 0.52, tarnish);
      t.b = mix(0.85, 0.5, tarnish);
      t.h = brush * 0.3;
      t.rough = 0.28 + brush * 0.1 + tarnish * 0.25;
      t.metal = 1;
    },
    { w: size, h: size, normalStrength: 1.2, anisotropy: aniso },
  );
}

/** Fine speckle for rubber, ceramic and nitride so nothing reads as flat plastic. */
export function microSet(aniso: number, size = 256): TexSet {
  return bake(
    (u, v, _x, _y, t) => {
      const n = N.fbm(u, v, 32, 3);
      const scuff = smooth(0.62, 0.8, N2.fbm(u, v, 6, 3));
      t.r = t.g = t.b = 0.85 + n * 0.15 + scuff * 0.2;
      t.h = n;
      t.rough = 0.5 + (n - 0.5) * 0.3 - scuff * 0.2;
      t.metal = 0;
    },
    { w: size, h: size, normalStrength: 1.5, anisotropy: aniso },
  );
}

// ---------- the unique quay floor ----------

export interface FloorLayout {
  halfX: number;
  halfZ: number;
  /** World-space puddle centres and radii (also used for darker footstep splashes). */
  puddles: { x: number; z: number; r: number }[];
}

/** Deterministic puddle list so gameplay VFX can match the painted floor. */
export function floorPuddles(): FloorLayout["puddles"] {
  const rnd = mulberry32(77);
  const out: FloorLayout["puddles"] = [];
  // Hand-placed anchors near light pools, then a few seeded ones.
  const anchors = [
    { x: -3.2, z: 2.2, r: 1.6 },
    { x: 9.5, z: -1.6, r: 1.2 },
    { x: -14, z: -2.8, r: 1.4 },
    { x: 18.5, z: 5.2, r: 1.1 },
    { x: -8, z: 13.2, r: 1.3 },
    { x: 5, z: -12.8, r: 1.5 },
  ];
  out.push(...anchors, ...anchors.map((p) => ({ x: -p.x * 0.8 + 1.1, z: -p.z * 0.9 - 0.7, r: p.r * 0.8 })));
  for (let i = 0; i < 6; i++) out.push({ x: (rnd() - 0.5) * 44, z: (rnd() - 0.5) * 28, r: 0.5 + rnd() * 0.7 });
  return out;
}

/**
 * One unique floor texture across the whole quay: 4 m poured plates, tar seams, puddles
 * that catch sodium light, worn lane edges, ghosted bay numbers and hazard chevrons.
 */
export function floorSet(layout: FloorLayout, aniso: number, pxPerMetre: number): TexSet {
  const W = Math.round(layout.halfX * 2 * pxPerMetre);
  const H = Math.round(layout.halfZ * 2 * pxPerMetre);
  const plate = 4;
  const puddles = layout.puddles;
  const worldOf = (px: number, py: number): [number, number] => [px / pxPerMetre - layout.halfX, py / pxPerMetre - layout.halfZ];
  return bake(
    (u, v, px, py, t) => {
      const [x, z] = worldOf(px, py);
      // Plate seams on a 4 m grid, slightly jittered so it reads poured, not tiled.
      const jx = (N2.sample(z * 0.7, 3.3, 256) - 0.5) * 0.06;
      const jz = (N2.sample(x * 0.7, 7.1, 256) - 0.5) * 0.06;
      const sx = Math.abs(((x + jx + 1000) % plate) - plate / 2) - plate / 2;
      const sz = Math.abs(((z + jz + 1000) % plate) - plate / 2) - plate / 2;
      const seamD = Math.min(-sx, -sz);
      const seam = 1 - smooth(0.02, 0.05, seamD);
      // Large-scale colour drift per plate plus fine aggregate.
      const plateId = Math.floor((x + 1000) / plate) * 31 + Math.floor((z + 1000) / plate) * 17;
      const plateTone = (Math.sin(plateId * 12.9898) * 43758.5453) % 1;
      const big = N.fbm(u, v, 6, 4);
      const agg = N2.fbm(u, v, 180, 2);
      const stain = smooth(0.58, 0.78, N.fbm(u + 0.37, v + 0.11, 10, 4));
      // Puddles: distance field blobs distorted by noise.
      let wet = 0;
      for (const p of puddles) {
        const d = Math.hypot(x - p.x, z - p.z) / p.r + (N.sample(x * 1.3, z * 1.3, 256) - 0.5) * 0.9;
        wet = Math.max(wet, 1 - smooth(0.7, 1.0, d));
      }
      wet = Math.max(wet, seam * 0.6);
      const damp = smooth(0.45, 0.7, big) * 0.5;
      const k = 1.1 + (Math.abs(plateTone) - 0.5) * 0.12 + (big - 0.5) * 0.35 + (agg - 0.5) * 0.18 - stain * 0.35;
      const darken = 1 - wet * 0.45 - damp * 0.15;
      t.r = CONCRETE[0] * k * darken * (1 - seam * 0.7);
      t.g = CONCRETE[1] * k * darken * (1 - seam * 0.7);
      t.b = CONCRETE[2] * k * darken * (1 - seam * 0.7) * 1.02;
      t.h = 0.6 + agg * 0.12 + big * 0.1 - seam * 0.5 - wet * 0.12;
      if (wet > 0.5) t.h = mix(t.h, 0.48, (wet - 0.5) * 2); // standing water is flat
      t.rough = Math.max(0.04, mix(0.52 - damp * 0.12 + (agg - 0.5) * 0.1, 0.05, wet));
      t.metal = 0;
      t.ao = 1 - seam * 0.4;
    },
    {
      w: W,
      h: H,
      normalStrength: 1.6,
      anisotropy: aniso,
      wrap: false,
      paint: (g, w, h) => paintFloorMarkings(g, w, h, layout, pxPerMetre),
    },
  );
}

function paintFloorMarkings(g: CanvasRenderingContext2D, _w: number, _h: number, layout: FloorLayout, ppm: number): void {
  const X = (x: number): number => (x + layout.halfX) * ppm;
  const Z = (z: number): number => (z + layout.halfZ) * ppm;
  g.save();
  // Worn paint: draw, then erase with noise speckle.
  const livery = hex(PALETTE.livery);
  g.globalAlpha = 0.55;
  g.fillStyle = livery;
  // Kill-lane edge lines along X at |z| = 4.
  for (const z of [-4, 4]) g.fillRect(X(-22), Z(z) - 0.06 * ppm, 44 * ppm, 0.12 * ppm);
  // Dashed centre line.
  g.globalAlpha = 0.25;
  g.fillStyle = "#c9c2b4";
  for (let x = -21; x < 21; x += 3) if (Math.abs(x) > 2.5) g.fillRect(X(x), Z(0) - 0.05 * ppm, 1.6 * ppm, 0.1 * ppm);
  // Ghosted bay numbers, stencil type, facing the lane.
  g.globalAlpha = 0.16;
  g.font = `700 ${Math.round(1.4 * ppm)}px "Arial Narrow", "Helvetica Neue", Arial, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const bays: [string, number, number, number][] = [
    ["09", -16, 2, 0],
    ["09", 16, -2, Math.PI],
    ["L2", -6, -2.2, Math.PI],
    ["L3", 6, 2.2, 0],
    ["07", -19, -10, Math.PI / 2],
    ["11", 19, 10, -Math.PI / 2],
  ];
  for (const [label, x, z, rot] of bays) {
    g.save();
    g.translate(X(x), Z(z));
    g.rotate(rot);
    g.fillText(label, 0, 0);
    g.restore();
  }
  // Hazard chevrons at stair feet and around the pedestal ring.
  g.globalAlpha = 0.35;
  g.fillStyle = livery;
  const chevron = (x: number, z: number, rot: number): void => {
    g.save();
    g.translate(X(x), Z(z));
    g.rotate(rot);
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      const o = i * 0.35 * ppm;
      g.moveTo(-0.5 * ppm + o, -0.4 * ppm);
      g.lineTo(-0.3 * ppm + o, -0.4 * ppm);
      g.lineTo(0 * ppm + o, 0);
      g.lineTo(-0.3 * ppm + o, 0.4 * ppm);
      g.lineTo(-0.5 * ppm + o, 0.4 * ppm);
      g.lineTo(-0.2 * ppm + o, 0);
      g.closePath();
      g.fill();
    }
    g.restore();
  };
  chevron(-22.6, 4.3, 0);
  chevron(22.6, -4.3, Math.PI);
  chevron(6.2, 11.5, 0);
  chevron(-6.2, -11.5, Math.PI);
  // Pedestal service ring.
  g.globalAlpha = 0.28;
  g.strokeStyle = livery;
  g.lineWidth = 0.1 * ppm;
  g.setLineDash([0.4 * ppm, 0.3 * ppm]);
  g.beginPath();
  g.arc(X(0), Z(0), 2.2 * ppm, 0, Math.PI * 2);
  g.stroke();
  g.restore();
  // Erase paint with speckle so it reads worn to ghosts.
  const img = g.getImageData(0, 0, g.canvas.width, g.canvas.height);
  const d = img.data;
  const base = new Noise(311);
  for (let y = 0; y < g.canvas.height; y += 1) {
    for (let x = 0; x < g.canvas.width; x += 1) {
      const n = base.sample(x * 0.18, y * 0.18, 256);
      if (n > 0.62) {
        const i = (y * g.canvas.width + x) * 4;
        const k = 0.9;
        d[i] = d[i]! * k;
        d[i + 1] = d[i + 1]! * k;
        d[i + 2] = d[i + 2]! * k;
      }
    }
  }
  g.putImageData(img, 0, 0);
}

// ---------- small sprite textures ----------

/** Soft radial sprite (for glows, blob shadows, dust). */
export function radialTexture(size = 64, inner = "rgba(255,255,255,1)", outer = "rgba(255,255,255,0)", falloff = 1): THREE.CanvasTexture {
  const { c, g } = canvas(size, size);
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(Math.min(0.99, 0.35 * falloff), inner.replace(/[\d.]+\)$/, "0.5)"));
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Four-point muzzle star. */
export function starTexture(size = 128): THREE.CanvasTexture {
  const { c, g } = canvas(size, size);
  const m = size / 2;
  const glow = g.createRadialGradient(m, m, 0, m, m, m);
  glow.addColorStop(0, "rgba(255,255,255,1)");
  glow.addColorStop(0.2, "rgba(255,220,160,0.8)");
  glow.addColorStop(1, "rgba(255,160,60,0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = "lighter";
  g.fillStyle = "rgba(255,240,210,0.9)";
  for (const r of [0, Math.PI / 2]) {
    g.save();
    g.translate(m, m);
    g.rotate(r + 0.3);
    g.beginPath();
    g.moveTo(-m, 0);
    g.lineTo(0, -size * 0.04);
    g.lineTo(m, 0);
    g.lineTo(0, size * 0.04);
    g.closePath();
    g.fill();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Scorch mark: charred ring with a bright pit, alpha in the texture. */
export function scorchTexture(size = 64): THREE.CanvasTexture {
  const { c, g } = canvas(size, size);
  const m = size / 2;
  const grad = g.createRadialGradient(m, m, 0, m, m, m);
  grad.addColorStop(0, "rgba(0,0,0,0.95)");
  grad.addColorStop(0.25, "rgba(10,8,6,0.85)");
  grad.addColorStop(0.6, "rgba(20,16,12,0.35)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
