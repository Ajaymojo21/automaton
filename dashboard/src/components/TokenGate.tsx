import { useState } from "react";

export default function TokenGate({
  onSubmit,
  busy,
  error,
}: {
  onSubmit: (token: string) => Promise<void>;
  busy: boolean;
  error: string | null;
}) {
  const [token, setToken] = useState("");

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form
        className="card w-full max-w-lg p-6"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit(token.trim());
        }}
      >
        <div className="eyebrow">Local operator console</div>
        <h1 className="mt-1 text-[19px] font-semibold tracking-wide text-frost">
          CONWAY AUTOMATON / AI COMMAND CENTER
        </h1>
        <p className="note mt-3">
          The console reads Conway state over a read-only handle. Starting it does not start,
          fund, migrate, seal, engage or repair anything, and no agent control is reachable from
          this page.
        </p>

        <label className="eyebrow mt-6 block" htmlFor="operator-token">
          Operator token
        </label>
        <input
          id="operator-token"
          className="input mt-2"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="from dashboard/state/dashboard.token"
        />

        <div className="mt-4 rounded-lg border border-edge-soft bg-deep px-3 py-2.5">
          <div className="note">
            The token lives in <span className="value">dashboard/state/dashboard.token</span> (0600,
            loopback only). It is held in memory for this session and is never written to browser
            storage.
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-lg border border-crimson/40 bg-crimson/8 px-3 py-2 text-[12px] text-crimson">
            {error}
          </div>
        ) : null}

        <button type="submit" className="btn btn-primary mt-5 w-full" disabled={busy || token.trim().length === 0}>
          {busy ? "Verifying…" : "Unlock console"}
        </button>
      </form>
    </div>
  );
}
