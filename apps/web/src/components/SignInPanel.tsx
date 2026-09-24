"use client";

import { signIn } from "next-auth/react";
import { useState, type FormEvent } from "react";

export function SignInPanel() {
  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [handle, setHandle] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await signIn("credentials", { handle, password, mode, redirect: false });
    setBusy(false);
    if (res?.error) {
      setError(
        mode === "register"
          ? "That handle is taken or invalid (3-20 letters, digits or _; password 6+)."
          : "Wrong handle or password.",
      );
      return;
    }
    window.location.reload();
  }

  async function guest() {
    setBusy(true);
    await signIn("guest", { redirect: false });
    window.location.reload();
  }

  return (
    <section className="mt-10 grid gap-6 md:grid-cols-2">
      <form onSubmit={submit} className="rounded-lg border border-plate bg-steel p-6" data-testid="signin-form">
        <div className="flex gap-4 font-display text-sm uppercase tracking-widest">
          <button type="button" onClick={() => setMode("signin")} className={mode === "signin" ? "text-gilt" : "text-rivet"}>
            Sign in
          </button>
          <button type="button" onClick={() => setMode("register")} className={mode === "register" ? "text-gilt" : "text-rivet"}>
            Create account
          </button>
        </div>
        <label className="mt-5 block text-xs uppercase tracking-wider text-rivet">
          Handle
          <input
            name="handle"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            className="mt-1 w-full rounded border border-plate bg-ink px-3 py-2 text-base text-white outline-none focus:border-gilt"
            autoComplete="username"
          />
        </label>
        <label className="mt-4 block text-xs uppercase tracking-wider text-rivet">
          Password
          <input
            name="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded border border-plate bg-ink px-3 py-2 text-base text-white outline-none focus:border-gilt"
            autoComplete={mode === "register" ? "new-password" : "current-password"}
          />
        </label>
        {error && <p className="mt-3 text-sm text-alarm">{error}</p>}
        <button
          disabled={busy}
          className="mt-5 w-full rounded bg-gilt px-4 py-2 font-display font-bold uppercase tracking-widest text-ink disabled:opacity-50"
        >
          {mode === "register" ? "Create and claim 2,000 PC" : "Sign in"}
        </button>
      </form>
      <div className="flex flex-col justify-between rounded-lg border border-plate bg-steel p-6">
        <div>
          <h2 className="font-display text-xl">Just want to play?</h2>
          <p className="mt-2 text-sm text-rivet">
            Guests get a random handle and the same 2,000 Pot Credits starter grant. Pot Credits are play money: they
            cannot be bought or cashed out.
          </p>
          <p className="mt-2 text-xs text-rivet">Seeded test players: vesper_k, rook, mako, juniper (password: potlock).</p>
        </div>
        <button
          onClick={guest}
          disabled={busy}
          data-testid="guest-button"
          className="mt-6 rounded border border-signal px-4 py-2 font-display font-bold uppercase tracking-widest text-signal disabled:opacity-50"
        >
          Play as guest
        </button>
      </div>
    </section>
  );
}
