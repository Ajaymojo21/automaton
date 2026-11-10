# Dashboard and API Verification

- Date: 2026-11-10
- URL: `http://127.0.0.1:8787`
- Server: `dashboard/server/index.ts`; UI: `dashboard/src/App.tsx`
- Desktop shortcut: `Conway Automaton Control Center.lnk` (present on the Desktop)
- Result: browser acceptance PASS across 13 areas, 0 console errors, 0 page errors, 0 unexpected
  failed requests (the one expected SSE abort on "Lock console" is filtered)

## 1. Areas (13)

| # | Id | Label |
|---|---|---|
| 1 | `overview` | Overview |
| 2 | `agent` | AI Agent |
| 3 | `models` | AI Models |
| 4 | `wallet` | Wallet |
| 5 | `treasury` | Treasury |
| 6 | `security` | Security Center |
| 7 | `health` | Health Monitor |
| 8 | `self-healing` | Self-Healing |
| 9 | `logs` | Activity Logs |
| 10 | `backup` | Backup & Recovery |
| 11 | `controls` | System Controls |
| 12 | `settings` | Settings |
| 13 | `repair-approvals` | Repair Approvals |

The panel registry (`dashboard/server/panels/index.ts:9-23`) and the UI label map
(`dashboard/src/App.tsx:10-24`) agree, and `GET /api/panels` returned all 13 in the live probe.

## 2. Authentication

- `POST /api/auth` accepts the operator token and sets `conway_cc_session` with `HttpOnly` and
  `SameSite=Strict` (`dashboard/server/security.ts:83-84`), Max-Age 28800.
- Every `/api/` route except `/api/auth` requires the session; `/api/stream` returns 401 without it
  (`dashboard/server/index.ts:31-39`).
- `POST /api/logout` clears the cookie and returns the console to the token gate.
- The browser harness verified unlock, navigation, lock and unlock again. The token was read
  in-process and never printed.

## 3. API surface

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/session` | Session state |
| GET | `/api/panels` | All 13 panels |
| GET | `/api/panels/{id}` | One panel |
| GET | `/api/health` | Guardian report |
| GET | `/api/system` | Host metrics |
| GET | `/api/stream` | SSE digest, 15 s tick (`dashboard/server/stream.ts:52`) |
| POST | `/api/auth`, `/api/logout` | Session |
| POST | `/api/action/health-check` | Run guardian over a read-only handle; persist a new report |
| POST | `/api/action/verify-backups` | Re-hash archives against manifests |
| POST | `/api/action/restore` | Two-stage copy-restore (plan, then execute) |
| POST | `/api/action/repair-propose` | Create a non-executing repair proposal |
| GET | `/api/repair-approvals` | List proposals (optional `?status=`) |
| GET | `/api/repair-approval/{id}` | Read one proposal |
| POST | `/api/repair-approval/{id}/approve` | Approve, non-executing |
| POST | `/api/repair-approval/{id}/reject` | Reject |

Every mutation requires the session and mutation headers, is rate-limited in the `action` bucket, and
appends a redacted line to `dashboard/logs/audit-<YYYY-MM-DD>.jsonl`.

## 4. Observed live behaviour

- Health action result: `16 checks, overall blocked, persisted to dashboard/state`.
- Backup verification: `9/10 archive(s) carry a manifest · 28 archived file(s) match, 6 live-file
  entry(ies) match, 0 problem(s)`.
- Health panel: guardian headline `blocked (as reported)` with the explanation that a source was
  absent; a separate informational reading `degraded` for the 13 checks that had a source; 4 cells
  showing an exact `blocked` verdict.
- No "seals failed" text; the wallet row reads "no wallet on disk".
- Evidence posture counters render (VERIFIED / EMPTY / UNKNOWN / NOT VERIFIED / NOT APPLICABLE).
- The SSE digest left "waiting for the first stream frame" in 3.8-14.6 s across runs and settled.
- Lock console returned to `#operator-token`; unlock worked again.

## 5. Controls that must not exist

Probes of nine dangerous routes all returned 404 or 405 (`allRejected: true`):

```
POST /api/action/start-agent      POST /api/action/activate
POST /api/agent/start             POST /api/run
POST /api/action/migrate-schema   POST /api/action/provision
POST /api/wallet/create           POST /api/action/fund
POST /api/action/repair-execute
```

The System Controls area states this explicitly: START / STOP / RESTART / ACTIVATE / CREATE WALLET /
FUND / ENABLE FINANCIAL TOOLS / ENABLE REPLICATION / ENABLE SELF-HEALING / ENGAGE EMERGENCY STOP /
MIGRATE SCHEMA "do not exist as endpoints".

## 6. Exposure and response headers

- Bind address is hard-coded to `127.0.0.1` (`dashboard/server/paths.ts:31`); the server refuses any
  other host (`dashboard/server/index.ts:69`) and refuses port 3001 (`FORBIDDEN_PORTS`).
- LAN probe `http://10.123.203.198:8787/api/session` returned `ECONNREFUSED`; loopback returned 200.
- Every response, including errors, carries:
  - `content-security-policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`
  - `x-content-type-options: nosniff`
  - `referrer-policy: no-referrer`

## 7. Screenshots and logs

- `runtime/tmp/s5-shots/overview.png`
- `runtime/tmp/s5-shots/health.png`
- `runtime/tmp/s5-shots/backup.png`
- `runtime/tmp/s5-browser.log` (PASS, 13 areas, `restoreGate {empty:true, wrongConfirmation:true,
  matchingConfirmation:false}`, `lockConsole:true`)
- `runtime/tmp/s5-live.log` (13 panels, auth wall, forbidden endpoints, `allRejected:true`)

## 8. Honest limits

- The dashboard reports `blocked` for the guardian because the live database is V11; after an
  approved V14 migration that headline should change. The dashboard itself is not broken.
- Dashboard health is not agent health. The agent was never started; its state is `UNKNOWN — never
  started`, and the UI says so.
- The persisted health file was stale by 14087 minutes at the last observation. The dashboard reports
  that staleness instead of hiding it or refreshing it silently.
