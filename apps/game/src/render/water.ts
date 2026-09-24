import * as THREE from "three";
import { PALETTE } from "./palette.js";
import { bake, Noise } from "./textures.js";

/**
 * Harbour sheet: a dark planar PBR surface with two scrolling ripple normals and a
 * scrolling roughness break-up. It reflects the big lights through the baked IBL and
 * the real spot/point lights through specular, with no extra scene render.
 * A soft foam line runs along the dock face.
 */

const rip = new Noise(1717);

function rippleTexture(aniso: number): THREE.Texture {
  const set = bake(
    (u, v, _x, _y, t) => {
      const n = rip.fbm(u, v * 1.6, 6, 5);
      const chop = rip.fbm(u + 0.5, v, 24, 3);
      t.h = n * 0.75 + chop * 0.25;
    },
    { w: 512, h: 512, normalStrength: 6, anisotropy: aniso },
  );
  set.map.dispose();
  set.orm.dispose();
  return set.normal;
}

export interface Water {
  group: THREE.Group;
  update(time: number): void;
}

export function buildWater(edgeZ: number, level: number, aniso: number): Water {
  const group = new THREE.Group();
  const normal = rippleTexture(aniso);
  normal.repeat.set(24, 12);
  const uniforms = { uTime: { value: 0 } };
  const mat = new THREE.MeshStandardMaterial({
    color: 0x04070a,
    roughness: 0.12,
    metalness: 0.0,
    normalMap: normal,
    envMapIntensity: 1.7,
  });
  mat.normalScale.set(0.55, 0.55);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;")
      .replace(
        "vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;",
        `vec3 n1 = texture2D( normalMap, vNormalMapUv + vec2( uTime * 0.011, uTime * 0.006 ) ).xyz * 2.0 - 1.0;
        vec3 n2 = texture2D( normalMap, vNormalMapUv * 1.83 + vec2( -uTime * 0.008, uTime * 0.013 ) ).xyz * 2.0 - 1.0;
        vec3 mapN = normalize( vec3( n1.xy + n2.xy, n1.z * n2.z ) );`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        float wr = texture2D( normalMap, vNormalMapUv * 0.21 + vec2( uTime * 0.004, -uTime * 0.003 ) ).x;
        roughnessFactor = clamp( roughnessFactor + ( wr - 0.5 ) * 0.22, 0.03, 0.4 );`,
      );
  };
  mat.customProgramCacheKey = () => "potlock-water";
  const size = 420;
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(size, size / 2), mat);
  plane.rotation.x = -Math.PI / 2;
  plane.position.set(0, level, edgeZ - size / 4);
  plane.receiveShadow = true;
  group.add(plane);

  // Foam: a soft noisy band hugging the dock face.
  const foamMat = new THREE.ShaderMaterial({
    uniforms: { uTime: uniforms.uTime, uColor: { value: new THREE.Color(PALETTE.cyan).lerp(new THREE.Color(0xffffff), 0.6).multiplyScalar(0.35) } },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vWorld;
      void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uColor; varying vec2 vUv; varying vec3 vWorld;
      float h(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
      float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1,0)), f.x), mix(h(i + vec2(0,1)), h(i + vec2(1,1)), f.x), f.y); }
      void main() {
        float edge = 1.0 - smoothstep(0.0, 1.0, vUv.y);
        float breakup = n(vec2(vWorld.x * 1.7 + uTime * 0.3, vUv.y * 3.0 - uTime * 0.6)) * n(vec2(vWorld.x * 4.3 - uTime * 0.2, uTime * 0.4));
        float a = edge * smoothstep(0.15, 0.7, breakup + edge * 0.35) * 0.8;
        gl_FragColor = vec4(uColor * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const foam = new THREE.Mesh(new THREE.PlaneGeometry(size / 3, 1.1, 1, 1), foamMat);
  foam.rotation.x = -Math.PI / 2;
  foam.position.set(0, level + 0.02, edgeZ - 0.55);
  foam.renderOrder = 2;
  group.add(foam);

  return {
    group,
    update(time: number) {
      uniforms.uTime.value = time;
    },
  };
}
