import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { StaticBatch, type PieceOptions } from "./batch.js";
import type { MaterialLibrary } from "./materials.js";
import { PALETTE } from "./palette.js";

/**
 * Original weapon kitbashes and the Auric pedestal, sharing one material language:
 * dark nitride + polymer for the Kestrel Sidearm, brass + black ceramic + a molten core
 * for the Auric Lance and its pedestal. Built from bevelled primitives; the same
 * builders feed the viewmodel (separate materials) and the avatar worldmodel (merged).
 */

export type GunKey = "slide" | "frame" | "steel" | "led";
export type LanceKey = "brass" | "ceramic" | "core";

type Add<K extends string> = (key: K | null, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, o?: PieceOptions & { bevel?: number; rotX?: number }) => void;

function adder<K extends string>(B: StaticBatch<K>, base: THREE.Matrix4): Add<K> {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  return (key, cx, cy, cz, sx, sy, sz, o = {}) => {
    if (key === null) return;
    const g = o.bevel ? new RoundedBoxGeometry(sx, sy, sz, 1, o.bevel) : new THREE.BoxGeometry(sx, sy, sz);
    m.compose(new THREE.Vector3(cx, cy, cz), q.setFromEuler(e.set(o.rotX ?? 0, 0, 0)), new THREE.Vector3(1, 1, 1)).premultiply(base);
    B.add(key, g, m, { uv: "keep", ...o });
    g.dispose();
  };
}

/** Kestrel Sidearm, origin at the web of the hand, muzzle toward -Z. Real size (~19 cm). */
export function addKestrel<K extends string>(B: StaticBatch<K>, base: THREE.Matrix4, keys: Record<GunKey, K | null>, withMag = true): void {
  const add = adder(B, base);
  // Slide with a chamfered nose, rear serrations and an ejection port.
  add(keys.slide, 0, 0.031, -0.062, 0.028, 0.032, 0.186, { bevel: 0.006 });
  for (let i = 0; i < 6; i++) add(keys.slide, 0, 0.031, 0.012 + i * -0.007, 0.03, 0.026, 0.0025, {});
  add(keys.slide, 0.0141, 0.036, -0.052, 0.002, 0.012, 0.032, {});
  // Frame, dust-cover rail, trigger guard, trigger.
  add(keys.frame, 0, 0.004, -0.05, 0.026, 0.026, 0.16, { bevel: 0.005 });
  add(keys.frame, 0, -0.014, -0.112, 0.02, 0.01, 0.05, {});
  add(keys.frame, 0, -0.033, -0.05, 0.02, 0.006, 0.058, {});
  add(keys.frame, 0, -0.02, -0.079, 0.02, 0.03, 0.006, {});
  add(keys.steel, 0, -0.014, -0.043, 0.005, 0.022, 0.006, { rotX: 0.3 });
  // Raked grip with texture panels.
  add(keys.frame, 0, -0.058, 0.014, 0.03, 0.11, 0.048, { bevel: 0.008, rotX: -0.28 });
  add(keys.frame, 0, -0.052, 0.036, 0.033, 0.07, 0.006, { rotX: -0.28 });
  if (withMag) add(keys.steel, 0, -0.114, 0.03, 0.032, 0.01, 0.052, { rotX: -0.28 });
  // Barrel crown, sights, cyan status LED on both flanks.
  add(keys.steel, 0, 0.034, -0.157, 0.012, 0.012, 0.006, {});
  add(keys.slide, 0, 0.05, 0.022, 0.022, 0.008, 0.008, {});
  add(keys.slide, 0, 0.05, -0.14, 0.004, 0.008, 0.006, {});
  add(keys.led, 0, 0.055, -0.14, 0.0035, 0.003, 0.0035, {});
  for (const s of [-1, 1]) add(keys.led, s * 0.0132, 0.008, -0.105, 0.0015, 0.004, 0.018, {});
}

/** Magazine as its own piece so the viewmodel can drop and seat it. */
export function addKestrelMag<K extends string>(B: StaticBatch<K>, base: THREE.Matrix4, keys: Record<GunKey, K>): void {
  const add = adder(B, base);
  add(keys.steel, 0, -0.07, 0.018, 0.022, 0.1, 0.034, { rotX: -0.28 });
  add(keys.steel, 0, -0.114, 0.03, 0.032, 0.01, 0.052, { rotX: -0.28 });
}

function bladeGeometry(): THREE.ExtrudeGeometry {
  // Blade profile in the (z, y) plane: thick at the throat, tapering to a sharp tine.
  const s = new THREE.Shape();
  s.moveTo(0, -0.03);
  s.lineTo(0, 0.04);
  s.lineTo(-0.2, 0.034);
  s.lineTo(-0.52, 0.016);
  s.lineTo(-0.64, 0.004);
  s.lineTo(-0.6, -0.008);
  s.lineTo(-0.3, -0.02);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.011, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1 });
  // Shape x → world -z: rotate so the profile's x axis runs along z.
  g.rotateY(Math.PI / 2);
  g.translate(-0.0055, 0, 0);
  return g;
}

