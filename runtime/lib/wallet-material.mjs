/**
 * Wallet / key-material policy shared by runtime/bin/backup.mjs, runtime/bin/restore.mjs and
 * dashboard/server/verify.ts.
 *
 * One predicate decides what must never be archived and must never be restored, so the two
 * halves of the backup path cannot disagree about which files hold a private key.
 *
 * Callers pass paths relative to the archive or to the automaton directory. An absolute path
 * into `<home>/.automaton` contains the `.automaton` segment and is therefore classified as
 * wallet material — the fail-closed answer, not an invitation to widen the allow-list.
 */

/** Matched case-insensitively against the basename of every candidate path. */
const WALLET_FILE_PATTERNS = [
  /^wallet(\.json|\.enc[-.].*)?$/i,
  /^\.?wallet$/i,
  /keystore/i,
  /mnemonic/i,
  /seed[-_ ]?phrase/i,
  /private[-_ ]?key/i,
  /\.key$/i,
  /\.pem$/i,
  /\.p12$/i,
  /\.jks$/i,
  /^id_rsa/i,
  /^id_ed25519/i,
  /^id_ecdsa/i,
  /wallet\.backup/i,
];

/** Directory segments that must never be traversed for backup or restore. */
const WALLET_DIR_SEGMENTS = new Set([".automaton", "keystore", "wallets"]);

/**
 * True when a relative path points at wallet, keystore or key material.
 * @param {unknown} rel
 * @returns {boolean}
 */
export function isWalletFile(rel) {
  if (typeof rel !== "string" || rel.length === 0) return false;
  const parts = rel.split(/[\\/]/).filter(Boolean);
  for (const part of parts) {
    if (WALLET_DIR_SEGMENTS.has(part.toLowerCase())) return true;
  }
  const base = parts[parts.length - 1] ?? "";
  return WALLET_FILE_PATTERNS.some((re) => re.test(base));
}

/** A name safe to echo in a diagnostic: control characters removed, length bounded. */
export function safeLabel(value) {
  const text = typeof value === "string" ? value : String(value);
  return text.replace(/[\u0000-\u001f\u007f]/g, "?").slice(0, 120);
}

/**
 * Accepts only a single path component. A manifest is written by this project's tooling, so
 * anything with a separator, a drive letter, a UNC prefix, `..` or a NUL byte is evidence of a
 * tampered or hand-edited archive and is refused before a single byte is read or written.
 * @param {unknown} name
 * @returns {string} the validated name
 */
export function assertPlainArchiveName(name) {
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("refusing archive entry with an empty name");
  }
  if (/[\u0000-\u001f]/.test(name)) {
    throw new Error(`refusing archive entry with control characters: ${safeLabel(name)}`);
  }
  if (/^[A-Za-z]:/.test(name) || name.startsWith("/") || name.startsWith("\\")) {
    throw new Error(`refusing absolute archive entry: ${safeLabel(name)}`);
  }
  if (name === "." || name === ".." || name.includes("/") || name.includes("\\")) {
    throw new Error(`refusing archive entry outside its directory: ${safeLabel(name)}`);
  }
  return name;
}
