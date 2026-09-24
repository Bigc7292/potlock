/**
 * Quality flag: low | mid | high. Chosen once at load (URL ?q=, then saved choice, then a
 * device guess) and stepped down at runtime if the frame rate stays under 50 FPS for 2 s.
 * Geometry, lights and materials are identical across levels so a step-down never
 * recompiles shaders; only post effects, render scale and shadow resolution change.
 */
export type QualityLevel = "low" | "mid" | "high";

export interface QualitySettings {
  level: QualityLevel;
  /** Multiplier on devicePixelRatio (clamped). */
  renderScale: number;
  maxPixelRatio: number;
  bloom: boolean;
  ssao: boolean;
  smaa: boolean;
  shadowMapSize: number;
  /**
   * Minimum gap between rendered frames. 0 on real GPUs. On a software rasteriser (no
   * graphics card) each frame is so slow that input and prediction would crawl, so the
   * scene redraws a few times a second while input keeps flowing every frame.
   */
  minFrameMs: number;
  /** Real-time shadow map (off only in the software fallback). */
  shadows: boolean;
}

const STORE_KEY = "potlock.quality";

function baseSettings(level: QualityLevel): QualitySettings {
  switch (level) {
    case "high":
      return { level, renderScale: 1, maxPixelRatio: 1.5, bloom: true, ssao: true, smaa: true, shadowMapSize: 2048, minFrameMs: 0, shadows: true };
    case "mid":
      return { level, renderScale: 1, maxPixelRatio: 1, bloom: true, ssao: false, smaa: true, shadowMapSize: 2048, minFrameMs: 0, shadows: true };
    case "low":
      return { level, renderScale: 0.75, maxPixelRatio: 1, bloom: false, ssao: false, smaa: false, shadowMapSize: 1024, minFrameMs: 0, shadows: true };
  }
}

export function settingsFor(level: QualityLevel): QualitySettings {
  const s = baseSettings(level);
  // An explicit ?q= (screenshots, testing a level) opts out of the software fallback.
  const forced = new URLSearchParams(window.location.search).has("q");
  return softwareRenderer() && !forced ? { ...s, renderScale: Math.min(s.renderScale, 0.4), minFrameMs: 200, shadows: false } : s;
}

function isLevel(v: string | null): v is QualityLevel {
  return v === "low" || v === "mid" || v === "high";
}

let software: boolean | null = null;

/** Software rasterisers (headless test browsers, blocklisted GPUs) start on low. Checked once. */
export function softwareRenderer(): boolean {
  software ??= detectSoftware();
  return software;
}

function detectSoftware(): boolean {
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (!gl) return true;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "";
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return /swiftshader|llvmpipe|software/i.test(name);
  } catch {
    return false;
  }
}

export function initialQuality(): QualityLevel {
  const fromUrl = new URLSearchParams(window.location.search).get("q");
  if (isLevel(fromUrl)) return fromUrl;
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (isLevel(saved)) return saved;
  } catch {
    // Storage can be blocked; fall through to the guess.
  }
  if (softwareRenderer()) return "low";
  const mobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
  return mobile ? "mid" : "high";
}

export function saveQuality(level: QualityLevel): void {
  try {
    localStorage.setItem(STORE_KEY, level);
  } catch {
    // Not persisted; fine.
  }
}

/** Watches frame times and asks for a step down after 2 s under 50 FPS. */
export class FrameGovernor {
  private windowStart = 0;
  private frames = 0;
  private slowFor = 0;
  fps = 60;

  constructor(private readonly onStepDown: () => void) {}

  /** Call once per rendered frame with performance.now(). */
  tick(now: number, active: boolean): void {
    if (this.windowStart === 0) this.windowStart = now;
    this.frames++;
    const elapsed = now - this.windowStart;
    if (elapsed < 500) return;
    this.fps = (this.frames * 1000) / elapsed;
    this.frames = 0;
    this.windowStart = now;
    if (!active || document.hidden) {
      this.slowFor = 0;
      return;
    }
    this.slowFor = this.fps < 50 ? this.slowFor + elapsed : 0;
    if (this.slowFor >= 2000) {
      this.slowFor = 0;
      this.onStepDown();
    }
  }
}