/** Auric Lance: split-blade emitter ~1 m long, origin at the rear grip, muzzle toward -Z. */
export function addLance<K extends string>(B: StaticBatch<K>, base: THREE.Matrix4, keys: Record<LanceKey, K>): void {
  const add = adder(B, base);
  // Black ceramic receiver, brass bands, stock cap.
  add(keys.ceramic, 0, 0.02, -0.1, 0.07, 0.09, 0.34, { bevel: 0.02 });
  for (const z of [-0.02, -0.16, -0.25]) add(keys.brass, 0, 0.02, z, 0.074, 0.094, 0.014, { bevel: 0.004 });
  add(keys.brass, 0, 0.02, 0.075, 0.06, 0.08, 0.02, { bevel: 0.008 });
  add(keys.ceramic, 0, -0.07, 0.0, 0.034, 0.12, 0.05, { bevel: 0.01, rotX: -0.3 });
  add(keys.ceramic, 0, -0.045, -0.36, 0.03, 0.08, 0.04, { bevel: 0.01, rotX: 0.2 });
  // Molten seams along the receiver flanks.
  for (const sx of [-1, 1]) add(keys.core, sx * 0.0355, 0.03, -0.1, 0.002, 0.006, 0.26, {});
  // Emitter throat.
  add(keys.brass, 0, 0.02, -0.29, 0.09, 0.1, 0.06, { bevel: 0.012 });
  // Split blades with a gap for the core.
  const blade = bladeGeometry();
  const m = new THREE.Matrix4();
  for (const sx of [-1, 1]) {
    m.makeRotationY(sx * 0.018).setPosition(sx * 0.021, 0.02, -0.31).premultiply(base);
    B.add(keys.brass, blade, m, { uv: "keep" });
  }
  blade.dispose();
  // Molten core running between the blades.
  const core = new THREE.CylinderGeometry(0.006, 0.009, 0.52, 8);
  core.rotateX(Math.PI / 2);
  m.makeTranslation(0, 0.022, -0.58).premultiply(base);
  B.add(keys.core, core, m, { uv: "keep" });
  core.dispose();
}

export interface PedestalModel {
  group: THREE.Group;
  /** 0 = taken / cooling down (dim), 1 = Lance available (beam and ring glow). */
  setAvailable(on: number, time: number): void;
  pulse(time: number): void;
}

/** Low stone dais with brass inlay and a molten ring; a thin godray while the Lance is up. */
export function buildPedestal(lib: MaterialLibrary, at: THREE.Vector3): PedestalModel {
  const group = new THREE.Group();
  group.position.copy(at);
  const B = new StaticBatch<"stone" | "brass" | "core">();
  B.cyl("stone", 0, 0.08, 0, 0.95, 1.02, 0.16, { seg: 8, tint: 0x6e6c6a, uv: "world" });
  B.cyl("stone", 0, 0.22, 0, 0.42, 0.52, 0.16, { seg: 8, tint: 0x5a5856, uv: "world" });
  B.torus("brass", 0, 0.16, 0, 0.9, 0.018, { rotX: Math.PI / 2, seg: 8 });
  B.torus("brass", 0, 0.3, 0, 0.44, 0.02, { rotX: Math.PI / 2, seg: 24 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    B.box("brass", Math.cos(a) * 0.72, 0.162, Math.sin(a) * 0.72, 0.28, 0.01, 0.03, { rotY: -a, uv: "keep" });
  }
  B.torus("core", 0, 0.305, 0, 0.3, 0.012, { rotX: Math.PI / 2, seg: 32 });
  const coreMat = lib.lanceCore.clone();
  const meshes = B.build(
    { stone: lib.concrete, brass: lib.brass, core: coreMat },
    (k) => ({ cast: false, receive: k !== "core" }),
  );
  for (const m of meshes) group.add(m);

  // Godray: open cone, additive, fading upward, slow scrolling breakup.
  const beamUniforms = { uOn: { value: 1 }, uTime: { value: 0 }, uColor: { value: new THREE.Color(PALETTE.lanceCore) } };
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.75, 0.32, 9, 24, 1, true),
    new THREE.ShaderMaterial({
      uniforms: beamUniforms,
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vN; varying vec3 vView;
        void main() {
          vUv = uv;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix) * normal);
          vView = normalize(cameraPosition - w.xyz);
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uOn; uniform float uTime; uniform vec3 uColor;
        varying vec2 vUv; varying vec3 vN; varying vec3 vView;
        void main() {
          float facing = abs(dot(normalize(vN), vView));
          float soft = pow(facing, 1.6);
          float fade = pow(1.0 - vUv.y, 2.2);
          float streak = 0.7 + 0.3 * sin(vUv.x * 40.0 + uTime * 1.3) * sin(vUv.y * 9.0 - uTime * 2.0);
          float a = soft * fade * streak * uOn * 0.42;
          gl_FragColor = vec4(uColor * a * 2.2, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
  );
  beam.position.y = 4.8;
  beam.renderOrder = 3;
  group.add(beam);

  // Availability pulse: a ring racing out across the floor.
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.lanceCore).multiplyScalar(3), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.05, 48), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  group.add(ring);
  let pulseAt = -10;
  let level = 1;

  return {
    group,
    setAvailable(on: number, time: number) {
      level += (on - level) * 0.08;
      beamUniforms.uOn.value = level;
      beamUniforms.uTime.value = time;
      beam.visible = level > 0.02;
      coreMat.emissiveIntensity = 0.4 + level * (4.5 + Math.sin(time * 3) * 0.8);
      const t = time - pulseAt;
      if (t >= 0 && t < 1.2) {
        const k = t / 1.2;
        ring.scale.setScalar(1 + k * 7);
        ringMat.opacity = (1 - k) * 0.9;
      } else ringMat.opacity = 0;
    },
    pulse(time: number) {
      pulseAt = time;
    },
  };
}
