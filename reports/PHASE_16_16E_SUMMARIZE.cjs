// Phase 16E — extract per-file regression counts from the vitest JSON report.
const path = require("node:path");
const reportName = process.argv[2] || "PHASE_16_16E_FULL_RUN.json";
const j = require(path.join(__dirname, reportName));

const base = (f) => f.name.replace(/\\/g, "/").split("/").pop();
const rel = (f) => (f.name.replace(/\\/g, "/").match(/src\/.*$/) || [f.name])[0];

const phase16 = j.testResults.filter((t) => /phase16|home-guard/.test(t.name));
let sum = 0;
for (const f of phase16) {
  const a = f.assertionResults || [];
  const p = a.filter((x) => x.status === "passed").length;
  const fl = a.filter((x) => x.status === "failed").length;
  const pe = a.filter((x) => x.status !== "passed" && x.status !== "failed").length;
  sum += p;
  console.log(
    String(p).padStart(4),
    fl ? "FAILED " + fl : "  ok  ",
    pe ? "PENDING " + pe : "     - ",
    base(f),
  );
}
console.log("phase16+home-guard tests passed:", sum);

const groups = {};
for (const f of j.testResults) {
  const r = rel(f);
  const d = r.split("/").slice(0, 3).join("/");
  const a = f.assertionResults || [];
  groups[d] = groups[d] || { files: 0, passed: 0, failed: 0, other: 0 };
  groups[d].files += 1;
  groups[d].passed += a.filter((x) => x.status === "passed").length;
  groups[d].failed += a.filter((x) => x.status === "failed").length;
  groups[d].other += a.filter((x) => x.status !== "passed" && x.status !== "failed").length;
}
console.log("\nby area:");
for (const [d, g] of Object.entries(groups).sort((a, b) => b[1].passed - a[1].passed)) {
  console.log(`  ${String(g.passed).padStart(5)} passed ${String(g.failed).padStart(3)} failed ${String(g.other).padStart(3)} other  ${String(g.files).padStart(3)} files  ${d}`);
}
console.log("\ntotals: files", j.testResults.length, "suites", j.numTotalTestSuites,
  "tests", j.numTotalTests, "passed", j.numPassedTests, "failed", j.numFailedTests,
  "pending", j.numPendingTests);
const slowest = j.testResults
  .map((t) => ({ f: base(t), ms: (t.endTime || 0) - (t.startTime || 0) }))
  .sort((a, b) => b.ms - a.ms)
  .slice(0, 8);
console.log("\nslowest files:");
for (const s of slowest) console.log(`  ${(s.ms / 1000).toFixed(1).padStart(6)} s  ${s.f}`);

const starts = j.testResults.map((t) => t.startTime).filter(Number.isFinite);
const ends = j.testResults.map((t) => t.endTime).filter(Number.isFinite);
console.log(
  "\nspan (first file start -> last file end):",
  ((Math.max(...ends) - Math.min(...starts)) / 1000).toFixed(1) + " s",
);
