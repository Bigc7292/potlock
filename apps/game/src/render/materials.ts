import * as THREE from "three";
import { PALETTE } from "./palette.js";
import type { QualityLevel } from "./quality.js";
import {
  brassSet,
  concreteSet,
  corrugatedSet,
  crateSet,
  floorPuddles,
  floorSet,
  gratingSet,
  liverySet,
  microSet,
  plateSet,
  type FloorLayout,
  type TexSet,
} from "./textures.js";

/**
 * The shared material library: a handful of PBR sets reused everywhere
 * (wet concrete, painted steel, corrugated/rust, livery, rubber, glass, brass).
 * Level geometry uses world-space UVs in metres, so `repeat` = 1 / tile size.
 */
export interface MaterialLibrary {
  floor: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;
  corrugated: THREE.MeshStandardMaterial;
  plate: THREE.MeshStandardMaterial;
  grating: THREE.MeshStandardMaterial;
  livery: THREE.MeshStandardMaterial;
  crate: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  nitride: THREE.MeshStandardMaterial;
  ceramic: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  sodiumGlow: THREE.MeshStandardMaterial;
  cyanGlow: THREE.MeshStandardMaterial;
  beacon: THREE.MeshStandardMaterial;
  lanceCore: THREE.MeshStandardMaterial;
  floorLayout: FloorLayout;
  micro: TexSet;
}

function repeatSet(set: TexSet, r: number): TexSet {
  for (const t of [set.map, set.normal, set.orm]) t.repeat.set(r, r);
  return set;
}

function pbr(set: TexSet, params: THREE.MeshStandardMaterialParameters & { normalStrength?: number; scalarPbr?: boolean }): THREE.MeshStandardMaterial {
  const { normalStrength, scalarPbr, ...rest } = params;
  const m = new THREE.MeshStandardMaterial({
    map: set.map,
    normalMap: set.normal,
    roughnessMap: set.orm,
    metalnessMap: set.orm,
    aoMap: set.orm,
    aoMapIntensity: 0.8,
    roughness: 1,
    metalness: 1,
    ...rest,
  });
  if (normalStrength !== undefined) m.normalScale.setScalar(normalStrength);
  if (scalarPbr) {
    // Detail-only sets: keep the normal and albedo speckle, take roughness/metalness from params.
    m.roughnessMap = null;
    m.metalnessMap = null;
    m.aoMap = null;
  }
  return m;
}

function glow(color: number, intensity: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: intensity, roughness: 0.4, metalness: 0 });
}

export function buildMaterials(quality: QualityLevel, halfX: number, halfZ: number): MaterialLibrary {
  const aniso = quality === "low" ? 2 : 8;
  const floorLayout: FloorLayout = { halfX, halfZ, puddles: floorPuddles() };
  const floor = floorSet(floorLayout, aniso, quality === "low" ? 20 : 32);
  const concrete = repeatSet(concreteSet(aniso), 1 / 4);
  const corrugated = repeatSet(corrugatedSet(aniso), 1 / 2);
  const plate = repeatSet(plateSet(aniso), 1 / 2);
  const grating = gratingSet(aniso);
  for (const t of [grating.map, grating.normal, grating.orm, grating.alpha]) t.repeat.set(2, 2);
  const livery = repeatSet(liverySet(aniso), 1);
  const crate = crateSet(aniso);
  const brass = repeatSet(brassSet(aniso), 2);
  const micro = repeatSet(microSet(aniso), 3);

  return {
    floorLayout,
    micro,
    floor: pbr(floor, { envMapIntensity: 1.0, normalStrength: 0.7 }),
    concrete: pbr(concrete, { vertexColors: true, envMapIntensity: 0.6 }),
    corrugated: pbr(corrugated, { vertexColors: true, envMapIntensity: 0.8 }),
    plate: pbr(plate, { vertexColors: true, envMapIntensity: 0.9 }),
    grating: pbr(grating, {
      vertexColors: true,
      alphaMap: grating.alpha,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      envMapIntensity: 0.9,
    }),
    livery: pbr(livery, { vertexColors: true, envMapIntensity: 0.7 }),
    crate: pbr(crate, { vertexColors: true, envMapIntensity: 0.4 }),
    brass: pbr(brass, { color: PALETTE.brass, envMapIntensity: 1.3 }),
    rubber: pbr(micro, { scalarPbr: true, color: PALETTE.rubber, metalness: 0, roughness: 0.95, vertexColors: true, envMapIntensity: 0.3 }),
    nitride: pbr(micro, { scalarPbr: true, color: PALETTE.nitride, metalness: 0.75, roughness: 0.55, envMapIntensity: 1.2 }),
    ceramic: pbr(micro, { scalarPbr: true, color: PALETTE.ceramic, metalness: 0, roughness: 0.28, envMapIntensity: 1.1 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x0b1418, roughness: 0.08, metalness: 0.2, envMapIntensity: 1.6, transparent: true, opacity: 0.55 }),
    sodiumGlow: glow(PALETTE.sodium, 6),
    cyanGlow: glow(PALETTE.cyan, 5),
    beacon: glow(PALETTE.beacon, 10),
    lanceCore: glow(PALETTE.lanceCore, 5),
  };
}
