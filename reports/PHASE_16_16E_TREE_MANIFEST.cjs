// Phase 16E — SHA-256 manifest for a directory tree. Read-only over the tree it is given.
// Usage: PHASE_16_16E_TREE_MANIFEST.cjs <dir>...   (prints "<sha>  <relpath>" lines, then a summary to stderr)
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function walk(dir, base, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, base, out);
    else if (entry.isFile()) out.push(abs);
  }
  return out;
}

let totalBytes = 0;
let totalFiles = 0;
const digest = crypto.createHash("sha256");
for (const root of process.argv.slice(2)) {
  const resolved = path.resolve(root);
  const files = walk(resolved, resolved, []);
  for (const abs of files) {
    const sha = crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
    const st = fs.statSync(abs);
    totalBytes += st.size;
    totalFiles += 1;
    const line = `${sha}  ${path.relative(resolved, abs).replace(/\\/g, "/")}  ${st.size}`;
    digest.update(line).update("\n");
    console.log(line);
  }
  console.error(`tree ${root}: ${files.length} files`);
}
console.error(`total ${totalFiles} files, ${totalBytes} bytes, tree digest ${digest.digest("hex")}`);
