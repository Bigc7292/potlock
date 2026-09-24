/** Per-frame intent sampled from keyboard and mouse. */
export interface FrameIntent {
  forward: number;
  strafe: number;
  yaw: number;
  pitch: number;
  jump: boolean;
  walk: boolean;
  fire: boolean;
  reload: boolean;
  pickup: boolean;
}

/** Overrides used by the dev-only automation hook (see debug.ts). */
export interface IntentOverride {
  forward?: number;
  strafe?: number;
  yaw?: number;
  pitch?: number;
  walk?: boolean;
  fire?: boolean;
  pickup?: boolean;
}

const PITCH_LIMIT = Math.PI / 2 - 0.02;

/** Pointer-lock FPS input. Owns only the local view angles and key state, never game state. */
export class InputController {
  yaw = 0;
  pitch = 0;
  sensitivity = 0.0022;
  override: IntentOverride | null = null;

  private readonly keys = new Set<string>();
  private firePressed = false;
  private reloadPressed = false;
  private pickupPressed = false;
  private overrideFire = false;
  private overridePickup = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === "KeyR") this.reloadPressed = true;
      if (e.code === "KeyE") this.pickupPressed = true;
      if (e.code === "Space") e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
    canvas.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      if (!this.locked) {
        void canvas.requestPointerLock();
        return;
      }
      this.firePressed = true;
    });
    document.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * this.sensitivity;
      this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch - e.movementY * this.sensitivity));
    });
  }

  get locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  setView(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = pitch;
  }

  /** Queue a one-shot fire / pickup from automation. */
  pulse(kind: "fire" | "pickup"): void {
    if (kind === "fire") this.overrideFire = true;
    else this.overridePickup = true;
  }

  sample(): FrameIntent {
    const o = this.override;
    if (o?.yaw !== undefined) this.yaw = o.yaw;
    if (o?.pitch !== undefined) this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, o.pitch));
    const k = (code: string) => (this.keys.has(code) ? 1 : 0);
    const intent: FrameIntent = {
      forward: o?.forward ?? k("KeyW") - k("KeyS"),
      strafe: o?.strafe ?? k("KeyD") - k("KeyA"),
      yaw: this.yaw,
      pitch: this.pitch,
      jump: this.keys.has("Space"),
      walk: o?.walk ?? (this.keys.has("ShiftLeft") || this.keys.has("ShiftRight")),
      fire: this.firePressed || this.overrideFire || (o?.fire ?? false),
      reload: this.reloadPressed,
      pickup: this.pickupPressed || this.overridePickup || (o?.pickup ?? false),
    };
    this.firePressed = false;
    this.reloadPressed = false;
    this.pickupPressed = false;
    this.overrideFire = false;
    this.overridePickup = false;
    return intent;
  }
}
