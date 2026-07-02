/**
 * Strip NUL (U+0000) characters from a value graph before it is written to Postgres.
 *
 * Postgres `jsonb` (and `text`) cannot represent a NUL character: a write containing one fails with
 * `unsupported Unicode escape sequence`. Tool output and query-result cells occasionally carry a raw
 * NUL (binary-ish column values, driver artifacts), which then poisons the conversation-log /
 * file-content write and aborts the whole chat turn (Sentry MINUSX-BI-2T,
 * `chatListener:completeToolCall`). NUL is never storable in Postgres, so removing it is always the
 * correct normalization at the write boundary.
 *
 * Immutable + allocation-light: returns the SAME reference when a subtree is already NUL-free, so the
 * common (clean) write path does no copying. Only plain objects and arrays are traversed — exotic
 * values (Date, Buffer, class instances) are returned untouched so we never rebuild them wrongly.
 */
const NUL_RE = /\u0000/g;

function isPlainObject(v: object): boolean {
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

export function stripNulChars<T>(value: T): T {
  if (typeof value === 'string') {
    return (value.indexOf('\u0000') === -1 ? value : value.replace(NUL_RE, '')) as T;
  }
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((v) => {
      const s = stripNulChars(v);
      if (s !== v) changed = true;
      return s;
    });
    return (changed ? out : value) as T;
  }
  if (value !== null && typeof value === 'object' && isPlainObject(value)) {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const sk = stripNulChars(k);
      const sv = stripNulChars(v);
      if (sk !== k || sv !== v) changed = true;
      out[sk] = sv;
    }
    return (changed ? out : value) as T;
  }
  return value;
}
