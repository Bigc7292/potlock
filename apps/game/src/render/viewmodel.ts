import * as THREE from "three";
import { KESTREL_SIDEARM, type WeaponId } from "@potlock/shared";
import { StaticBatch } from "./batch.js";
import type { MaterialLibrary } from "./materials.js";
import { PALETTE } from "./palette.js";
import { starTexture } from "./textures.js";
import { addKestrel, addKestrelMag, addLance } from "./weapons.js";

/**
 * First-person hands and weapons on render layer 1 (drawn after a depth clear).
 * Feel: 2-3 cm look sway, stride bob, landing dip, heavy slide kick with a slower
 * recovery, a full reload (tilt, mag out, mag in), and the Lance charge lighting the arms.
 */

export interface ViewState {
  weapon: WeaponId;
  visible: boolean;
  reloading: boolean;
  charging: boolean;
  /** 0..1 of run speed while grounded. */
  stride: number;
  lookDX: number;
  lookDY: number;
}

const VM_LAYER = 1;

function layer(o: THREE.Object3D): void {
  o.traverse((c) => c.layers.set(VM_LAYER));
}

export class ViewModel {
  readonly root = new THREE.Group();
  private readonly kestrel = new THREE.Group();
  private readonly slide = new THREE.Group();
  private readonly mag = new THREE.Group();
  private readonly lance = new THREE.Group();
  private readonly flash: THREE.Sprite;
  private readonly sleeveMat: THREE.MeshStandardMaterial;
  private readonly lanceCoreMat: THREE.MeshStandardMaterial;
  private kick = 0;
  private swayX = 0;
  private swayY = 0;
  private bobPhase = 0;
  private dip = 0;
  private dipV = 0;
  private reloadStart = -1;
  private wasReloading = false;
  private flashUntil = 0;
  private equip = 0;
  private lastWeapon: WeaponId = "kestrel";

