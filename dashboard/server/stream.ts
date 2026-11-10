import type { ServerResponse } from "node:http";
import { buildSnapshot } from "./state.js";
import { overviewDigest } from "./digest.js";
import { onSessionRevoked, sessionIsLive } from "./security.js";

interface Client {
  res: ServerResponse;
  ip: string;
  /** null when the client authenticated with the bearer token instead of a session cookie. */
  sid: string | null;
}

const clients = new Set<Client>();
let timer: NodeJS.Timeout | null = null;
const DEFAULT_INTERVAL_MS = 15_000;

/** A logout must close streams that session already opened: otherwise the cookie stops
 *  authenticating new requests while the existing EventSource keeps receiving snapshots. */
onSessionRevoked((sid) => {
  for (const client of clients) {
    if (client.sid !== sid) continue;
    try {
      client.res.end();
    } catch {
      /* already gone */
    }
    clients.delete(client);
  }
});

export function addClient(res: ServerResponse, ip: string, sid: string | null): () => void {
  const client: Client = { res, ip, sid };
  clients.add(client);
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.write(": connected\n\n");
  return () => {
    clients.delete(client);
  };
}

export function clientCount(): number {
  return clients.size;
}

export function startStream(intervalMs = Number(process.env.CONWAY_DASHBOARD_POLL_MS ?? DEFAULT_INTERVAL_MS)): void {
  if (timer) return;
  const tick = async () => {
    if (clients.size === 0) return;
    let payload: string;
    try {
      const snapshot = await buildSnapshot();
      payload = JSON.stringify(overviewDigest(snapshot));
    } catch (cause) {
      payload = JSON.stringify({ ok: false, verdict: "NOT VERIFIED", message: cause instanceof Error ? cause.message : String(cause) });
    }
    for (const client of clients) {
      // Re-checked every tick as well as on revocation: expiry and peer rebinding also end a
      // session, and a stream attached before either must not outlive it.
      if (client.sid !== null && !sessionIsLive(client.sid, client.ip)) {
        try {
          client.res.end();
        } catch {
          /* already gone */
        }
        clients.delete(client);
        continue;
      }
      try {
        client.res.write(`event: snapshot\ndata: ${payload}\n\n`);
      } catch {
        clients.delete(client);
      }
    }
  };
  timer = setInterval(() => {
    void tick();
  }, Math.max(5_000, intervalMs));
  timer.unref();
}

export function stopStream(): void {
  if (timer) clearInterval(timer);
  timer = null;
  for (const client of clients) {
    try {
      client.res.end();
    } catch {
      /* already gone */
    }
  }
  clients.clear();
}
