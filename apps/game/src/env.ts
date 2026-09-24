interface RuntimeConfig {
  matchWsUrl?: string;
  lobbyUrl?: string;
}

// Set by /runtime-config.js, which the match server writes from its environment in production.
const runtime: RuntimeConfig = (window as unknown as { POTLOCK_CONFIG?: RuntimeConfig }).POTLOCK_CONFIG ?? {};

// In production the match server also serves this client, so the socket lives on the same origin.
function sameOriginWs(): string {
  return `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`;
}

export const MATCH_WS_URL: string =
  runtime.matchWsUrl || import.meta.env.VITE_MATCH_WS_URL || (import.meta.env.DEV ? "ws://localhost:2567" : sameOriginWs());
export const LOBBY_URL: string = runtime.lobbyUrl || import.meta.env.VITE_LOBBY_URL || "http://localhost:3000";
