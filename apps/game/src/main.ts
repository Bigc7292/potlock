import * as THREE from "three";
import { DRYDOCK_09 } from "@potlock/shared";

// Phase 0: render the Drydock 09 blockout from shared geometry.
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.style.margin = "0";
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07080b);
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 30, 34);
camera.lookAt(0, 0, 0);
scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x20242c, 1.2));

for (const b of DRYDOCK_09.boxes) {
  const size = new THREE.Vector3(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), new THREE.MeshLambertMaterial({ color: 0x5a6273 }));
  mesh.position.set((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
  scene.add(mesh);
}

renderer.setAnimationLoop(() => renderer.render(scene, camera));
