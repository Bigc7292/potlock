import { AURIC_LANCE, GILT_ROUND, KESTREL_SIDEARM, type PlayerView, type Snapshot } from "@potlock/shared";
import { hex, SEAT_TRIM } from "./render/palette.js";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

function seatColor(seat: number): string {
  return hex(SEAT_TRIM[seat % SEAT_TRIM.length] ?? 0xffffff);
}

export interface KillLine {
  killer: string;
  victim: string;
  killerSeat: number;
  victimSeat: number;
  lance: boolean;
  mine: boolean;
}

const HP_PIPS = 10;
const TICK_MS = 900;

/**
 * In-match HUD, styled to the quay: stamped-steel plates, black-gold type, seat colours.
 * Bottom centre: HP pips, magazine, Lance gem. Top centre: first-to-3 medals and enemy pip
 * rows, with the locked stake beside the clock. Kill feed top-left, damage ticks around the
 * crosshair. It only displays snapshot state and events; it owns no game state.
 */
export class Hud {
  private readonly root: HTMLDivElement;
  private readonly clock: HTMLElement;
  private readonly medals: HTMLElement;
  private readonly rivals: HTMLElement;
  private readonly stake: HTMLElement;
  private readonly hpPips: HTMLElement;
  private readonly hpText: HTMLElement;
  private readonly mag: HTMLElement;
  private readonly magText: HTMLElement;
  private readonly weaponName: HTMLElement;
  private readonly gem: HTMLElement;
  private readonly gemText: HTMLElement;
  private readonly feed: HTMLElement;
  private readonly center: HTMLElement;
  private readonly hitmark: HTMLElement;
  private readonly flash: HTMLElement;
  private readonly ticks: HTMLElement;
  private readonly clickToPlay: HTMLElement;
  private hitTimer = 0;
  private flashTimer = 0;
  private lastKey = "";
  private lastHp = -1;
  private lastMag = "";

