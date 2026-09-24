import * as THREE from "three";
import { PALETTE } from "./palette.js";

/**
 * The light rig. Fixed count (13 punctual + moon + hemisphere) so programs never recompile:
 * dynamic lights (muzzle, Lance flash) exist from the start and only change intensity.
 * Fixture positions are exported so the level can hang lamp models exactly where the light is.
 */

export interface SpotFixture {
  pos: THREE.Vector3Tuple;
  target: THREE.Vector3Tuple;
  color: number;
  intensity: number;
  angle: number;
  distance: number;
  /** Which lamp model to hang at this spot. */
  model: "shedLamp" | "polePlain" | "flood";
}

/** Sodium work lamps under the shed roof (north) and over the Hoist Cab / Signal Booth. */
export const SPOTS: SpotFixture[] = [
  { pos: [-16, 8.9, 12.2], target: [-15, 0, 6], color: PALETTE.sodium, intensity: 1050, angle: 0.95, distance: 26, model: "shedLamp" },
  { pos: [-3, 8.9, 12.6], target: [-2, 0, 5], color: PALETTE.sodium, intensity: 1050, angle: 0.95, distance: 26, model: "shedLamp" },
  { pos: [9, 8.9, 12.2], target: [9, 0, 4], color: PALETTE.sodium, intensity: 950, angle: 0.95, distance: 26, model: "shedLamp" },
  { pos: [-18, 10.5, -16.5], target: [-17, 5, -11], color: PALETTE.sodium, intensity: 750, angle: 0.8, distance: 22, model: "polePlain" },
  // Cyan floods on the dock-edge poles, raking across the quay and out over the water.
  { pos: [-4, 11, -16.5], target: [2, 0, -3], color: PALETTE.cyan, intensity: 1300, angle: 0.62, distance: 34, model: "flood" },
  { pos: [12, 11, -16.5], target: [8, 0, -22], color: PALETTE.cyan, intensity: 1050, angle: 0.7, distance: 32, model: "flood" },
  // Cold flood from the east container wall straight down the kill lane: the lane reads exposed.
  { pos: [24.2, 9.5, 0], target: [-6, 0, 0], color: PALETTE.cyan, intensity: 1500, angle: 0.36, distance: 50, model: "flood" },
  { pos: [18, 10.5, 16.2], target: [18, 6, 10], color: PALETTE.sodium, intensity: 550, angle: 0.8, distance: 16, model: "polePlain" },
];

/** Caged bulbs hanging in the shed: specular anchors. */
export const BULBS: THREE.Vector3Tuple[] = [
  [-10, 7.4, 13.8],
  [3, 7.4, 13.8],
];

export interface LightRig {
  moon: THREE.DirectionalLight;
  pedestal: THREE.PointLight;
  muzzle: THREE.PointLight;
  flash: THREE.PointLight;
  all: THREE.Light[];
}

function allLayers<T extends THREE.Object3D>(o: T): T {
  o.layers.enableAll();
  return o;
}

export function buildLightRig(scene: THREE.Scene, shadowMapSize: number): LightRig {
  const all: THREE.Light[] = [];
  const hemi = allLayers(new THREE.HemisphereLight(0x2a3a52, 0x0c0b0a, 1.1));
  scene.add(hemi);
  all.push(hemi);

  // Cool moon key: low elevation from the north-west, long soft shadows across the quay.
  const moon = allLayers(new THREE.DirectionalLight(PALETTE.moon, 2.2));
  moon.position.set(-26, 17, 30);
  moon.target.position.set(0, 0, 0);
  moon.castShadow = true;
  moon.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  const cam = moon.shadow.camera;
  cam.left = -34;
  cam.right = 34;
  cam.top = 26;
  cam.bottom = -26;
  cam.near = 5;
  cam.far = 90;
  moon.shadow.bias = -0.0004;
  moon.shadow.normalBias = 0.03;
  moon.shadow.radius = 3;
  // Level shadows are static: render the map once, players use contact blobs.
  moon.shadow.autoUpdate = false;
  moon.shadow.needsUpdate = true;
  scene.add(moon, moon.target);
  all.push(moon);

  for (const s of SPOTS) {
    const l = allLayers(new THREE.SpotLight(s.color, s.intensity, s.distance, s.angle, 0.65, 2));
    l.position.set(...s.pos);
    l.target.position.set(...s.target);
    scene.add(l, l.target);
    all.push(l);
  }
  for (const b of BULBS) {
    const l = allLayers(new THREE.PointLight(PALETTE.sodium, 90, 9, 2));
    l.position.set(...b);
    scene.add(l);
    all.push(l);
  }
  const pedestal = allLayers(new THREE.PointLight(PALETTE.lanceCore, 0, 9, 2));
  const muzzle = allLayers(new THREE.PointLight(0xffc27a, 0, 7, 2));
  const flash = allLayers(new THREE.PointLight(PALETTE.lanceRim, 0, 18, 2));
  scene.add(pedestal, muzzle, flash);
  all.push(pedestal, muzzle, flash);
  return { moon, pedestal, muzzle, flash, all };
}

export function setShadowMapSize(moon: THREE.DirectionalLight, size: number): void {
  if (moon.shadow.mapSize.x === size) return;
  moon.shadow.mapSize.set(size, size);
  moon.shadow.map?.dispose();
  moon.shadow.map = null;
  moon.shadow.needsUpdate = true;
}
