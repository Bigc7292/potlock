"use client";

import { useEffect, useState } from "react";
import { ANTE_PRESETS, GILT_ROUND, type TableListing } from "@potlock/shared";

const GAME_URL = process.env.NEXT_PUBLIC_GAME_URL ?? "http://localhost:5173";

async function goToTable(query: string): Promise<void> {
  const res = await fetch("/api/match-token", { method: "POST" });
  if (!res.ok) {
    window.location.reload();
    return;
  }
  const { token } = (await res.json()) as { token: string };
  // The token rides in the URL fragment, which browsers never send to a server.
  window.location.href = `${GAME_URL}/?${query}#t=${encodeURIComponent(token)}`;
}

const PHASE_LABEL: Record<TableListing["phase"], string> = {
  waiting: "Seating",
  locked: "Locking pot",
  countdown: "Starting",
  live: "Live",
  ended: "Paying out",
};

export function TableBrowser({ balance }: { balance: number }) {
  const [tables, setTables] = useState<TableListing[]>([]);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch("/api/tables", { cache: "no-store" });
        const body = (await res.json()) as { tables: TableListing[]; error?: string };
        if (!alive) return;
        setTables(body.tables);
        setOffline(Boolean(body.error));
      } catch {
        if (alive) setOffline(true);
      }
    }
    void load();
    const id = setInterval(load, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  function go(query: string) {
    setBusy(true);
    void goToTable(query).finally(() => setBusy(false));
  }

  return (
    <section className="rounded-lg border border-plate bg-steel p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="font-display text-xl uppercase tracking-wider">Gilt Round tables</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-widest text-rivet">New table</span>
          {ANTE_PRESETS.map((ante) => (
            <button
              key={ante}
              disabled={busy || balance < ante}
              onClick={() => go(`create=${ante}`)}
              data-testid={`create-${ante}`}
              className="rounded border border-gilt px-3 py-1 font-display font-bold text-gilt hover:bg-gilt hover:text-ink disabled:border-plate disabled:text-rivet disabled:hover:bg-transparent"
            >
              {ante} PC
            </button>
          ))}
        </div>
      </div>
      <p className="mt-2 text-sm text-rivet">
        2 to {GILT_ROUND.maxPlayers} players. Everyone locks the same ante. First to {GILT_ROUND.scoreToWin} eliminations takes
        the whole pot.
      </p>
      {offline && <p className="mt-4 text-sm text-alarm">The match server is not reachable. Is `pnpm dev` running?</p>}
      <ul className="mt-5 divide-y divide-plate" data-testid="table-list">
        {tables.length === 0 && !offline && <li className="py-3 text-sm text-rivet">No open tables. Start one.</li>}
        {tables.map((t) => {
          const joinable = t.phase === "waiting" && !t.locked && t.seated < t.maxSeats && balance >= t.ante;
          return (
            <li key={t.roomId} className="flex items-center justify-between py-3">
              <div>
                <span className="font-display text-lg text-gilt">{t.ante} PC</span>
                <span className="ml-3 text-sm">{t.hostName}&apos;s table</span>
                <span className="ml-3 text-xs uppercase tracking-widest text-rivet">
                  {PHASE_LABEL[t.phase]} · {t.seated}/{t.maxSeats}
                </span>
              </div>
              <button
                disabled={!joinable || busy}
                onClick={() => go(`join=${encodeURIComponent(t.roomId)}`)}
                className="rounded bg-signal px-4 py-1 font-display font-bold uppercase text-ink disabled:bg-plate disabled:text-rivet"
              >
                Sit down
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
