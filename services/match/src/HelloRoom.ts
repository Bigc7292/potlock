import { Room, type Client } from "@colyseus/core";

/** Phase 0 smoke room: proves the Colyseus server, transport and Redis presence are wired. */
export class HelloRoom extends Room {
  override onCreate(): void {
    this.onMessage("ping", (client: Client, message: unknown) => {
      client.send("pong", { echo: message, at: Date.now() });
    });
  }
}
