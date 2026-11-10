# Dashboard API reference — Conway Automaton AI Command Center

Scope: `dashboard/server/`. Every endpoint is served by one process, bound to
`127.0.0.1:8787` (or `CONWAY_DASHBOARD_PORT`). There is no remote API, no LAN listener and no
second host. Paths below are relative to that origin.

## Conventions

| Item | Value |
|---|---|
| Success envelope | `{"ok": true, …}` |
| Error envelope | `{"ok": false, "verdict": "NOT VERIFIED", "message": "<reason>"}` |
| Verdict vocabulary | `VERIFIED`, `EMPTY`, `UNKNOWN`, `NOT VERIFIED`, `NOT APPLICABLE` |
| Max request body | 8 KiB (`readBody` destroys the socket above it) |
| Content type | `application/json` required on every POST; otherwise **415** |
| Unknown path under `/api/` | **404** `no such endpoint` (no stack, no internal path) |
| Non-GET on a static path | **405** `method not allowed` |

`verdict` is part of the payload, not the HTTP status: a **200** can carry
`NOT VERIFIED` cells, because "we read the source and could not prove the value" is a
successful observation of an unprovable area.

## Request gates (applied to every `/api/*` call, including `/api/stream`, in this order)

1. **Origin / CSRF** — `isTrustedRequest(method, headers)`. A `GET`/`HEAD` may omit `Origin`,
   but a present `Origin` must equal the console's own exactly; `GET`/`HEAD` is the only method
   that may omit it. Every **mutation** must name that origin, and additionally requires the
   opt-in header `X-Conway-request: 1`; a `Referer`, when sent, must parse to the same origin.
   `Origin: null` (an opaque origin from a sandboxed frame, `data:` or `file:` URL), a
   foreign origin, a malformed value, a duplicated header and a prefix-spoofed `Referer` are all
   refused. A cross-site page cannot set a custom header on a simple form post, so a blind `POST`
   is refused. Failure: **403** `cross-origin request refused`.
2. **Rate limit** — 40 requests/minute per `ip:class`, where class is `action` for
   `/api/action/*` and `read` otherwise. The two buckets are separate, so log spam cannot
   starve the operator's reads. Failure: **429** with `retry-after` in seconds.
3. **Authentication** — see below. Only `GET /api/health` and `GET /api/session` answer
   unauthenticated; every other endpoint, including `/api/stream`, returns **401**
   `operator token required`.

## Authentication

```
POST /api/auth        {"token": "<43-char base64url from dashboard/state/dashboard.token>"}
```
Requires `X-Conway-request: 1` + same origin (it is a mutation). Compares with
`crypto.timingSafeEqual`. On success sets:

```
Set-Cookie: conway_cc_session=<sid>; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800
```

The token itself is never returned, never logged and never stored in the session record.
`GET /api/session` reports only `authenticated` — never the token, its length, or the session
count. A request that presents no credential is answered without touching any credential
material, so the probe is safe before login.

`Authorization: Bearer <token>` is accepted for non-browser clients.

Sessions live in memory, capped at 32, and are bound to the peer address that created them —
a session id replayed from another address is rejected. **Restarting the server invalidates
every cookie** (deliberate: there is no session state on disk to steal).

```
POST /api/logout      revokes the server-side session, then clears the cookie (Max-Age=0)
```

Revocation deletes the session from the server's store before the cookie is cleared, so a copy
of the cookie taken earlier stops authenticating immediately. Any open `/api/stream` attached to
that session is closed at the same moment. Repeating the call, or calling it with no cookie,
returns `200` — a repeated logout is a no-op, not an error.

## Read endpoints

