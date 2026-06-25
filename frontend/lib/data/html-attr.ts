/**
 * HTML attribute-value escaping, shared by the story-body codecs (`story-params`,
 * `story-question`). Stored story HTML keeps embeds/params as `<div data-*>` placeholders;
 * any `"`/`<`/`>`/`&` in an attribute value must be entity-escaped so the HTML stays
 * well-formed and the `[^"]*` placeholder regexes can't be broken out of.
 */
export const escAttr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const unescAttr = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/**
 * Escape a raw string so it can ride inside a jsx template literal — `query={`…`}` — keeping
 * multi-line SQL (with `<`, `>`, `{`) intact. Shared by the `<Question>` / `<Number>` emitters.
 */
export const escTemplate = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

/** A jsx `style={{…}}` / `viz={{…}}` attr value is only usable when it's a non-array object. */
export const styleAttr = (v: unknown): Record<string, string | number> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string | number>) : undefined;

/**
 * Serialize an object as an entity-escaped JSON attribute value (e.g. `data-number-inline="…"`).
 * The single way the story codecs stash a JSON payload in a placeholder attribute.
 */
export const serializeJsonAttr = (obj: unknown): string => escAttr(JSON.stringify(obj));

/**
 * Parse a JSON payload back out of a placeholder attribute, tolerating malformed input (→ null).
 * Works for BOTH the regex-extracted form (entity-encoded → `unescAttr` decodes it) and a DOM
 * `getAttribute` value (already entity-decoded → `unescAttr` is a no-op). An optional `isValid`
 * guard drops payloads that parse but aren't the shape we want.
 */
export function parseJsonAttr<T>(raw: string | null | undefined, isValid?: (v: T) => boolean): T | null {
  if (raw == null) return null;
  try {
    const v = JSON.parse(unescAttr(raw)) as T;
    return isValid && !isValid(v) ? null : v;
  } catch {
    return null;
  }
}
