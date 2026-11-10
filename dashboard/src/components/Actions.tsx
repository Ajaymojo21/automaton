import { useState } from "react";
import { executeRestore, planRestore, postAction } from "../api";
import type { ActionResult } from "../types";

/** The only three actions the console exposes. Each one is in-process or read-only and none of
 *  them can reach the agent, the wallet, the treasury, migrations or the stop marker. */

function Result({ result }: { result: ActionResult }) {
  return (
    <pre className="mt-3 max-h-64 overflow-auto rounded-lg border border-edge-soft bg-deep p-3 font-mono text-[11px] leading-relaxed text-mist">
      {result.summary || result.message || JSON.stringify(result, null, 2)}
    </pre>
  );
}

function useAction() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function run(call: () => Promise<ActionResult>) {
    setBusy(true);
    setError(null);
    try {
      setResult(await call());
    } catch (cause) {
      setResult(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }
  return { busy, result, error, run };
}

export function HealthCheckButton() {
  const { busy, result, error, run } = useAction();
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-semibold text-frost">Run health check</h3>
          <p className="note mt-1">
            Executes the pinned Conway guardian over the read-only handle and writes a new file
            under dashboard/state. It does not touch Conway reports/.
          </p>
        </div>
        <button type="button" className="btn btn-primary shrink-0" disabled={busy} onClick={() => void run(() => postAction("health-check"))}>
          {busy ? "Running…" : "Run"}
        </button>
      </div>
      {error ? <div className="mt-3 text-[12px] text-crimson">{error}</div> : null}
      {result ? <Result result={result} /> : null}
    </div>
  );
}

export function VerifyBackupsButton() {
  const { busy, result, error, run } = useAction();
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-semibold text-frost">Verify backups</h3>
          <p className="note mt-1">Re-hashes every archive file against its own manifest. Read-only.</p>
        </div>
        <button type="button" className="btn btn-primary shrink-0" disabled={busy} onClick={() => void run(() => postAction("verify-backups"))}>
          {busy ? "Hashing…" : "Verify"}
        </button>
      </div>
      {error ? <div className="mt-3 text-[12px] text-crimson">{error}</div> : null}
      {result ? <Result result={result} /> : null}
    </div>
  );
}

export function RestoreForm() {
  const { busy, result, error, run } = useAction();
  const [name, setName] = useState("");
  const [confirm, setConfirm] = useState("");
  const planned = result?.stage === "plan" && result.ok && result.plan ? result.plan : null;

  return (
    <div className="card p-4">
      <h3 className="text-[13px] font-semibold text-frost">Restore a backup to an alternate path</h3>
      <p className="note mt-1">
        A restore never overwrites the live state directory. The server refuses any target inside
        runtime/home, requires the confirmation to equal the backup name, and copies only files
        whose hashes matched the archive itself. Promoting a restored copy into the live tree stays
        a manual operator action.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="eyebrow block" htmlFor="restore-name">
            Backup directory name
          </label>
          <input id="restore-name" className="input mt-2" value={name} onChange={(e) => setName(e.target.value)} placeholder="2026-11-01_08-24-20" />
        </div>
        <div>
          <label className="eyebrow block" htmlFor="restore-confirm">
            Typed confirmation (must equal the name)
          </label>
          <input id="restore-confirm" className="input mt-2" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn"
          disabled={busy || !name || confirm !== name}
          onClick={() => void run(() => planRestore(name, confirm))}
        >
          {busy ? "Working…" : "1 · Plan and verify"}
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy || !planned || !confirm || confirm !== name}
          onClick={() => void run(() => executeRestore(name, confirm))}
        >
          2 · Copy to alternate path
        </button>
      </div>
      {planned ? (
        <div className="note mt-3">
          Planned: {planned.files?.length ?? 0} verified file(s) → <span className="value">{planned.target}</span>
        </div>
      ) : null}
      {error ? <div className="mt-3 text-[12px] text-crimson">{error}</div> : null}
      {result && !planned ? <Result result={result} /> : null}
    </div>
  );
}