  constructor(lib: MaterialLibrary) {
    const polymer = new THREE.MeshStandardMaterial({ color: 0x1a1c1f, roughness: 0.72, metalness: 0.05, normalMap: lib.micro.normal, envMapIntensity: 0.7 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x6d7076, roughness: 0.28, metalness: 1, envMapIntensity: 1.3 });
    const slideMat = lib.nitride.clone();
    slideMat.roughness = 0.42;
    this.sleeveMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.1, normalMap: lib.micro.normal, emissive: 0x000000 });
    this.lanceCoreMat = lib.lanceCore.clone();

    // ---- Kestrel: frame + grip (static), slide (kicks), mag (reload) ----
    const I = new THREE.Matrix4();
    const frameB = new StaticBatch<"frame" | "steel" | "led">();
    addKestrel(frameB, I, { slide: null, frame: "frame", steel: "steel", led: "led" }, false);
    for (const m of frameB.build({ frame: polymer, steel, led: lib.cyanGlow }, () => ({ cast: false, receive: false }))) this.kestrel.add(m);
    // The slide pieces from the same recipe, as their own group so they can kick back.
    const slideB = new StaticBatch<"slide">();
    addKestrel(slideB, I, { slide: "slide", frame: null, steel: null, led: null }, false);
    for (const m of slideB.build({ slide: slideMat }, () => ({ cast: false, receive: false }))) this.slide.add(m);
    this.kestrel.add(this.slide);
    const magB = new StaticBatch<"steel">();
    addKestrelMag(magB, I, { slide: "steel", frame: "steel", steel: "steel", led: "steel" });
    for (const m of magB.build({ steel }, () => ({ cast: false, receive: false }))) this.mag.add(m);
    this.kestrel.add(this.mag);

    // Gloved hands and sleeves around the grip.
    const hands = new StaticBatch<"glove" | "sleeve">();
    const k = { uv: "keep" as const };
    hands.box("glove", 0.004, -0.055, 0.02, 0.05, 0.085, 0.07, { ...k, tint: 0x16171a, bevel: 0.02 });
    for (let i = 0; i < 3; i++) hands.box("glove", -0.012, -0.035 - i * 0.022, -0.012, 0.045, 0.018, 0.03, { ...k, tint: 0x16171a, bevel: 0.008 });
    hands.box("glove", -0.02, -0.06, 0.0, 0.03, 0.07, 0.06, { ...k, tint: 0x131416, bevel: 0.015 });
    hands.box("glove", -0.024, -0.045, 0.02, 0.05, 0.08, 0.06, { ...k, tint: 0x16171a, bevel: 0.02 });
    hands.pipe("sleeve", [0.01, -0.09, 0.07], [0.09, -0.19, 0.32], 0.045, { tint: 0x2b3038, seg: 10 });
    hands.pipe("sleeve", [-0.04, -0.085, 0.07], [-0.2, -0.2, 0.3], 0.043, { tint: 0x2b3038, seg: 10 });
    hands.box("sleeve", 0.03, -0.11, 0.12, 0.08, 0.05, 0.03, { ...k, tint: 0x16181b, bevel: 0.01 });
    const trimB = new StaticBatch<"trim">();
    trimB.box("trim", 0.055, -0.125, 0.16, 0.012, 0.012, 0.06, k);
    const gloveMat = lib.rubber;
    for (const m of hands.build({ glove: gloveMat, sleeve: this.sleeveMat }, () => ({ cast: false, receive: false }))) this.kestrel.add(m);
    for (const m of trimB.build({ trim: lib.cyanGlow }, () => ({ cast: false, receive: false }))) this.kestrel.add(m);
    this.kestrel.position.set(0.13, -0.118, -0.34);
    this.kestrel.rotation.set(0.02, 0.05, 0);
    this.kestrel.scale.setScalar(0.85);

    // ---- Auric Lance, held low and long ----
    const lanceB = new StaticBatch<"brass" | "ceramic" | "core">();
    addLance(lanceB, I, { brass: "brass", ceramic: "ceramic", core: "core" });
    for (const m of lanceB.build({ brass: lib.brass, ceramic: lib.ceramic, core: this.lanceCoreMat }, () => ({ cast: false, receive: false }))) this.lance.add(m);
    const lh = new StaticBatch<"glove" | "sleeve">();
    lh.box("glove", 0.0, -0.06, 0.0, 0.05, 0.08, 0.07, { ...k, tint: 0x16171a, bevel: 0.02 });
    lh.box("glove", 0.0, -0.07, -0.36, 0.05, 0.07, 0.07, { ...k, tint: 0x16171a, bevel: 0.02 });
    lh.pipe("sleeve", [0.01, -0.1, 0.05], [0.1, -0.2, 0.3], 0.045, { tint: 0x2b3038, seg: 10 });
    lh.pipe("sleeve", [-0.01, -0.1, -0.34], [-0.2, -0.24, -0.05], 0.043, { tint: 0x2b3038, seg: 10 });
    for (const m of lh.build({ glove: gloveMat, sleeve: this.sleeveMat }, () => ({ cast: false, receive: false }))) this.lance.add(m);
    this.lance.position.set(0.14, -0.15, -0.16);
    this.lance.rotation.set(0.03, 0.04, 0);
    this.lance.visible = false;

    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTexture(128), color: new THREE.Color(0xffd6a0).multiplyScalar(5), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flash.scale.setScalar(0.055);
    this.flash.position.set(0, 0.034, -0.19);
    this.flash.visible = false;
    this.kestrel.add(this.flash);

    this.root.add(this.kestrel, this.lance);
    layer(this.root);
  }

  /** Every mesh for shader warm-up. */
  warmTargets(): THREE.Object3D[] {
    return [this.kestrel, this.lance];
  }

  /** Muzzle position in world space (for the muzzle light). */
  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.flash.getWorldPosition(out);
  }

  fire(now: number, weapon: WeaponId): void {
    if (weapon === "kestrel") {
      this.kick = 1;
      this.flashUntil = now + 35;
      this.flash.material.rotation = Math.random() * Math.PI;
    } else {
      this.kick = 1.6;
    }
  }

  land(impact: number): void {
    this.dipV -= Math.min(0.9, impact * 0.08);
  }

  update(now: number, dt: number, s: ViewState): void {
    this.root.visible = s.visible;
    if (s.weapon !== this.lastWeapon) {
      this.equip = 1;
      this.lastWeapon = s.weapon;
    }
    this.kestrel.visible = s.weapon === "kestrel";
    this.lance.visible = s.weapon === "lance";
    // Look sway (max ~2.5 cm), spring back.
    const tx = THREE.MathUtils.clamp(-s.lookDX * 0.00055, -0.025, 0.025);
    const ty = THREE.MathUtils.clamp(s.lookDY * 0.00055, -0.02, 0.02);
    const k = 1 - Math.exp(-dt * 14);
    this.swayX += (tx - this.swayX) * k;
    this.swayY += (ty - this.swayY) * k;
    // Stride bob.
    this.bobPhase += dt * 9.5 * s.stride;
    const bobX = Math.sin(this.bobPhase) * 0.011 * s.stride;
    const bobY = -Math.abs(Math.cos(this.bobPhase)) * 0.009 * s.stride;
    // Landing dip: damped spring.
    this.dipV += (-this.dip * 180 - this.dipV * 16) * dt;
    this.dip += this.dipV * dt;
    // Heavy recoil: fast out, slower settle.
    this.kick *= Math.exp(-dt * 11);
    this.equip *= Math.exp(-dt * 7);
    // Reload choreography over the reload time.
    if (s.reloading && !this.wasReloading) this.reloadStart = now;
    this.wasReloading = s.reloading;
    const rt = s.reloading && this.reloadStart >= 0 ? Math.min(1, (now - this.reloadStart) / KESTREL_SIDEARM.reloadMs) : 1;
    const tilt = rt < 1 ? Math.sin(Math.min(1, rt / 0.9) * Math.PI) : 0;
    const magOut = rt < 1 ? (rt < 0.15 ? 0 : rt < 0.35 ? (rt - 0.15) / 0.2 : rt < 0.55 ? 1 : rt < 0.8 ? 1 - (rt - 0.55) / 0.25 : 0) : 0;

    this.root.position.set(this.swayX + bobX, this.swayY + bobY + this.dip * 0.6 - this.equip * 0.12, this.kick * 0.035);
    this.root.rotation.set(this.kick * 0.13 + this.swayY * 2 - tilt * 0.35, this.swayX * 2, -this.swayX * 3 + tilt * 0.55);
    this.slide.position.z = s.weapon === "kestrel" ? Math.min(1, this.kick) * 0.026 : 0;
    this.mag.position.y = -magOut * 0.22;
    this.mag.visible = magOut < 0.98;
    this.flash.visible = now < this.flashUntil;
    // Lance charge: core and arms light molten gold.
    const charge = s.charging ? 1 : 0;
    this.lanceCoreMat.emissiveIntensity = 3 + charge * (8 + Math.sin(now / 20) * 2);
    this.sleeveMat.emissive.set(PALETTE.lanceCore).multiplyScalar(charge * (0.25 + Math.sin(now / 30) * 0.1));
  }
}