| Method + path | Auth | Body |
|---|---|---|
| `GET /api/health` | no | `{ok, verdict:"VERIFIED", pid, observedAt}` — liveness only, no Conway data |
| `GET /api/session` | no | `{ok, authenticated}` |
| `GET /api/panels` | yes | `{ok, observedAt, panels: Panel[]}` — all 13 areas in the mandated order (12 mandated areas plus Repair Approvals) |
| `GET /api/panel/{id}` | yes | `{ok, observedAt, panel: Panel}` — `id` must satisfy `isPanelId` |
| `GET /api/system` | yes | `{ok, observedAt, ids, home, db}` — panel registry plus which handle was opened |
| `GET /api/stream` | yes | `text/event-stream` — one `snapshot` frame every 15 s while a client is attached |
| `GET /api/repair-approvals` | yes | `{ok, verdict, count, proposals}` — optional `?status=` filter; store absence is `200` with `absent:true`, never a failure |

Panel ids: `overview`, `agent`, `models`, `wallet`, `treasury`, `security`, `health`,
`self-healing`, `logs`, `backup`, `controls`, `settings`, `repair-approvals`.

### Cell

Every value the console displays is a `Cell`:

```ts
{ verdict: Verdict; value?: unknown; note?: string; source: string; observedAt: string }
```

`source` is mandatory and is the Conway module, table, file or command the value came from.
A cell with no possible observation renders `UNKNOWN` with `value` omitted — never a default,
never a zero.

### Panel

```ts
{ id, title, subtitle, sections: Array<{
    title, layout: "metrics" | "table" | "notice" | "list",
    cells?: Array<{ label, cell }>,
    table?: { columns: string[], rows: CellValue[][] },
    notice?: { level: "danger" | "warn" | "info", text },
    list?: Array<{ label, value }>,
    note? }> }
```

### Digest (`/api/stream` frame)

A projection of the same snapshot as `overviewPanel`, so a stream tile can never disagree with
its own detail page:

```ts
{ ok: true, observedAt, home, health, agentState, activation, emergencyStop, wallet,
  incidents, tiles: Array<{ label, verdict, value? }> }
```

If the snapshot build throws, the frame is `{ok:false, verdict:"NOT VERIFIED", message}` — the
client keeps the last full read and says so.

## Action endpoints

Each POST requires the mutation headers, is rate-limited in the `action` bucket, and appends a
redacted line to `dashboard/logs/audit-<YYYY-MM-DD>.jsonl`. None of them can start, activate,
fund, migrate, seal, engage or repair the agent.

### `POST /api/action/health-check`

Runs the pinned Conway guardian over the **read-only** handle and persists a new
`dashboard/state/health-<stamp>.json` (`wx` — it will not overwrite an earlier report).
Returns `{ok:true, action:"health-check", verdict:<overall>, summary, data:<report>}`.
Observed live on 2026-11-10: `16 checks, overall blocked, persisted to dashboard/state` — the
`blocked` state means three checks had no source (the V11 database has no `security_events` or
`treasury_authorizations` table); it is not a failure and is shown as such.

### `POST /api/action/verify-backups`

Re-hashes every file in `backups/` against its own manifest. Read-only with respect to Conway
state; it never opens a backup database (a WAL copy would gain a fresh `-shm` sibling).
Observed live: `9/10 archive(s) carry a manifest · 28 archived file(s) match, 6 live-file
entry(ies) match, 0 problem(s)`.

### `POST /api/action/restore`

Two-stage, and the stages are separate requests.

```
stage 1  {"name":"<backup dir>","confirm":"<same string>"}
stage 2  {"name":"<backup dir>","confirm":"<same string>","execute":true}
```

Stage 1 (`planRestore`) validates, then verifies. It refuses: a name that is empty, longer than
200 characters, or contains `/`, `\`, or is exactly `.`/`..`; a confirmation that is not
character-identical to the name; an archive with no manifest; any archive whose files do not all
hash-match; an archive whose only matches are working-tree (repo-relative) references; and any
target inside `runtime/home/.automaton`. On success:

```json
{"ok":true,"verdict":"VERIFIED","stage":"plan",
 "plan":{"ok":true,"verdict":"VERIFIED","summary":"3 verified archive file(s) will be copied to a new directory",
         "sourceDir":"<repo-root>\\backups\\<name>",
         "target":"<repo-root>\\dashboard\\restore-targets\\<name>--<stamp>",
         "files":["phase15-penetration.test.ts","…"]}}
