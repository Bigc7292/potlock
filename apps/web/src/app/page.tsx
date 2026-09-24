import { getLedgerHistory, getWalletSummary, type LedgerLine } from "@potlock/db";
import { SignInPanel } from "@/components/SignInPanel";
import { SignOutButton } from "@/components/SignOutButton";
import { TableBrowser } from "@/components/TableBrowser";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Read per request so a deployed lobby can point at a new game address without a rebuild.
function gameUrl(): string {
  return (process.env.GAME_URL ?? process.env.NEXT_PUBLIC_GAME_URL ?? "http://localhost:5173").replace(/\/+$/, "");
}

const KIND_LABEL: Record<LedgerLine["kind"], string> = {
  STARTER_GRANT: "Starter grant",
  POT_HOLD: "Ante locked in pot",
  POT_PAYOUT: "Pot won",
  POT_SPLIT: "Pot split (tie)",
  POT_REFUND: "Ante refunded",
};

function Header({ right }: { right?: React.ReactNode }) {
  return (
    <header className="flex items-end justify-between">
      <div>
        <h1 className="font-display text-5xl font-bold tracking-wide text-gilt">POTLOCK</h1>
        <p className="mt-1 text-rivet">Lock in. Play. Winner takes the pot.</p>
      </div>
      {right}
    </header>
  );
}

export default async function LobbyPage() {
  const user = await currentUser();
  if (!user) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-12">
        <Header />
        <SignInPanel />
      </main>
    );
  }
  const [wallet, history] = await Promise.all([getWalletSummary(user.id), getLedgerHistory(user.id, 25)]);
  const balance = wallet?.balance ?? 0;

  return (
    <main className="mx-auto max-w-4xl px-4 py-12">
      <Header
        right={
          <div className="text-right">
            <p className="text-sm">
              {user.handle}
              {user.isGuest && <span className="ml-2 text-xs text-rivet">(guest)</span>}
            </p>
            <p className="font-display text-3xl text-gilt" data-testid="balance">
              {balance.toLocaleString("en-US")} <span className="text-base">PC</span>
            </p>
            <SignOutButton />
          </div>
        }
      />
      <div className="mt-10 space-y-8">
        <TableBrowser balance={balance} gameUrl={gameUrl()} />
        <section className="rounded-lg border border-plate bg-steel p-6">
          <h2 className="font-display text-xl uppercase tracking-wider">Ledger</h2>
          <p className="mt-1 text-xs text-rivet">Every Pot Credit movement on your wallet, newest first.</p>
          <table className="mt-4 w-full text-sm" data-testid="ledger">
            <thead className="text-left text-xs uppercase tracking-widest text-rivet">
              <tr>
                <th className="py-2 font-normal">When</th>
                <th className="py-2 font-normal">What</th>
                <th className="py-2 text-right font-normal">Amount</th>
                <th className="py-2 text-right font-normal">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-plate">
              {history.map((h) => (
                <tr key={h.id}>
                  <td className="py-2 text-rivet">{h.createdAt.toISOString().slice(0, 19).replace("T", " ")}</td>
                  <td className="py-2">
                    {KIND_LABEL[h.kind]}
                    {h.matchId && <span className="ml-2 text-xs text-rivet">match {h.matchId.slice(0, 8)}</span>}
                  </td>
                  <td className={`py-2 text-right font-display ${h.amount >= 0 ? "text-signal" : "text-alarm"}`}>
                    {h.amount >= 0 ? "+" : ""}
                    {h.amount}
                  </td>
                  <td className="py-2 text-right font-display">{h.balanceAfter}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
