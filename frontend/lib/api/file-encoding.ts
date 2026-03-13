/**
 * File encoding utilities for editFileStr.
 *
 * encodeFileStr is like JSON.stringify except string VALUES are stored with
 * raw characters (real newlines, tabs, etc.) instead of JSON escape sequences.
 * Only `\` and `"` are escaped in string values — the minimum required to
 * preserve JSON structure.
 *
 * This means oldMatch from the LLM (which sees raw chars via tool result
 * decoding) matches the encoded string directly, with no fallback escaping.
 *
 * decodeFileStr reverses the encoding: it escapes raw control characters
 * (which can only appear inside string values in compact JSON) and then
 * calls JSON.parse.
 */

export function encodeFileStr(obj: unknown): string {
  if (obj === null || typeof obj === 'boolean' || typeof obj === 'number') {
    return JSON.stringify(obj);
  }
  if (typeof obj === 'string') {
    // Only escape \ and " — keeps newlines, tabs, etc. as raw characters
    return '"' + obj.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(encodeFileStr).join(',') + ']';
  }
  if (typeof obj === 'object') {
    const entries = Object.entries(obj as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => JSON.stringify(k) + ':' + encodeFileStr(v));
    return '{' + entries.join(',') + '}';
  }
  return JSON.stringify(obj);
}

export function decodeFileStr(str: string): unknown {
  // In compact JSON (no formatting whitespace between tokens), raw control
  // characters only appear inside string values — safe to escape them globally
  // before handing off to JSON.parse.
  const fixed = str
    .replace(/\x08/g, '\\b')
    .replace(/\t/g,   '\\t')
    .replace(/\n/g,   '\\n')
    .replace(/\f/g,   '\\f')
    .replace(/\r/g,   '\\r')
    .replace(/[\x00-\x07\x0b\x0e-\x1f]/g, c =>
      '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  return JSON.parse(fixed);
}
