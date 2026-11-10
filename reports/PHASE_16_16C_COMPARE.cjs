// Phase 16C — byte-for-byte content comparison of two SQLite files.
// Usage: node reports/PHASE_16_16C_COMPARE.cjs <liveDb> <backupDb>
// Opens BOTH readonly so the probe cannot be the thing that writes.
const Database = require("better-sqlite3");
const fs = require("node:fs");
const crypto = require("node:crypto");

const [livePath, backupPath] = process.argv.slice(2);
if (!livePath || !backupPath) {
  console.error("usage: PHASE_16_16C_COMPARE.cjs <liveDb> <backupDb>");
  process.exit(2);
}

function sign(db) {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((r) => r.name);
  const counts = {};
  let total = 0;
  for (const t of tables) {
    const n = db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n;
    counts[t] = n;
    total += n;
  }
  // Hash the ordered contents of every table, so a same-count but different-row
  // difference is still caught.
  const digests = {};
  for (const t of tables) {
    const rows = db.prepare(`SELECT * FROM "${t}" ORDER BY ROWID`).all();
    digests[t] = crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  }
  return {
    integrity: String(db.pragma("integrity_check", { simple: true })),
    journalMode: String(db.pragma("journal_mode", { simple: true })),
    userVersion: db.prepare("PRAGMA user_version").get().user_version,
    tables: tables.length,
    nonEmpty: Object.entries(counts).filter(([, n]) => n > 0),
    totalRows: total,
    counts,
    digests,
  };
}

function open(p) {
  const db = new Database(p, { readonly: true, fileMustExist: true });
  try {
    return sign(db);
  } finally {
    db.close();
  }
}

const live = open(livePath);
const backup = open(backupPath);

const sameTables =
  JSON.stringify(Object.keys(live.counts)) === JSON.stringify(Object.keys(backup.counts));
const diffCounts = Object.keys(live.counts).filter(
  (t) => live.counts[t] !== backup.counts[t],
);
const diffDigests = Object.keys(live.digests).filter(
  (t) => live.digests[t] !== backup.digests[t],
);

const out = {
  live: { path: livePath, ...live, bytes: fs.statSync(livePath).size },
  backup: { path: backupPath, ...backup, bytes: fs.statSync(backupPath).size },
  comparison: {
    sameTableSet: sameTables,
    tablesWithDifferentRowCount: diffCounts,
    tablesWithDifferentRowContent: diffDigests,
    identicalContent: sameTables && diffCounts.length === 0 && diffDigests.length === 0,
    sameByteSize: fs.statSync(livePath).size === fs.statSync(backupPath).size,
  },
};
delete out.live.counts;
delete out.live.digests;
delete out.backup.counts;
delete out.backup.digests;
console.log(JSON.stringify(out, null, 2));
console.log(
  `IDENTICAL=${out.comparison.identicalContent} liveRows=${live.totalRows} backupRows=${backup.totalRows}`,
);
