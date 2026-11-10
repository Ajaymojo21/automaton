/**
 * B-6 — the logger is the last line of defence for secrets.
 *
 * Call sites are expected not to log credentials; these tests prove that a call site
 * which forgets still cannot write the secret to any sink.
 */

import { afterEach, describe, expect, it } from "vitest";
import { StructuredLogger } from "../../observability/logger.js";
import type { LogEntry } from "../../types.js";

let entries: LogEntry[] = [];

function capture(): void {
  entries = [];
  StructuredLogger.setSink((entry) => entries.push(entry));
}

afterEach(() => {
  StructuredLogger.resetSink();
});

describe("logger redaction (B-6)", () => {
  it("redacts credential-shaped context keys", () => {
    capture();
    const logger = new StructuredLogger("test", "debug");
    logger.info("provider configured", {
      apiKey: "sk-live-should-never-appear",
      api_key: "another-secret",
      Authorization: "Basic abc123",
      privateKey: "0xdeadbeef",
      seedPhrase: "alpha beta gamma",
      password: "hunter2",
      model: "gpt-oss:120b",
      endpoint: "https://api.example.com",
    });

    const context = entries[0].context as Record<string, unknown>;
    expect(context.apiKey).toBe("[REDACTED]");
    expect(context.api_key).toBe("[REDACTED]");
    expect(context.Authorization).toBe("[REDACTED]");
    expect(context.privateKey).toBe("[REDACTED]");
    expect(context.seedPhrase).toBe("[REDACTED]");
    expect(context.password).toBe("[REDACTED]");
    expect(context.model).toBe("gpt-oss:120b");
    expect(context.endpoint).toBe("https://api.example.com");
    expect(JSON.stringify(entries[0])).not.toContain("sk-live-should-never-appear");
    expect(JSON.stringify(entries[0])).not.toContain("alpha beta gamma");
  });

  it("redacts nested and array-carried secrets", () => {
    capture();
    const logger = new StructuredLogger("test", "debug");
    logger.warn("fan-out", {
      providers: [
        { id: "a", apiKey: "sk-a" },
        { id: "b", headers: { authorization: "Bearer sk-b" } },
      ],
    });

    const text = JSON.stringify(entries[0]);
    expect(text).not.toContain("sk-a");
    expect(text).not.toContain("sk-b");
    expect(text).toContain("[REDACTED]");
    expect(text).toContain('"id":"a"');
  });

  it("redacts bearer tokens and secp256k1 private keys inside free text", () => {
    capture();
    const logger = new StructuredLogger("test", "debug");
    const key = "0x" + "a".repeat(64);
    logger.error(`upstream refused: Authorization: Bearer sk-abcdef123456, signer ${key}`);

    const entry = entries[0];
    expect(entry.message).not.toContain("sk-abcdef123456");
    expect(entry.message).not.toContain(key);
    expect(entry.message).toContain("Bearer [REDACTED]");
    expect(entry.message).toContain("[REDACTED]");
    expect(entry.message).toContain("upstream refused");
  });

  it("redacts secrets carried by an Error message and stack", () => {
    capture();
    const logger = new StructuredLogger("test", "debug");
    const error = new Error("fetch failed for https://user:Bearer sk-secret@api.example.com");
    error.stack = `Error: sk-live-abc123456789\n    at handler (${"0x" + "b".repeat(64)})`;
    logger.error("request failed", error);

    const rendered = JSON.stringify(entries[0]);
    expect(rendered).not.toContain("sk-secret");
    expect(rendered).not.toContain("b".repeat(64));
    expect(rendered).toContain("[REDACTED]");
  });

  it("survives a circular context without throwing and without leaking", () => {
    capture();
    const logger = new StructuredLogger("test", "debug");
    const circular: Record<string, unknown> = { token: "sk-circular" };
    circular.self = circular;

    expect(() => logger.info("circular", circular)).not.toThrow();
    expect(JSON.stringify(entries[0])).not.toContain("sk-circular");
  });
});
