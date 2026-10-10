/** Redaction for the debug trace. Nothing reaches the trace store without passing through here. */

export const REDACTED = '[REDACTED]';

/** Object keys whose values are never stored. Token *counts* (inputTokens) are not secrets. */
const SECRET_KEY =
  /api[-_]?key|secret|password|passwd|authorization|credential|cookie|^(x-)?(auth-?|access-?|refresh-?|bearer-?|session-?|id-?)?token$|(access|auth|refresh|bearer|session|id)[-_]?token|private[-_]?key/i;

/** Strings that look like credentials wherever they appear (prompts, errors, headers). */
const SECRET_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]+/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  // The token must contain a digit or be long, so prose like "Basic movement orders" survives.
  /\b(Bearer|Basic)\s+(?=[A-Za-z0-9._~+/=-]*\d|[A-Za-z0-9._~+/=-]{20})[A-Za-z0-9._~+/=-]{8,}/gi,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
];

const MAX_DEPTH = 12;
/** Longest string kept whole; prompts can be megabytes. */
export const MAX_STRING_LENGTH = 20_000;
const UNSERIALIZABLE = '[unserializable]';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class Redactor {
  private literals: RegExp[] = [];

  /** `secrets` are exact values (such as the configured API key) to scrub wherever they occur. */
  constructor(secrets: readonly (string | undefined)[] = []) {
    for (const s of secrets) this.addSecret(s);
  }

  addSecret(secret: string | undefined): void {
    // Very short values would shred ordinary text.
    if (secret && secret.length >= 8) this.literals.push(new RegExp(escapeRegExp(secret), 'g'));
  }

  string(s: string): string {
    let out = s;
    // Scrub before truncating so a secret cut in half is not left behind.
    for (const re of this.literals) out = out.replace(re, REDACTED);
    for (const re of SECRET_PATTERNS) out = out.replace(re, REDACTED);
    if (out.length > MAX_STRING_LENGTH) {
      out = `${out.slice(0, MAX_STRING_LENGTH)}...[truncated ${out.length - MAX_STRING_LENGTH} chars]`;
    }
    return out;
  }

  /** A JSON-safe deep copy of `value` with secrets removed. Never throws. */
  value(value: unknown): unknown {
    try {
      return this.walk(value, 0, new WeakSet());
    } catch {
      return UNSERIALIZABLE;
    }
  }

  private walk(v: unknown, depth: number, seen: WeakSet<object>): unknown {
    if (v === null || v === undefined) return v;
    switch (typeof v) {
      case 'string':
        return this.string(v);
      case 'number':
      case 'boolean':
        return v;
      case 'bigint':
        return v.toString();
      case 'function':
      case 'symbol':
        return undefined;
    }
    const obj = v as object;
    if (depth >= MAX_DEPTH) return '[max depth]';
    if (seen.has(obj)) return '[circular]';
    seen.add(obj);
    try {
      if (obj instanceof Date) {
        return Number.isNaN(obj.getTime()) ? UNSERIALIZABLE : obj.toISOString();
      }
      if (obj instanceof Map) return this.walk([...obj.entries()], depth, seen);
      if (obj instanceof Set) return this.walk([...obj.values()], depth, seen);
      if (obj instanceof Error) {
        return { name: obj.name, message: this.string(obj.message) };
      }
      if (Array.isArray(obj)) return obj.map((x) => this.walk(x, depth + 1, seen));
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(obj)) {
        if (SECRET_KEY.test(k)) {
          out[k] = REDACTED;
          continue;
        }
        try {
          out[k] = this.walk((obj as Record<string, unknown>)[k], depth + 1, seen);
        } catch {
          // A throwing getter or Proxy trap loses only this property.
          out[k] = UNSERIALIZABLE;
        }
      }
      return out;
    } finally {
      seen.delete(obj);
    }
  }
}
