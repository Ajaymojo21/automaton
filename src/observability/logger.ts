/**
 * Structured Logger
 *
 * JSON-formatted structured logging with levels, context, and child loggers.
 * Uses process.stdout.write to avoid console.log recursion.
 * Never throws — all errors are handled gracefully.
 */

import type { LogLevel, LogEntry } from "../types.js";
import { LOG_LEVEL_PRIORITY } from "../types.js";

let globalLogLevel: LogLevel = "info";
let customSink: ((entry: LogEntry) => void) | null = null;

/**
 * B-6: no credential, token or private key may reach a log sink. Callers are expected
 * not to log secrets; this is the backstop for the call site that forgets. Redaction is
 * applied to context values, messages and error text before the entry leaves the process.
 */
const SENSITIVE_KEY =
  /(api[-_]?key|apikey|authorization|auth[-_]?token|access[-_]?token|refresh[-_]?token|bearer|password|passwd|secret|private[-_]?key|seed[-_]?phrase|mnemonic|credential|cookie|session[-_]?id|token$)/i;
const REDACTED = "[REDACTED]";

function redactString(text: string): string {
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gi, REDACTED)
    .replace(/\b0x[0-9a-f]{64}\b/gi, REDACTED);
}

function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[depth-limited]";
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactValue(item, depth + 1);
    }
    return out;
  }
  return value;
}


export function setGlobalLogLevel(level: LogLevel): void {
  globalLogLevel = level;
}

export function getGlobalLogLevel(): LogLevel {
  return globalLogLevel;
}

export class StructuredLogger {
  private module: string;
  private minLevel: LogLevel;

  constructor(module: string, minLevel?: LogLevel) {
    this.module = module;
    this.minLevel = minLevel ?? globalLogLevel;
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.write("debug", message, undefined, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.write("info", message, undefined, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.write("warn", message, undefined, context);
  }

  error(message: string, error?: Error, context?: Record<string, unknown>): void {
    this.write("error", message, error, context);
  }

  fatal(message: string, error?: Error, context?: Record<string, unknown>): void {
    this.write("fatal", message, error, context);
  }

  child(subModule: string): StructuredLogger {
    return new StructuredLogger(`${this.module}.${subModule}`, this.minLevel);
  }

  static setSink(sink: (entry: LogEntry) => void): void {
    customSink = sink;
  }

  static resetSink(): void {
    customSink = null;
  }

  private write(
    level: LogLevel,
    message: string,
    error?: Error,
    context?: Record<string, unknown>,
  ): void {
    try {
      const effectiveLevel = this.minLevel ?? globalLogLevel;
      if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[effectiveLevel]) {
        return;
      }

      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level,
        module: this.module,
        message: redactString(message),
      };

      if (context && Object.keys(context).length > 0) {
        entry.context = redactValue(context) as Record<string, unknown>;
      }

      if (error) {
        entry.error = {
          message: redactString(error.message),
          stack: error.stack ? redactString(error.stack) : undefined,
        };
        if ((error as any).code) {
          entry.error.code = (error as any).code;
        }
      }

      if (customSink) {
        customSink(entry);
        return;
      }

      const json = JSON.stringify(entry);
      process.stdout.write(json + "\n");
    } catch {
      // Fallback if JSON serialization fails
      try {
        process.stderr.write(`[logger-fallback] ${message}\n`);
      } catch {
        // Completely silent — never throw from logger
      }
    }
  }
}

export function createLogger(module: string): StructuredLogger {
  return new StructuredLogger(module);
}
