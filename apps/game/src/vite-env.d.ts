/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MATCH_WS_URL?: string;
  readonly VITE_LOBBY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
