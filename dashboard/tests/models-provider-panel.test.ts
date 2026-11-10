import { describe, expect, it } from "vitest";
import { buildSnapshot } from "../server/state.js";
import { modelsPanel } from "../server/panels/core.js";
import type { Cell } from "../server/values.js";
import { validateProviderBaseUrl } from "../../src/inference/provider-url.js";

/** Phase 20 §9 — the AI Models panel has to say what it actually knows.
 *  F-20-08 was that it rendered nothing about the provider registry, so a reader could not tell
 *  FreeLLMAPI registration apart from an empty configuration. These assertions pin the three
 *  properties that make the panel trustworthy: it reports registration and URL validity (which
 *  it can compute read-only), it refuses to imply reachability or real inference (which it has
 *  not tested), and it never emits a credential value. */

const snapshot = await buildSnapshot();
const panel = modelsPanel(snapshot);
const serialized = JSON.stringify(panel);

function section(title: string) {
  const found = panel.sections.find((entry) => entry.title === title);
  if (!found) throw new Error(`no section titled "${title}"`);
  return found;
}

function metric(label: string): Cell {
  const found = section("Reachability, real inference, activation")
    .cells?.find((entry) => entry.label === label);
  if (!found) throw new Error(`no metric labelled "${label}"`);
  return found.cell;
}

describe("provider registration is visible", () => {
  it("lists every provider declared in inference-providers.json", () => {
    const rows = section("Provider registry (inference-providers.json)").table?.rows ?? [];
    expect(rows.map((row) => row[0])).toEqual(snapshot.providers.rows.map((row) => row.id));
    expect(snapshot.providers.rows.map((row) => row.id)).toContain("freellmapi");
  });

  it("shows only endpoints that pass the shipped validator", () => {
    const rows = section("Provider registry (inference-providers.json)").table?.rows ?? [];
    for (const row of rows) {
      const [id, shown, verdict] = row as string[];
      if (verdict === "valid") {
        expect(validateProviderBaseUrl(shown, id)).toBe(shown);
      } else {
        expect(shown).toBe("(not shown)");
      }
    }
  });

  it("names the file it read, so the claim is checkable", () => {
    expect(section("Provider registry (inference-providers.json)").note).toContain(
      snapshot.providers.meta.path,
    );
  });
});

describe("untested is not shown as tested", () => {
  it("reachability and real inference are NOT VERIFIED", () => {
    expect(metric("Endpoint reachability").verdict).toBe("NOT VERIFIED");
    expect(metric("Real inference").verdict).toBe("NOT VERIFIED");
  });

  it("nothing unmeasured is shown as VERIFIED", () => {
    const unmeasured = panel.sections
      .flatMap((entry) => entry.cells ?? [])
      .filter((entry) => entry.cell.verdict === "VERIFIED" && entry.cell.source === "no source");
    expect(unmeasured.map((entry) => entry.label)).toEqual([]);
    expect(serialized).not.toMatch(/healthy/i);
    expect(serialized).not.toMatch(/online/i);
  });

  it("activation status is reported from the gate, not assumed", () => {
    const cell = metric("Agent activation");
    expect(cell.value).toBe(snapshot.activation.approved === true ? "approved" : "not approved");
    expect(cell.source).toContain("security.activationApproved");
  });
});

describe("credential values are never displayed", () => {
  it("env var names appear, values never", () => {
    expect(serialized).toContain("FREELLMAPI_API_KEY");
    for (const row of snapshot.providers.rows) {
      const value = row.apiKeyEnvVar ? process.env[row.apiKeyEnvVar] : undefined;
      if (typeof value === "string" && value.length > 0) {
        expect(serialized).not.toContain(value);
      }
    }
  });

  it("no embedded userinfo survives into the panel", () => {
    expect(serialized).not.toMatch(/\/\/[^"]*:[^"@]*@/);
  });
});
