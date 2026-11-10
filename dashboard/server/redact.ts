// A credential word anywhere in a key names it: `privateKeyPem`, `anthropicApiKey` and
// `db_password_env` all have to go. Anchoring to the start or end of the key leaves a whole
// family of names unredacted, and over-redacting an operational key costs nothing.
const SECRET_KEY_PATTERN =
  /api[_-]?key|apikey|token|secret|passphrase|password|passwd|private[_-]?key|seed|authorization|cookie|credential|session[_-]?id|access[_-]?key|client[_-]?secret/i;

const VALUE_PATTERNS: Array<[RegExp, string]> = [
  [/["']?(?:sk|pk|api|key)[-_][A-Za-z0-9._-]{12,}["']?/gi, "[redacted:key-shaped]"],
  [/\bBEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY\b[\s\S]*?\bEND [A-Z ]*PRIVATE KEY\b/g, "[redacted:pem]"],
  [/\b0x[a-fA-F0-9]{64}\b/g, "[redacted:32-byte-hex]"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, "[redacted:jwt]"],
];

export function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

/** Structural, non-schema-specific: keeps the audit trail useful without copying values. */
export function redact(input: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated:depth]";
  if (typeof input === "string") return scrubString(input);
  if (Array.isArray(input)) return input.map((item) => redact(item, depth + 1));
  if (input && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      out[key] = isSecretKey(key) ? "[redacted:key]" : redact(value, depth + 1);
    }
    return out;
  }
  return input;
}

function scrubString(value: string): string {
  let out = value;
  for (const [pattern, replacement] of VALUE_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out.length > 512 ? `${out.slice(0, 512)}…` : out;
}

export function redactJson(line: string): string {
  let out = line;
  for (const [pattern, replacement] of VALUE_PATTERNS) out = out.replace(pattern, replacement);
  return out.slice(0, 65_536);
}
