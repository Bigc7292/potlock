import "./style.css";
import { isAntePreset, type Snapshot } from "@potlock/shared";
import { GameClient } from "./game.js";
import { connect, type Connection, type TableTarget } from "./net.js";
import { TableOverlay } from "./ui.js";

function readTarget(): { target: TableTarget; token: string } | null {
  const params = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const token = hash.get("t");
  // Drop the token from the address bar so it is not bookmarked or shared.
  if (token) history.replaceState(null, "", window.location.pathname + window.location.search);
  if (!token) return null;
  const create = Number(params.get("create"));
  if (isAntePreset(create)) return { target: { kind: "create", ante: create }, token };
  const join = params.get("join");
  if (join) return { target: { kind: "join", roomId: join }, token };
  return null;
}

function userIdFromToken(token: string): string {
  try {
    const payload = JSON.parse(atob((token.split(".")[1] ?? "").replace(/-/g, "+").replace(/_/g, "/"))) as { sub?: string };
    return payload.sub ?? "";
  } catch {
    return "";
  }
}

async function main(): Promise<void> {
  // Dev-only art preview: the scene with staged dummies, no server or pot involved.
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has("preview")) {
    const { startPreview } = await import("./preview.js");
    startPreview();
    return;
  }
  let conn: Connection | null = null;
  const overlay = new TableOverlay({
    setReady: (ready) => conn?.send("ready", { ready }),
    lock: () => conn?.send("lock", {}),
  });
  const entry = readTarget();
  if (!entry) {
    overlay.message("No table selected", "Open or join a Gilt Round table from the lobby.");
    return;
  }
  const me = userIdFromToken(entry.token);
  overlay.message("Connecting", "Finding your seat...");
  try {
    conn = await connect(entry.target, entry.token);
  } catch (err) {
    overlay.message("Could not sit down", err instanceof Error ? err.message : "The table is unavailable.");
    return;
  }

  const game = new GameClient(conn, me, document.body);
  if (import.meta.env.DEV) {
    (window as unknown as { __potlock: ReturnType<GameClient["debugApi"]> }).__potlock = game.debugApi();
  }

  let ended = false;
  let latest: Snapshot | null = null;
  conn.onSnapshot((s) => {
    latest = s;
    if (ended) return;
    if (s.phase === "waiting" || s.phase === "locked") overlay.table(s, me);
    else if (s.phase === "countdown") overlay.countdown(s);
    else if (s.phase === "live") overlay.hide();
  });
  conn.onEvent((e) => {
    if (e.type === "notice" || e.type === "lockFailed") {
      overlay.setNotice(e.type === "notice" ? e.text : e.message);
      if (latest && latest.phase === "waiting") overlay.table(latest, me);
    }
    if (e.type === "result") {
      ended = true;
      overlay.result(e.result, me);
    }
  });
  conn.onClose((code) => {
    if (!ended) overlay.message("Disconnected", code === 4000 ? "You were removed from the table." : "The connection to the table closed.");
  });
}

void main();
