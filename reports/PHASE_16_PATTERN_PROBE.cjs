const fs = require("fs");
function patternsFrom(file) {
  const src = fs.readFileSync(file, "utf-8");
  const block = src.slice(src.indexOf("const FORBIDDEN_PATTERNS"), src.indexOf("];", src.indexOf("const FORBIDDEN_PATTERNS")));
  const out = [];
  const re = /pattern:\s*\/((?:\.|[^\/])*)\/([a-z]*)/g;
  let m;
  while ((m = re.exec(block))) out.push({ re: new RegExp(m[1], m[2]), text: "/" + m[1] + "/" + m[2] });
  return out;
}
const names = ["set_activation_approved","enable_activation","grant_capability","elevate_privilege","add_allowed_tool","disable_sandbox","disable_lockdown","disable_audit","raise_treasury_limit","export_private_key","prune_expired_leases"];
for (const [label, file] of [["PRE-16A.4", "backups/phase16/mechanic.ts.pre-16A4.bak"], ["POST-16A.4", "src/reliability/mechanic.ts"]]) {
  const pats = patternsFrom(file);
  console.log(`\n=== ${label} (${file}) — ${pats.length} patterns ===`);
  for (const n of names) {
    const hit = pats.find((p) => p.re.test(n));
    console.log(`${n.padEnd(24)} ${hit ? "MATCH " + hit.text : "NO PATTERN MATCH"}`);
  }
}
