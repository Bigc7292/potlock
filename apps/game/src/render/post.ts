import * as THREE from "three";
import {
  BlendFunction,
  BloomEffect,
  ChromaticAberrationEffect,
  Effect,
  EffectComposer,
  EffectPass,
  NormalPass,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  SSAOEffect,
} from "postprocessing";
import type { QualitySettings } from "./quality.js";

/**
 * One composer, few passes:
 *   world render → [SSAO, high only] → viewmodel render (depth cleared) →
 *   [chromatic fringe + bloom + grade] → [SMAA, mid/high].
 * The grade effect owns tone mapping (ACES filmic), exposure, crushed blacks with warm
 * highlights, vignette and 1.5% grain, so no extra full-screen passes are stacked.
 */

const GRADE_FRAG = /* glsl */ `
uniform float exposure;
uniform float grain;
uniform float vignette;
uniform vec3 shadowTint;
uniform vec3 highlightTint;
uniform float punch;

vec3 gradeRRT(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 gradeACES(vec3 color) {
  const mat3 inM = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 outM = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  color = inM * (color / 0.6);
  color = gradeRRT(color);
  return clamp(outM * color, 0.0, 1.0);
}
float gradeHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = gradeACES(inputColor.rgb * exposure);
  // Crush the blacks a touch, then split-tone: cool shadows, warm highlights.
  c = max(vec3(0.0), c - 0.008) / 0.992;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c *= mix(shadowTint, vec3(1.0), smoothstep(0.0, 0.18, l));
  c = mix(c, c * highlightTint, smoothstep(0.3, 0.9, l) * 0.7);
  // Mild vignette, tightened briefly on hit punch.
  vec2 d = uv - 0.5;
  float v = 1.0 - dot(d, d) * (vignette + punch * 1.4);
  c *= clamp(v, 0.0, 1.0);
  // Film grain, luminance-weighted so blacks stay clean.
  float n = gradeHash(uv * resolution + fract(time * 13.7) * 91.0) - 0.5;
  c += n * grain * (0.35 + l);
  outputColor = vec4(c, inputColor.a);
}`;

export class GradeEffect extends Effect {
  constructor() {
    super("GradeEffect", GRADE_FRAG, {
      blendFunction: BlendFunction.SET,
      uniforms: new Map<string, THREE.Uniform>([
        ["exposure", new THREE.Uniform(1.08)],
        ["grain", new THREE.Uniform(0.015)],
        ["vignette", new THREE.Uniform(0.55)],
        ["shadowTint", new THREE.Uniform(new THREE.Vector3(0.92, 0.97, 1.05))],
        ["highlightTint", new THREE.Uniform(new THREE.Vector3(1.06, 1.0, 0.9))],
        ["punch", new THREE.Uniform(0)],
      ]),
    });
  }

  set punch(v: number) {
    const u = this.uniforms.get("punch");
    if (u) u.value = v;
  }
}

export class PostStack {
  readonly composer: EffectComposer;
  readonly grade = new GradeEffect();
  readonly fringe: ChromaticAberrationEffect;
  private readonly bloom: BloomEffect | null;
  private fringeUntil = 0;
  private fringeStart = 0;
  private fringeStrength = 0;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    viewCamera: THREE.PerspectiveCamera,
    q: QualitySettings,
  ) {
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.composer.addPass(new RenderPass(scene, camera));
    if (q.ssao) {
      const normals = new NormalPass(scene, camera);
      this.composer.addPass(normals);
      const ssao = new SSAOEffect(camera, normals.texture, {
        samples: 9,
        rings: 7,
        radius: 0.06,
        intensity: 1.6,
        bias: 0.03,
        fade: 0.02,
        luminanceInfluence: 0.6,
        resolutionScale: 0.5,
        worldDistanceThreshold: 30,
        worldDistanceFalloff: 5,
        worldProximityThreshold: 0.6,
        worldProximityFalloff: 0.3,
      });
      this.composer.addPass(new EffectPass(camera, ssao));
    }
    // Viewmodel: same scene (its own layer), depth cleared so the gun never clips into walls.
    const vm = new RenderPass(scene, viewCamera);
    vm.clearPass.setClearFlags(false, true, false);
    vm.ignoreBackground = true;
    vm.skipShadowMapUpdate = true;
    this.composer.addPass(vm);

    this.fringe = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0, 0), radialModulation: true, modulationOffset: 0.2 });
    this.bloom = q.bloom
      ? new BloomEffect({ mipmapBlur: true, luminanceThreshold: 1.1, luminanceSmoothing: 0.25, intensity: 0.85, radius: 0.72, levels: q.level === "high" ? 7 : 5 })
      : null;
    const main = this.bloom ? [this.fringe, this.bloom, this.grade] : [this.fringe, this.grade];
    this.composer.addPass(new EffectPass(camera, ...main));
    if (q.smaa) this.composer.addPass(new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.MEDIUM })));
  }

  /** Chromatic fringe spike, reserved for Lance discharge and eliminations. */
  kick(now: number, strength: number, ms: number): void {
    this.fringeStart = now;
    this.fringeUntil = now + ms;
    this.fringeStrength = Math.max(strength, this.fringeUntil > now ? this.fringeStrength : 0);
  }

  update(now: number, punch: number): void {
    const t = this.fringeUntil > now ? 1 - (now - this.fringeStart) / (this.fringeUntil - this.fringeStart) : 0;
    const s = this.fringeStrength * t * t;
    this.fringe.offset.set(s * 0.004, s * 0.0025);
    if (t <= 0) this.fringeStrength = 0;
    this.grade.punch = punch;
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h, false);
  }

  render(dt: number): void {
    this.composer.render(dt);
  }

  dispose(): void {
    this.composer.dispose();
  }
}
