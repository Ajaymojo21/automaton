import { describe, expect, it } from "vitest";
import { isSecretKey, redact, redactJson } from "../server/redact.js";

/** Mandate §17: "Never display private keys, seed phrases, passwords, recovery secrets." The
 *  audit log is the one place the console writes, so redaction is tested as a boundary. */

describe("key-name redaction", () => {
  it("drops values whose key names a credential", () => {
    for (const key of ["openaiApiKey", "conwayApiKey", "passphrase", "privateKeyPem", "authorization", "seed", "token"]) {
      expect(isSecretKey(key), key).toBe(true);
      expect((redact({ [key]: "hunter2hunter2" }) as Record<string, unknown>)[key]).toBe("[redacted:key]");
    }
  });

  it("keeps ordinary operational keys", () => {
    for (const key of ["address", "verdict", "rows", "generatedAt", "chainType"]) {
      expect(isSecretKey(key), key).toBe(false);
    }
    expect(redact({ rows: 12, address: "0xabc" })).toEqual({ rows: 12, address: "0xabc" });
  });
});

describe("value-shape redaction", () => {
  it("scrubs key-shaped strings, PEM blocks, raw 32-byte hex and JWTs", () => {
    expect(String(redact("use sk-proj-AbCdEfGhIjKlMnOp next"))).toContain("[redacted:key-shaped]");
    expect(String(redact("-----BEGIN PRIVATE KEY-----\nQUFC\n-----END PRIVATE KEY-----"))).toContain("[redacted:pem]");
    expect(String(redact(`0x${"a".repeat(64)}`))).toContain("[redacted:32-byte-hex]");
    expect(String(redact(`eyJ${"a".repeat(12)}.bbbbbb.cccccc`))).toContain("[redacted:jwt]");
  });

  it("walks nested objects and arrays, and stops at the depth limit", () => {
    const nested = redact({ a: { b: [{ api_key: "sk-abcdefghijklmnop" }] } }) as {
      a: { b: Array<Record<string, unknown>> };
    };
    expect(nested.a.b[0]?.api_key).toBe("[redacted:key]");
    let cursor: unknown = { leaf: "x" };
    for (let i = 0; i < 12; i += 1) cursor = { n: cursor };
    expect(JSON.stringify(redact(cursor))).toContain("[truncated:depth]");
  });

  it("never lets a secret survive as a substring of a longer note", () => {
    const line = JSON.stringify({ detail: "rotation failed for key sk-abcdefghijklmnop in vault" });
    const scrubbed = redactJson(line);
    expect(scrubbed).not.toContain("sk-abcdefghijklmnop");
    expect(scrubbed).toContain("[redacted:key-shaped]");
  });
});
