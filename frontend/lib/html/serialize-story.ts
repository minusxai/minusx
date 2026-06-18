/**
 * Rebuild a clean `content.story` string from AgentHtml's live (edited)
 * shadow-root DOM, undoing everything AgentHtml mutated at render time so the
 * saved HTML round-trips losslessly:
 *
 *  - drop the injected `<style data-mx-app-styles>` (mirrored app CSS, not part
 *    of the story);
 *  - restore each `[data-question-id]` chart embed to its authored EMPTY
 *    placeholder — clear the portal-rendered chart DOM and put back the original
 *    inline style snapshotted in `data-mx-osz` (AgentHtml clamps width/height at
 *    render, so the live style is not what was authored);
 *  - strip the `contenteditable` attributes added for inline editing;
 *  - re-insert the `@import` web-font lines AgentHtml hoisted out of the story's
 *    `<style>` into `document.head` (otherwise the saved story loses its fonts).
 *
 * Operates on a clone, so the live (still-displayed) shadow root is untouched.
 */
// AgentHtml-injected style tags that are NOT part of the authored story and
// must be stripped on save: the mirrored app CSS and the fluid/mobile shim.
const INJECTED_STYLE_SELECTOR = 'style[data-mx-app-styles], style[data-mx-fluid-shim]';
const ORIG_STYLE_ATTR = 'data-mx-osz';

export function serializeEditedStory(
  root: Element | ShadowRoot | DocumentFragment,
  imports: string[] = [],
): string {
  const container = document.createElement('div');
  root.childNodes.forEach(node => container.appendChild(node.cloneNode(true)));

  container.querySelectorAll(INJECTED_STYLE_SELECTOR).forEach(el => el.remove());

  container.querySelectorAll<HTMLElement>('[data-question-id]').forEach(el => {
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
      const style = document.createElement('style');
      style.textContent = imports.join('\n');
      container.insertBefore(style, container.firstChild);
    }
  }

  return container.innerHTML;
}
