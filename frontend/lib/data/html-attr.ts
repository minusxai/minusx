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
