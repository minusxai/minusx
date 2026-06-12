/**
 * Mirrors the document's stylesheet rules into a shadow root so portaled
 * chart components (Chakra/emotion class-based styles) render correctly inside
 * the shadow tree — document styles don't match shadow content.
 *
 * Kept in its own module so the UI test environment can mock it to a no-op:
 * in jsdom, reading `cssRules`/`cssText` is a slow JS reimplementation (not
 * native CSSOM), and across a test file the injected emotion/Chakra <style>
 * tags accumulate in the shared document — so re-serializing every rule on
 * each render becomes O(n²) and dominates test time. The mirror has no
 * observable effect in tests (charts are mocked), so faking it is free.
 */

// Fallback sizing for the portaled tile: the chart stack is built for a
// FIXED-HEIGHT FLEX COLUMN parent (QuestionVisualization is flex:1 / minH:0
// all the way down). The Chakra tile Box already declares this; the class
// guarantees it even before emotion's lazily-injected styles are mirrored in.
const APP_STYLES_BASE_CSS =
  `.mx-chart-fill { width: 100%; height: 100%; display: flex; flex-direction: column; overflow: hidden; }`;

/**
 * Fill the shadow root's dedicated app-styles tag with the document's
 * stylesheet rules. Reads cssRules rather than cloning <style> tags because
 * emotion in production inserts rules via CSSOM (speedy mode) — the tags are
 * empty. The tag sits FIRST in the shadow root, so the story's own <style>
 * blocks win ties. Re-run after portals mount: emotion injects styles lazily
 * on first render.
 */
export function mirrorAppStyles(root: ShadowRoot) {
  const tag = root.querySelector('style[data-mx-app-styles]');
  if (!tag) return;
  const css: string[] = [APP_STYLES_BASE_CSS];
  for (const sheet of Array.from(document.styleSheets)) {
    const owner = sheet.ownerNode;
    // Skip our own hoisted story-font tag (would re-import the fonts into the
    // shadow sheet, where @import is invalid mid-sheet anyway) and anything
    // not rooted in the document proper (jsdom surfaces shadow styles here).
    if (owner instanceof Element && (owner.hasAttribute('data-mx-story-fonts') || owner.getRootNode() !== document)) continue;
    try {
      css.push(Array.from(sheet.cssRules)
        .filter(r => !r.cssText.startsWith('@import'))
        .map(r => r.cssText).join('\n'));
    } catch {
      // Cross-origin stylesheet — skip
    }
  }
  const joined = css.join('\n');
  if (tag.textContent !== joined) tag.textContent = joined;
}
