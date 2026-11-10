/**
 * B-5 — a signed payment must never be sent twice.
 *
 * x402Fetch owns an EVM signing step that cannot be exercised without a key, so this
 * suite pins the invariant at the only place it is decided: the transport options on the
 * post-signature request. The transport behaviour itself (retries: 0 = exactly one
 * attempt, even for a retryable status) is covered behaviourally in http-client.test.ts.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(
  path.join(process.cwd(), "src", "conway", "x402.ts"),
  "utf-8",
);

describe("x402 paid request (B-5)", () => {
  it("disables retries on the request that carries the payment header", () => {
    const start = source.indexOf("// Retry with payment");
    expect(start).toBeGreaterThan(-1);
    const paidBlock = source.slice(start, source.indexOf("const data = await paidResp", start));

    expect(paidBlock).toContain("X-Payment");
    expect(paidBlock).toContain("retries: 0");
    expect(paidBlock).not.toMatch(/retries:\s*[1-9]/);
  });

  it("does not retry the initial probe more than the client's own policy", () => {
    const start = source.indexOf("// Initial request");
    const end = source.indexOf("if (initialResp.status !== 402)", start);
    const probeBlock = source.slice(start, end);

    // The probe precedes any signature, so the resilient client's retry policy is allowed —
    // but an explicit retry count on the probe would be a second request before payment.
    expect(probeBlock).not.toContain("retries:");
  });
});
