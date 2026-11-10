// Phase 16C — evidence dump: what genuine user data exists in the live database.
// Read-only. Opens with {readonly:true, fileMustExist:true}; cannot write.
const Database = require("better-sqlite3");
const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");

const LIVE = process.env.LIVE_DB || path.resolve("runtime/home/.automaton/state.db");
const ARCHIVE = process.env.ARCHIVE_DB || "";

function sha(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function dump(file) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  const out = {
    file,
    bytes: fs.statSync(file).size,
    sha256: sha(file),
    integrity: String(db.pragma("integrity_check", { simple: true })),
    journalMode: String(db.pragma("journal_mode", { simple: true })),
    userVersion: db.prepare("PRAGMA user_version").get().user_version,
    tables: [],
  };
  const names = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((r) => r.name);
  let total = 0;
  for (const t of names) {
    const n = db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n;
    total += n;
    out.tables.push({ table: t, rows: n });
  }
  out.summary = {
    tables: names.length,
    nonEmptyTables: out.tables.filter((t) => t.rows > 0).map((t) => `${t.table}=${t.rows}`),
    totalRows: total,
  };
  if (names.includes("schema_version")) {
    out.schemaVersionRows = db.prepare("SELECT version, applied_at FROM schema_version ORDER BY version").all();
  }
  db.close();
  return out;
}

const result = { live: dump(LIVE) };
if (ARCHIVE) {
  result.archive = dump(ARCHIVE);
  const a = result.archive;
  const l = result.live;
  result.comparison = {
    sameTableCount: a.summary.tables === l.summary.tables,
    sameNonEmptySet: JSON.stringify(a.summary.nonEmptyTables) === JSON.stringify(l.summary.nonEmptyTables),
    sameTotalRows: a.summary.totalRows === l.summary.totalRows,
    sameSchemaVersionRows: JSON.stringify(a.schemaVersionRows) === JSON.stringify(l.schemaVersionRows),
    // Recorded because hash equality is the WRONG acceptance test for a backup:
    sha256LiveEqualsArchive: l.sha256 === a.sha256,
    bytesLiveEqualsArchive: l.bytes === a.bytes,
  };
}
console.log(JSON.stringify(result, null, 2));
