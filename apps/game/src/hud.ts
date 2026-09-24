import { AURIC_LANCE, GILT_ROUND, KESTREL_SIDEARM, type PlayerView, type Snapshot } from "@potlock/shared";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

/** In-match HUD. It only displays snapshot state and events; it owns no game state. */
export class Hud {
  private readonly root: HTMLDivElement;
  private readonly scores: HTMLDivElement;
  private readonly health: HTMLDivElement;
  private readonly ammo: HTMLDivElement;
  private readonly lance: HTMLDivElement;
  private readonly feed: HTMLDivElement;
  private readonly center: HTMLDivElement;
  private readonly hitmark: HTMLDivElement;
  private readonly flash: HTMLDivElement;
  private readonly clickToPlay: HTMLDivElement;
  private hitTimer = 0;
  private flashTimer = 0;

  constructor() {
    this.root = document.createElement("div");
    this.root.className = "hud hidden";
    this.root.innerHTML = `
      <div class="flash"></div>
      <div class="crosshair"></div><div class="hitmark"></div>
      <div class="scores" data-testid="scores"></div>
      <div class="lancechip chip"></div>
      <div class="feed"></div>
      <div class="center-msg"></div>
      <div class="health"><span data-testid="hp"></span><div class="bar"><div class="fill"></div></div></div>
      <div class="ammo"></div>
      <div class="clicktoplay">Click to play</div>`;
    document.body.appendChild(this.root);
    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector(sel) as T;
    this.scores = q(".scores");
    this.health = q(".health");
    this.ammo = q(".ammo");
    this.lance = q(".lancechip");
    this.feed = q(".feed");
    this.center = q(".center-msg");
    this.hitmark = q(".hitmark");
    this.flash = q(".flash");
    this.clickToPlay = q(".clicktoplay");
  }

  show(visible: boolean): void {
    this.root.classList.toggle("hidden", !visible);
  }

  update(s: Snapshot, me: string, local: PlayerView | undefined, pointerLocked: boolean, respawnIn: number | null, nameOf: (id: string) => string): void {
    const left = s.liveEndsAt === null ? GILT_ROUND.matchDurationMs : Math.max(0, s.liveEndsAt - s.serverTime);
    const mm = Math.floor(left / 60000);
    const ss = Math.floor((left % 60000) / 1000)
      .toString()
      .padStart(2, "0");
    const chips = [...s.seats]
      .sort((a, b) => b.score - a.score || a.seat - b.seat)
      .map(
        (seat) =>
          `<div class="chip ${seat.userId === me ? "me" : ""}">${esc(seat.name)}${seat.forfeited ? " (left)" : ""}<b>${seat.score}</b></div>`,
      )
      .join("");
    this.scores.innerHTML = `<div class="chip timer">${mm}:${ss}</div>${chips}<div class="chip potchip">Pot ${s.pot} PC</div>`;

    const hp = local?.hp ?? 0;
    (this.health.querySelector("span") as HTMLSpanElement).textContent = `HP ${hp}`;
    (this.health.querySelector(".fill") as HTMLDivElement).style.width = `${hp}%`;

    if (local?.weapon === "lance") {
      this.ammo.innerHTML = `${local.charging ? "Charging" : "Auric Lance"}<small>1 shot · ${AURIC_LANCE.chargeMs / 1000}s charge</small>`;
    } else {
      this.ammo.innerHTML = `${local?.reloading ? "Reloading" : `${local?.ammo ?? 0} / ${KESTREL_SIDEARM.magSize}`}<small>${KESTREL_SIDEARM.name}</small>`;
    }

    const l = s.lance;
    this.lance.textContent =
      l.state === "held"
        ? `Auric Lance: held by ${nameOf(l.holderId)}`
        : l.state === "pedestal"
          ? "Auric Lance: on the pedestal (E)"
          : l.state === "dropped"
            ? "Auric Lance: dropped (E)"
            : `Auric Lance: ${Math.max(0, Math.ceil((l.availableAt - s.serverTime) / 1000))}s`;

    if (respawnIn !== null) {
      this.center.innerHTML = `Eliminated<small>Back in ${(respawnIn / 1000).toFixed(1)}s</small>`;
    } else {
      const charger = s.players.find((p) => p.charging && p.userId !== me);
      this.center.innerHTML = charger ? `Lance charging<small>${esc(nameOf(charger.userId))} is aiming</small>` : "";
    }
    this.clickToPlay.style.display = pointerLocked ? "none" : "block";

    const now = performance.now();
    this.hitmark.classList.toggle("on", now < this.hitTimer);
    this.flash.classList.toggle("on", now < this.flashTimer);
  }

  hit(): void {
    this.hitTimer = performance.now() + 120;
  }

  hurt(): void {
    this.flashTimer = performance.now() + 150;
  }

  killFeed(text: string): void {
    const line = document.createElement("div");
    line.textContent = text;
    this.feed.prepend(line);
    while (this.feed.children.length > 5) this.feed.lastElementChild?.remove();
    setTimeout(() => line.remove(), 6000);
  }
}