  constructor() {
    this.root = document.createElement("div");
    this.root.className = "hud hidden";
    const pips = Array.from({ length: HP_PIPS }, () => "<i></i>").join("");
    this.root.innerHTML = `
      <div class="hud-flash"></div>
      <div class="hud-ticks"></div>
      <div class="crosshair"><b></b><b></b><b></b><b></b></div>
      <div class="hitmark"><b></b><b></b><b></b><b></b></div>
      <div class="hud-top">
        <div class="hud-clockrow">
          <div class="hud-clock"></div>
          <div class="hud-stake"></div>
        </div>
        <div class="hud-medals" data-testid="scores"></div>
        <div class="hud-rivals"></div>
      </div>
      <div class="hud-feed"></div>
      <div class="hud-center"></div>
      <div class="hud-bottom">
        <div class="hud-plate hud-hp">
          <div class="hud-label">Integrity <span data-testid="hp"></span></div>
          <div class="hud-pips">${pips}</div>
        </div>
        <div class="hud-gem"><div class="gem"></div><div class="hud-label gem-text"></div></div>
        <div class="hud-plate hud-ammo">
          <div class="hud-label weapon-name"></div>
          <div class="hud-magrow"><div class="hud-mag"></div><div class="hud-magtext"></div></div>
        </div>
      </div>
      <div class="clicktoplay">Click to take aim</div>`;
    document.body.appendChild(this.root);
    const q = (sel: string): HTMLElement => this.root.querySelector(sel) as HTMLElement;
    this.clock = q(".hud-clock");
    this.stake = q(".hud-stake");
    this.medals = q(".hud-medals");
    this.rivals = q(".hud-rivals");
    this.hpPips = q(".hud-pips");
    this.hpText = q("[data-testid=hp]");
    this.mag = q(".hud-mag");
    this.magText = q(".hud-magtext");
    this.weaponName = q(".weapon-name");
    this.gem = q(".hud-gem");
    this.gemText = q(".gem-text");
    this.feed = q(".hud-feed");
    this.center = q(".hud-center");
    this.hitmark = q(".hitmark");
    this.flash = q(".hud-flash");
    this.ticks = q(".hud-ticks");
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
    this.clock.textContent = `${mm}:${ss}`;
    this.clock.classList.toggle("late", left < 30000);

    // Medals and rival rows only re-render when scores change.
    const mine = s.seats.find((x) => x.userId === me);
    const key = s.seats.map((x) => `${x.userId}:${x.score}:${x.forfeited}`).join("|") + `|${s.pot}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      const myScore = mine?.score ?? 0;
      this.medals.innerHTML = Array.from({ length: GILT_ROUND.scoreToWin }, (_, i) => `<i class="${i < myScore ? "won" : ""}"></i>`).join("");
      this.medals.setAttribute("aria-label", `${myScore} of ${GILT_ROUND.scoreToWin}`);
      this.rivals.innerHTML = s.seats
        .filter((x) => x.userId !== me)
        .map(
          (x) =>
            `<div class="rival${x.forfeited ? " gone" : ""}"><span style="--seat:${seatColor(x.seat)}">${esc(x.name)}</span>${Array.from(
              { length: GILT_ROUND.scoreToWin },
              (_, i) => `<i class="${i < x.score ? "on" : ""}" style="--seat:${seatColor(x.seat)}"></i>`,
            ).join("")}</div>`,
        )
        .join("");
      this.stake.innerHTML = `<span class="lock"></span><span>Pot locked</span><b>${s.pot} PC</b>`;
    }

    const hp = local?.hp ?? 0;
    if (hp !== this.lastHp) {
      this.lastHp = hp;
      this.hpText.textContent = String(hp);
      const lit = Math.ceil((hp / GILT_ROUND.maxHp) * HP_PIPS);
      Array.from(this.hpPips.children).forEach((el, i) => {
        el.className = i < lit ? (lit <= 3 ? "on low" : "on") : "";
      });
    }

    const lanceHeld = local?.weapon === "lance";
    const magKey = `${local?.weapon}:${local?.ammo}:${local?.reloading}:${local?.charging}`;
    if (magKey !== this.lastMag) {
      this.lastMag = magKey;
      if (lanceHeld) {
        this.weaponName.textContent = "Auric Lance";
        this.mag.innerHTML = `<i class="lance-round ${local?.charging ? "charging" : ""}"></i>`;
        this.magText.textContent = local?.charging ? "Charging" : `1 · ${AURIC_LANCE.chargeMs / 1000}s`;
      } else {
        this.weaponName.textContent = KESTREL_SIDEARM.name;
        const ammo = local?.ammo ?? 0;
        this.mag.innerHTML = Array.from({ length: KESTREL_SIDEARM.magSize }, (_, i) => `<i class="${i < ammo ? "on" : ""}"></i>`).join("");
        this.magText.textContent = local?.reloading ? "Reload" : String(ammo);
      }
      this.mag.parentElement?.classList.toggle("reloading", !!local?.reloading);
    }

    const l = s.lance;
    this.gem.dataset.state = lanceHeld ? "mine" : l.state;
    this.gemText.textContent =
      lanceHeld
        ? "Lance in hand"
        : l.state === "held"
          ? `${nameOf(l.holderId)} holds it`
          : l.state === "pedestal"
            ? "Lance up · E"
            : l.state === "dropped"
              ? "Lance dropped · E"
              : `Lance in ${Math.max(0, Math.ceil((l.availableAt - s.serverTime) / 1000))}s`;

    if (respawnIn !== null) {
      this.center.innerHTML = `<div class="hud-big">Eliminated</div><small>Back on the quay in ${(respawnIn / 1000).toFixed(1)}s</small>`;
      this.center.className = "hud-center down";
    } else {
      const charger = s.players.find((p) => p.charging && p.userId !== me);
      this.center.innerHTML = charger ? `<div class="hud-warn">Lance charging</div><small>${esc(nameOf(charger.userId))} is taking aim. Move.</small>` : "";
      this.center.className = "hud-center";
    }
    this.clickToPlay.style.display = pointerLocked ? "none" : "block";

    const now = performance.now();
    this.hitmark.classList.toggle("on", now < this.hitTimer);
    this.flash.classList.toggle("on", now < this.flashTimer);
  }

  hit(lance = false): void {
    this.hitTimer = performance.now() + 120;
    this.hitmark.classList.toggle("lance", lance);
  }

  /** Red edge flash plus a damage tick pointing at the shooter (bearing: 0 ahead, + right). */
  hurt(bearing: number | null = null): void {
    this.flashTimer = performance.now() + 150;
    if (bearing === null) return;
    const tick = document.createElement("i");
    tick.style.setProperty("--a", `${bearing}rad`);
    this.ticks.appendChild(tick);
    while (this.ticks.children.length > 4) this.ticks.firstElementChild?.remove();
    setTimeout(() => tick.remove(), TICK_MS);
  }

  killFeed(k: KillLine): void {
    const line = document.createElement("div");
    line.className = `kill${k.lance ? " lance" : ""}${k.mine ? " mine" : ""}`;
    line.innerHTML = `<span style="--seat:${seatColor(k.killerSeat)}">${esc(k.killer)}</span><em>${k.lance ? "lanced" : "dropped"}</em><span style="--seat:${seatColor(k.victimSeat)}">${esc(k.victim)}</span>`;
    this.pushFeed(line);
  }

  notice(text: string, lance: boolean): void {
    const line = document.createElement("div");
    line.className = `kill note${lance ? " lance" : ""}`;
    line.textContent = text;
    this.pushFeed(line);
  }

  private pushFeed(line: HTMLElement): void {
    this.feed.prepend(line);
    while (this.feed.children.length > 5) this.feed.lastElementChild?.remove();
    setTimeout(() => line.classList.add("out"), 5400);
    setTimeout(() => line.remove(), 6000);
  }
}