```

`files` is a **list of relative paths**, not a count.

Stage 2 (`executeConfirmedRestore`) does **not** re-plan: it consumes the plan the operator was
just shown, so the directory written is the directory that was confirmed. It re-verifies the
bytes first, refuses if the target already exists, and refuses a second execution of a consumed
plan. Success:

```json
{"ok":true,"action":"restore","verdict":"VERIFIED",
 "summary":"copied 3 file(s) to <target>. The live database was not touched.",
 "data":{"target":"<target>"}}
```

The copied directory contains `RESTORE-NOTE.txt` naming the source archive, the target and the
file list. Promoting a restored copy into `runtime/home/.automaton` stays a manual operator
action; no dashboard code path can do it.

### Repair approval endpoints (B-8)

These operate on `dashboard/state/repair-approvals.db`, a store separate from Conway state. The
guarantee they implement: **an approval never executes a repair.** Approval moves a proposal to
`ready_for_execution` and stops there; it does not start the agent, scheduler, heartbeat, shell,
financial tools or self-healing.

```
POST /api/action/repair-propose
  {"findingId","component","rootCause","proposedAction","riskClassification"}
  → 200 {ok:true, proposal}   (validates the four required string fields)

GET  /api/repair-approvals[?status=awaiting_approval|ready_for_execution|rejected]
  → 200 {ok:true, verdict:"VERIFIED", count, proposals}

GET  /api/repair-approval/{id}
  → 200 {ok:true, proposal, events} | 404 proposal not found

POST /api/repair-approval/{id}/approve   (or /reject)
  {"identity","reason","expectedRevision?","idempotencyKey?"}
  → 200 {ok:true, proposal} | 400 {ok:false, verdict:"NOT VERIFIED", message}
```

`expectedRevision` makes the decision compare-and-swap (a stale revision is refused), and
`idempotencyKey` makes a retried decision replay the first outcome instead of appending a second
event. Every decision is audited with the actor-supplied identity and never includes key material.

## Response headers (every response, including errors)

```
content-security-policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
                         img-src 'self' data:; connect-src 'self'; font-src 'self';
                         object-src 'none'; base-uri 'none'; frame-ancestors 'none';
                         form-action 'self'
x-content-type-options:  nosniff
referrer-policy:         no-referrer
```

`style-src … 'unsafe-inline'` is the one relaxed directive, and it is the one that cannot be
avoided with a bundled SPA: the build injects `<style>` blocks at runtime. It does not permit
inline **script** — `script-src 'self'` with no `unsafe-inline`/`unsafe-eval` means a
cross-site string can never become executable here.

"Every response" was earned, not assumed. The first live probe (`curl -D -` over
`/`, `/index.html`, `/api/health`, a traversal-shaped path, an unknown dotted path and
`/api/panels`) showed the static and plain-text paths serving **without** `referrer-policy`, and the
not-built fallback without CSP: the headers existed only inside `sendJson`. They now come from one
exported `BASE_HEADERS` spread into all four response sites, and
`dashboard/tests/response-headers.test.ts` pins it. If you ever add a new `writeHead` call, use
`BASE_HEADERS` — a doc that describes the intent while the code implements part of it is worse than
no doc, because the next reader trusts it.

Static files come from `dashboard/dist/` only; unknown paths that contain a dot are 404, and any
other GET falls back to `index.html` for the SPA router.

## What this API cannot be asked to do

There is no endpoint that executes a command, no path parameter that reaches the filesystem
outside `backups/` → `dashboard/restore-targets/`, no endpoint that writes Conway state, and no
endpoint that returns a config value it has not read from a named source. The only subprocess
the whole console spawns is `tasklist`, with a fixed argv array and no shell.
