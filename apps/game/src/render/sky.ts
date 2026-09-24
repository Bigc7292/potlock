import * as THREE from "three";
import { PALETTE } from "./palette.js";

/**
 * Custom night dome graded to the palette: void zenith, fog-coloured horizon haze,
 * a low sodium city glow to the north and a cold cyan harbour haze over the water (south).
 * The same dome, plus a few emissive "light cards", is baked into a PMREM for IBL so wet
 * surfaces reflect the big lights without any stock HDRI.
 */

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w; // pin to the far plane
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uVoid;
uniform vec3 uHaze;
uniform vec3 uSodium;
uniform vec3 uCyan;
uniform float uTime;
varying vec3 vDir;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -0.2, 1.0);
  // Base gradient: haze at the horizon falling to void.
  vec3 col = mix(uHaze, uVoid, smoothstep(-0.02, 0.45, h));
  // Sodium city glow low in the north (+z), cyan harbour haze in the south (-z).
  float north = max(0.0, d.z) * (1.0 - smoothstep(0.0, 0.22, h));
  float south = max(0.0, -d.z) * (1.0 - smoothstep(0.0, 0.16, h));
  col += uSodium * north * 0.16;
  col += uCyan * south * 0.05;
  // Slow, thin cloud deck catching the glow.
  vec2 cp = d.xz / max(0.08, d.y + 0.15) * 1.3 + vec2(uTime * 0.004, 0.0);
  float cloud = smoothstep(0.55, 0.85, vnoise(cp) * 0.65 + vnoise(cp * 2.7) * 0.35);
  col += (uSodium * 0.04 * (0.4 + north) + uHaze * 0.25) * cloud * smoothstep(0.02, 0.3, h);
  // Sparse stars above the haze, dimmed where clouds sit.
  vec2 sp = floor(d.xz / (d.y + 0.35) * 220.0);
  float star = step(0.9975, hash(sp)) * smoothstep(0.25, 0.7, h) * (1.0 - cloud);
  col += vec3(0.55, 0.6, 0.7) * star * 0.35;
  // Below the horizon: dark water/ground.
  col = mix(col, uVoid * 0.6, smoothstep(0.0, -0.08, d.y));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

function lin(c: number): THREE.Color {
  return new THREE.Color(c);
}

export function createSkyDome(): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  const mat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    uniforms: {
      uVoid: { value: lin(PALETTE.void) },
      uHaze: { value: lin(PALETTE.fog).multiplyScalar(1.6) },
      uSodium: { value: lin(PALETTE.sodium) },
      uCyan: { value: lin(PALETTE.cyan) },
      uTime: { value: 0 },
    },
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), mat);
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  return dome;
}

/**
 * Environment for IBL: the dome plus emissive cards standing in for the shed sodium
 * lamps (north) and the cyan floods over the water (south). Baked once.
 */
export function bakeEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const env = new THREE.Scene();
  const dome = createSkyDome();
  env.add(dome);
  const card = (color: number, intensity: number, w: number, h: number, pos: THREE.Vector3Tuple): void => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }),
    );
    m.position.set(...pos);
    m.lookAt(0, 2, 0);
    env.add(m);
  };
  card(PALETTE.sodium, 3.5, 10, 1.4, [-12, 9, 14]);
  card(PALETTE.sodium, 3.5, 10, 1.4, [6, 9, 14]);
  card(PALETTE.sodium, 2.2, 3, 3, [22, 7, -14]);
  card(PALETTE.cyan, 3.0, 4, 3, [-8, 10, -20]);
  card(PALETTE.cyan, 3.0, 4, 3, [12, 10, -20]);
  card(PALETTE.cyan, 1.6, 3, 2, [30, 6, 0]);
  card(PALETTE.moon, 0.9, 30, 12, [-40, 25, 45]);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(env, 0.035, 0.1, 400);
  pmrem.dispose();
  env.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
  return rt.texture;
}
