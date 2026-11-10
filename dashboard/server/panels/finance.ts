import { empty, notApplicable, notVerified, observed, unknown, type Cell } from "../values.js";
import { countCell, type Snapshot } from "../state.js";
import { DEFAULT_TREASURY_POLICY } from "../../../src/types.js";
import type { Panel } from "./types.js";

export function walletPanel(s: Snapshot): Panel {
  const exists = s.wallet.exists === true;
  const file = s.wallet.file as { path: string; exists: boolean; bytes: number | null; mtimeIso: string | null; sha256: string | null };
  return {
    id: "wallet",
    title: "Wallet",
    subtitle: "Existence and location only — key material is never read into this console",
    sections: [
      {
        title: "Status",
        layout: "metrics",
        cells: [
          {
            label: "Wallet",
            cell: exists
              ? observed("present", "src/identity/wallet.ts:walletExists()")
              : observed("NO WALLET CONFIGURED", "src/identity/wallet.ts:walletExists()"),
          },
          {
            label: "Address",
            cell: exists && s.wallet.address
              ? observed(String(s.wallet.address), "src/identity/wallet.ts:getWalletAddress()")
              : unknown("getWalletAddress()", "no wallet — an address cannot exist"),
          },
          {
            label: "Chain type",
            cell: observed(
              String(s.wallet.chainType),
              "deliberate omission of getWalletChainType()",
              "getWalletChainType() returns \"evm\" as a default when no wallet exists, which is indistinguishable from a real EVM wallet, so the dashboard does not call it.",
            ),
          },
          {
            label: "wallet.json",
            cell: exists
              ? observed(file.path ?? "", "filesystem", `${file.bytes} bytes, sha256 ${String(file.sha256 ?? "").slice(0, 12)}…`)
              : observed("absent", "filesystem", "existence=false is itself a verified observation"),
          },
          {
            label: "Path agreement",
            cell: s.wallet.pathAgreement
              ? observed(true, "HOME-pinned vs constant", "both derivations of the wallet path agree")
              : notVerified("HOME-pinned vs constant", "the two derivations disagree — refusing to report existence"),
          },
        ],
      },
      {
        title: "Balances",
        layout: "metrics",
        cells: [
          { label: "Balance / USD", cell: unknown("no source", "UNKNOWN — wallet not provisioned; no network path is configured and none is opened") },
          { label: "On-chain transactions", cell: countToCell(countCell(s, "onchain_transactions"), "onchain_transactions") },
          { label: "Local transactions", cell: countToCell(countCell(s, "transactions"), "transactions") },
        ],
      },
      {
        title: "Prohibitions in force",
        layout: "list",
        list: [
          { label: "Wallet creation", value: "refused — getWallet() generates a key and writes an encrypted file when wallet.json is absent" },
          { label: "Funding", value: "refused — §29 items 4 and 5" },
          { label: "Private key / seed phrase / passphrase", value: "never read, never rendered, never logged" },
          { label: "Passphrase env gate", value: envPresence(s, "CONWAY_ALLOW_WALLET_CREATION") },
        ],
      },
    ],
  };
}

export function treasuryPanel(s: Snapshot): Panel {
  const raw = s.config.raw ?? {};
  const config = s.config.config;
  const policy = (config?.treasuryPolicy ?? {}) as Record<string, unknown>;
  const rawPolicy = ((raw.treasuryPolicy ?? {}) as Record<string, unknown>) ?? {};
  const defaults = DEFAULT_TREASURY_POLICY as unknown as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(defaults), ...Object.keys(policy)])].sort();
  return {
    id: "treasury",
    title: "Treasury",
    subtitle: "Declared limits versus enforced limits versus spend history",
    sections: [
      {
        title: "Policy — declared versus effective",
        layout: "table",
        note: "R-21: loadConfig() spreads DEFAULT_TREASURY_POLICY under the operator's file, so a lockdown config silently inherits non-zero limits. The columns separate what automaton.json actually says from what the merged object exposes.",
        table: {
          columns: ["key", "declared in automaton.json", "effective value", "source"],
          rows: keys.map((key) => [
            key,
            Object.prototype.hasOwnProperty.call(rawPolicy, key) ? "yes" : "no",
            String((policy as Record<string, unknown>)[key] ?? defaults[key] ?? "—"),
            Object.prototype.hasOwnProperty.call(rawPolicy, key) ? "automaton.json" : "code default",
          ]),
        },
      },
      {
        title: "Enforcement state",
        layout: "metrics",
        cells: [
          {
            label: "Lockdown",
            cell: observed(config?.security?.lockdown ?? null, "automaton.json security.lockdown", "the gate that denies every tool not explicitly allowed"),
          },
          { label: "Allowed tools", cell: observed(config?.security?.allowedTools?.length ?? 0, "security.allowedTools", "an empty list is the intended posture, not a gap") },
          {
            label: "Authorization ledger",
            cell: countCell(s, "treasury_authorizations").verdict === "NOT VERIFIED"
              ? notVerified("treasury_authorizations", "table absent (V12) — getTreasuryGuard() throws, so reserved/committed totals cannot be read")
              : countToCell(countCell(s, "treasury_authorizations"), "treasury_authorizations"),
          },
          { label: "Spend tracking", cell: countToCell(countCell(s, "spend_tracking"), "spend_tracking") },
          { label: "Policy decisions", cell: countToCell(countCell(s, "policy_decisions"), "policy_decisions") },
        ],
      },
      {
        title: "What this area will never do",
        layout: "notice",
        notice: {
          level: "danger",
          text: "TreasuryGuard.authorize/commit/release, wallet funding and blockchain transactions are not reachable. They are writes against live state and §29 items 8 and 9 forbid them without approval.",
        },
      },
    ],
  };
}

function countToCell(
  count: { verdict: "VERIFIED" | "EMPTY" | "NOT VERIFIED"; rows: number | null; note: string },
  table: string,
): Cell {
  if (count.verdict === "NOT VERIFIED") return notVerified(table, count.note);
  if (count.verdict === "EMPTY") return empty(0, table, count.note);
  return observed(count.rows ?? 0, table, count.note);
}

function envPresence(s: Snapshot, key: string): Cell {
  const gates = (s.activation.envGates as Array<{ key: string; present: boolean }>) ?? [];
  const found = gates.find((gate) => gate.key === key);
  if (!found) return notApplicable("process.env", `${key} is not part of the gate board`);
  return observed(found.present ? "present" : "absent", "process.env key name", "presence by name only — the value is never read");
}
