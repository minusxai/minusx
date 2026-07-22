/**
 * Rebuild a clean `content.story` string from AgentHtml's live (edited)
 * shadow-root DOM, undoing everything AgentHtml mutated at render time so the
 * saved HTML round-trips losslessly:
 *
 *  - drop the injected `<style data-mx-app-styles>` (mirrored app CSS, not part
 *    of the story);
 *  - restore each chart embed (`[data-question-id]` saved, `[data-question-inline]`
 *    inline) to its authored EMPTY placeholder — clear the portal-rendered chart DOM
 *    and put back the original inline style snapshotted in `data-mx-osz` (AgentHtml
 *    clamps width/height at render, so the live style is not what was authored);
 *  - strip the `contenteditable` attributes added for inline editing;
 *  - re-insert the `@import` web-font lines AgentHtml hoisted out of the story's
 *    `<style>` into `document.head` (otherwise the saved story loses its fonts).
 *
 * Operates on a clone, so the live (still-displayed) shadow root is untouched.
 */
// AgentHtml-injected style tags that are NOT part of the authored story and
// must be stripped on save. Styles live INSIDE the story root now (Story_Design_V2 §4: the
// serialized <svg> must carry them without head-cloning), so every save path reading root
// contents drops the whole data-mx-* family — else derived CSS compounds into content.story:
// the app-styles mirror, the fluid/mobile shim, the compiled design-system css (data-mx-tw),
// the jsx floating css, and the platform font css (data-mx-fonts).
const INJECTED_STYLE_SELECTOR =
  'style[data-mx-app-styles], style[data-mx-fluid-shim], style[data-mx-tw], style[data-mx-floating], style[data-mx-fonts], [data-mx-embed-root]';
// sanitizeAgentHtml wraps the authored story in a single <div data-mx-story-root> on EVERY
// render. We serialize only this wrapper's content (never the wrapper itself), and collapse
// any nested wrappers that prior buggy saves baked in — otherwise the story re-nests one level
// deeper on every load→save round-trip.
const STORY_ROOT_SELECTOR = '[data-mx-story-root]';
// Ark UI / Zag runtime component roots (popover, menu, tooltip, …) carry a data-scope attr.
// These are LIVE-render DOM — inline widgets like <Number> portal their popover into the iframe
// body via Chakra's <Portal> — never authored story content. They must never be serialized back
// into content.story. Stripping them both drops any freshly-leaked popover AND heals stories
// already corrupted by the pre-fix leak (where the popover DOM is baked into the saved content).
const LEAKED_WIDGET_SELECTOR = '[data-scope]';
const ORIG_STYLE_ATTR = 'data-mx-osz';

export function serializeEditedStory(
  root: Element | ShadowRoot | DocumentFragment,
  imports: string[] = [],
): string {
  // Scope to the authored story wrapper. AgentHtml passes the whole iframe <body>, which also
  // holds non-story siblings (the hidden embed-root host, body-level Ark popover/menu portals) —
  // taking the wrapper's children alone drops them. Fall back to `root` when there is no wrapper
  // (unit tests pass bare content).
  const storyRoot = root.querySelector(STORY_ROOT_SELECTOR);
  const source: Element | ShadowRoot | DocumentFragment = storyRoot ?? root;

  // Build the working clone in the ROOT's own document (the iframe doc in the live path, or a
  // parser document when healing a stored string) — never a foreign global `document`.
  const ownerDoc: Document = root.ownerDocument ?? globalThis.document;
  const container = ownerDoc.createElement('div');
  source.childNodes.forEach(node => container.appendChild(node.cloneNode(true)));

  // Collapse any nested <div data-mx-story-root> wrappers accumulated by prior saves down to the
  // real content (unwrap each: replace it with its children).
  container.querySelectorAll(STORY_ROOT_SELECTOR).forEach(w => w.replaceWith(...w.childNodes));

  container.querySelectorAll(`${INJECTED_STYLE_SELECTOR}, ${LEAKED_WIDGET_SELECTOR}`).forEach(el => el.remove());

  container.querySelectorAll<HTMLElement>('[data-question-id],[data-question-inline],[data-number-inline]').forEach(el => {
    const authored = el.getAttribute(ORIG_STYLE_ATTR);
    if (authored !== null) {
      el.setAttribute('style', authored);
      el.removeAttribute(ORIG_STYLE_ATTR);
    }
    el.replaceChildren(); // drop the portal-rendered chart card → empty placeholder
  });

  container.querySelectorAll('[contenteditable]').forEach(el => el.removeAttribute('contenteditable'));

  if (imports.length > 0) {
    const firstStyle = container.querySelector('style');
    if (firstStyle) {
      firstStyle.textContent = `${imports.join('\n')}\n${firstStyle.textContent ?? ''}`;
    } else {
      const style = ownerDoc.createElement('style');
      style.textContent = imports.join('\n');
      container.insertBefore(style, container.firstChild);
    }
  }

  return container.innerHTML;
}
