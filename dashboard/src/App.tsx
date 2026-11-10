import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPanels, getSession, login, logout, openStream } from "./api";
import type { Digest, Panel } from "./types";
import PanelView from "./components/PanelView";
import EvidenceChart from "./components/Charts";
import TokenGate from "./components/TokenGate";
import { HealthCheckButton, RestoreForm, VerifyBackupsButton } from "./components/Actions";
import VerdictBadge from "./components/VerdictBadge";

const AREA_LABELS: Record<string, string> = {
  overview: "Overview",
  agent: "AI Agent",
  models: "AI Models",
  wallet: "Wallet",
  treasury: "Treasury",
  security: "Security Center",
  health: "Health Monitor",
  "self-healing": "Self-Healing",
  logs: "Activity Logs",
  backup: "Backup & Recovery",
  controls: "System Controls",
  settings: "Settings",
  "repair-approvals": "Repair Approvals",
};

function useConsole() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [panels, setPanels] = useState<Panel[]>([]);
  const [observedAt, setObservedAt] = useState<string>("");
  const [digest, setDigest] = useState<Digest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const generationId = ++generation.current;
    try {
      const next = await getPanels();
      if (generationId !== generation.current) return;
      setPanels(next.panels);
      setObservedAt(next.observedAt);
      setError(null);
    } catch (cause) {
      if (generationId !== generation.current) return;
      const message = cause instanceof Error ? cause.message : String(cause);
      if (/401|operator token required/i.test(message)) setAuthed(false);
      else setError(message);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getSession()
      .then((session) => {
        if (cancelled) return;
        setAuthed(session.authenticated);
        if (session.authenticated) void load();
      })
      .catch(() => {
        if (!cancelled) setAuthed(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    if (!authed) return;
    const close = openStream(setDigest);
    const poll = setInterval(() => void load(), 30_000);
    return () => {
      close();
      clearInterval(poll);
    };
  }, [authed, load]);

  async function submit(token: string) {
    setBusy(true);
    setError(null);
    try {
      await login(token);
      setAuthed(true);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    try {
      await logout();
    } catch {
      /* the cookie is cleared by the server response either way */
    }
    setDigest(null);
    setPanels([]);
    setAuthed(false);
  }

  return { authed, panels, observedAt, digest, error, busy, submit, signOut, refresh: load };
}

function LiveStrip({ digest }: { digest: Digest | null }) {
  if (!digest || digest.ok !== true) {
    return (
      <div className="note">
        Live digest: {digest?.message ?? "waiting for the first stream frame"} — the table below is
        from the last full read.
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {(digest.tiles ?? []).slice(0, 7).map((tile) => (
        <span key={tile.label} className="inline-flex items-center gap-1.5 rounded-md border border-edge-soft bg-panel-2 px-2 py-1">
          <span className="eyebrow">{tile.label}</span>
          <VerdictBadge verdict={tile.verdict} />
          <span className="value text-[11px]">{tile.value === undefined ? "—" : String(tile.value)}</span>
        </span>
      ))}
    </div>
  );
}

export default function App() {
  const cc = useConsole();
  const [active, setActive] = useState("overview");

  const panel = useMemo(
    () => cc.panels.find((candidate) => candidate.id === active) ?? null,
    [cc.panels, active],
  );

  if (cc.authed === null) {
    return <div className="flex min-h-screen items-center justify-center note">Checking the local session…</div>;
  }
  if (cc.authed === false) {
    return <TokenGate onSubmit={cc.submit} busy={cc.busy} error={cc.error} />;
  }

  return (
    <div className="shell-grid">
      <aside className="flex min-h-0 flex-col border-r border-edge-soft bg-deep/80 p-4">
        <div className="px-1">
          <div className="eyebrow">Conway Automaton</div>
          <div className="mt-1 text-[13px] font-semibold leading-snug tracking-wide text-frost">AI COMMAND CENTER</div>
          <div className="note mt-2">
            Agent inactive by design. This console reads; it cannot start, fund, migrate, seal,
            engage or repair.
          </div>
        </div>
        <nav className="mt-4 min-h-0 flex-1 space-y-1 overflow-y-auto" aria-label="Command center areas">
          {cc.panels.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="nav-item"
              aria-current={entry.id === active ? "page" : undefined}
              onClick={() => setActive(entry.id)}
            >
              {AREA_LABELS[entry.id] ?? entry.title}
            </button>
          ))}
        </nav>
        <div className="mt-3 border-t border-edge-soft pt-3">
          <button type="button" className="btn w-full" onClick={() => void cc.signOut()}>
            Lock console
          </button>
        </div>
      </aside>

      <main className="min-h-0 overflow-y-auto">
        <header className="sticky top-0 z-10 border-b border-edge-soft bg-abyss/85 px-6 py-4 backdrop-blur">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-[15px] font-semibold tracking-wide text-frost">
                CONWAY AUTOMATON / AI COMMAND CENTER
              </h1>
              <div className="note mt-1">
                every value below originates from a read-only observation of the live install
              </div>
            </div>
            <div className="text-right">
              <div className="eyebrow">Snapshot</div>
              <div className="value mt-1 text-[11px]">{cc.observedAt || "—"}</div>
              <button type="button" className="btn mt-2" onClick={() => void cc.refresh()}>
                Re-read
              </button>
            </div>
          </div>
          <div className="mt-3">
            <LiveStrip digest={cc.digest} />
          </div>
        </header>

        <div className="space-y-4 p-6">
          {cc.error ? (
            <div className="card border-crimson/40 p-4 text-[12px] text-crimson">{cc.error}</div>
          ) : null}
          {cc.panels.length === 0 ? (
            <div className="card p-4 note">Reading the live database…</div>
          ) : null}

          {panel ? (
            <>
              <div className="card p-4">
                <h2 className="text-[15px] font-semibold text-frost">{panel.title}</h2>
                <p className="note mt-1">{panel.subtitle}</p>
              </div>
              <EvidenceChart panel={panel} />
              {panel.id === "health" ? <HealthCheckButton /> : null}
              {panel.id === "backup" ? (
                <>
                  <VerifyBackupsButton />
                  <RestoreForm />
                </>
              ) : null}
              <PanelView panel={panel} />
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}
