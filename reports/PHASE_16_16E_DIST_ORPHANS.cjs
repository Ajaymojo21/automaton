// Phase 16E — list dist JS files with no matching src TS (tsc leaves orphan build output).
// Usage: cd <repo root> && node reports/PHASE_16_16E_DIST_ORPHANS.cjs
const fs = require("node:fs");
const path = require("node:path");

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs, out);
    else out.push(abs);
  }
  return out;
}

const distRoot = path.resolve("dist");
const jsFiles = walk(distRoot, []).filter((f) => f.endsWith(".js") && !f.endsWith(".map"));
const orphans = [];
for (const js of jsFiles) {
  const rel = path.relative(distRoot, js).replace(/\\/g, "/");
  const srcTs = path.resolve("src", rel.replace(/\.js$/, ".ts"));
  if (!fs.existsSync(srcTs)) orphans.push(rel);
}
console.log(`dist js files: ${jsFiles.length}`);
console.log(`orphans (no matching src/*.ts): ${orphans.length}`);
for (const o of orphans.sort()) console.log("  " + o);
