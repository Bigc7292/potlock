import { GILT_ROUND, type MatchResult, type Snapshot } from "@potlock/shared";
import { LOBBY_URL } from "./env.js";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

function secondsLeft(at: number | null, serverNow: number): number {
  return at === null ? 0 : Math.max(0, Math.ceil((at - serverNow) / 1000));
}

export interface TableActions {
  setReady(ready: boolean): void;
  lock(): void;
}

/** DOM overlay for the table (seats, ready, lock) and the results screen. Reads state; owns none. */
export class TableOverlay {
  private readonly root: HTMLDivElement;
  private notice = "";
  private lastHtml = "";

  constructor(private readonly actions: TableActions) {
    this.root = document.createElement("div");
    this.root.className = "overlay";
    document.body.appendChild(this.root);
    this.root.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const action = target.closest("button")?.dataset.action;
      if (action === "ready") this.actions.setReady(true);
      if (action === "unready") this.actions.setReady(false);
      if (action === "lock") this.actions.lock();
    });
  }

  hide(): void {
    this.root.classList.add("hidden");
  }

  setNotice(text: string): void {
    this.notice = text;
  }

  message(title: string, body: string): void {
    this.root.classList.remove("hidden");
    this.set(`<div class="panel"><h1 class="display">${esc(title)}</h1><p class="sub">${esc(body)}</p>
      <div class="row"><a class="link" href="${LOBBY_URL}">Back to lobby</a></div></div>`);
  }

  table(s: Snapshot, me: string): void {
    this.root.classList.remove("hidden");
    const seat = s.seats.find((x) => x.userId === me);
    const isHost = seat?.isHost ?? false;
    const readyCount = s.seats.filter((x) => x.ready).length;
    const canLock = isHost && s.phase === "waiting" && readyCount >= GILT_ROUND.minPlayers;
    const potPreview = s.phase === "waiting" ? s.ante * Math.max(readyCount, 1) : s.pot;
    const seats = s.seats
      .map(
        (x) => `<li><span>${esc(x.name)}${x.userId === me ? '<span class="tag">you</span>' : ""}${
          x.isHost ? '<span class="tag">host</span>' : ""
        }</span><span class="display ${x.ready ? "ready" : "notready"}">${x.ready ? "Ready" : "Seated"}</span></li>`,
      )
      .join("");
    let status = "";
    if (s.phase === "waiting") {
      status =
        s.autoLockAt !== null
          ? `Pot auto-locks in ${secondsLeft(s.autoLockAt, s.serverTime)}s`
          : `Waiting for ${GILT_ROUND.minPlayers}+ ready players`;
    } else if (s.phase === "locked") {
      status = "Locking the pot...";
    }
    const buttons =
      s.phase === "waiting"
        ? `<div class="row">
            ${
              seat?.ready
                ? '<button class="secondary" data-action="unready">Stand up</button>'
                : '<button class="primary" data-action="ready" data-testid="ready">Ready</button>'
            }
            ${isHost ? `<button class="primary" data-action="lock" data-testid="lock" ${canLock ? "" : "disabled"}>Lock pot</button>` : ""}
          </div>`
        : "";
    this.set(`<div class="panel" data-testid="table-panel">
      <h1 class="display">Gilt Round</h1>
      <div class="sub">Drydock 09 · ${s.ante} PC ante · first to ${GILT_ROUND.scoreToWin} eliminations takes the pot</div>
      <div class="pot display" data-testid="pot">${potPreview} PC</div>
      <div class="sub">${s.phase === "waiting" ? "Pot if everyone ready locks in" : "Locked pot"} · ${esc(status)}</div>
      <ul class="seats">${seats}</ul>
      ${buttons}
      <div class="notice">${esc(this.notice)}</div>
      <div class="hint">Controls: click to aim, WASD move, Space jump, Shift walk, left click fire, R reload, E pick up the Auric Lance.
        Leaving after the pot locks forfeits your ante.</div>
      <div class="row"><a class="link" href="${LOBBY_URL}">Leave table</a></div>
    </div>`);
  }

  countdown(s: Snapshot): void {
    this.root.classList.remove("hidden");
    this.set(`<div><div class="sub display" style="text-align:center">Pot locked · ${s.pot} PC</div>
      <div class="big display" data-testid="countdown">${secondsLeft(s.countdownEndsAt, s.serverTime)}</div></div>`);
  }

  result(r: MatchResult, me: string): void {
    this.root.classList.remove("hidden");
    const mine = r.payouts.find((p) => p.userId === me)?.amount ?? 0;
    const won = r.winnerIds.includes(me);
    const headline =
      r.reason === "abandoned" ? "Match cancelled" : won ? (r.winnerIds.length > 1 ? "Split pot" : "You take the pot") : "Pot lost";
    const reason = { score: "First to 3", timeout: "Time expired", forfeit: "Opponents forfeited", abandoned: "Antes refunded" }[
      r.reason
    ];
    const rows = r.standings
      .map(
        (s) => `<li><span>${esc(s.name)}${s.userId === me ? '<span class="tag">you</span>' : ""}${
          s.forfeited ? '<span class="tag">forfeit</span>' : ""
        }</span><span class="display">${s.score} elim${s.score === 1 ? "" : "s"}</span></li>`,
      )
      .join("");
    this.set(`<div class="panel" data-testid="result">
      <h1 class="display ${won ? "win" : "loss"}">${headline}</h1>
      <div class="sub">${reason} · pot ${r.potTotal} PC</div>
      <div class="payout display ${mine > 0 ? "win" : "loss"}" data-testid="payout">${mine > 0 ? `+${mine} PC` : "+0 PC"}</div>
      <ul class="seats">${rows}</ul>
      <div class="row"><a href="${LOBBY_URL}"><button class="primary" data-testid="back">Back to lobby</button></a></div>
    </div>`);
  }

  private set(html: string): void {
    if (html === this.lastHtml) return;
    this.lastHtml = html;
    this.root.innerHTML = html;
  }
}
