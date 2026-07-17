'use client';

/**
 * Canvas text editing — source mapping between a raster block box and the story
 * HTML. A block is identified by (tag, normalized text, occurrence): stable across
 * the transforms between the stored HTML and the takumi node tree, with occurrence
 * disambiguating identical blocks in document order.
 *
 * Browser-only (DOMParser); the geometry side lives in geometry.ts.
 */

export interface BlockRef {
  tag: string;
  text: string;
  occurrence: number;
}

// Whitespace- and CASE-insensitive matching: takumi splits letter-spaced/wrapped
// text into runs whose joined form has different spacing than the DOM's
// textContent, and `text-transform: uppercase` makes the RENDERED text differ in
// case from the source (e.g. an h3 titled in lowercase, displayed uppercase).
const normalize = (s: string): string => s.replace(/\s+/g, '').toLowerCase();

function findBlockEl(doc: Document, ref: BlockRef): Element | null {
  let seen = 0;
  for (const el of doc.body.querySelectorAll(ref.tag)) {
    if (normalize(el.textContent ?? '') !== normalize(ref.text)) continue;
    if (seen === ref.occurrence) return el;
    seen++;
  }
  return null;
}

/** The block's current outerHTML (editor seed), or null when it can't be found. */
export function getBlockHtml(storyHtml: string, ref: BlockRef): string | null {
  const doc = new DOMParser().parseFromString(storyHtml, 'text/html');
  return findBlockEl(doc, ref)?.outerHTML ?? null;
}

/** An ancestor of the edited block — enough to rebuild its cascade context. */
export interface BlockAncestor {
  tag: string;
  className: string;
  /** The ancestor's inline style — kept because it may define CSS variables. */
  style: string;
}

/**
 * The block + its ancestor chain (outermost first, `<body>` excluded). The editor
 * overlay rebuilds these wrappers inside its shadow root so descendant selectors
 * (`.subtle-band .highlights li { … }`), inherited properties, and CSS variables
 * (`--navy` on an ancestor) style the block exactly as the story does.
 */
export function getBlockContext(storyHtml: string, ref: BlockRef): { html: string; ancestors: BlockAncestor[] } | null {
  const doc = new DOMParser().parseFromString(storyHtml, 'text/html');
  const el = findBlockEl(doc, ref);
  if (!el) return null;
  const ancestors: BlockAncestor[] = [];
  for (let n = el.parentElement; n && n !== doc.body; n = n.parentElement) {
    ancestors.unshift({ tag: n.tagName.toLowerCase(), className: n.getAttribute('class') ?? '', style: n.getAttribute('style') ?? '' });
  }
  return { html: el.outerHTML, ancestors };
}

/** All of the story's own `<style>` CSS (custom classes, CSS variables). */
export function extractStoryStyles(storyHtml: string): string {
  const doc = new DOMParser().parseFromString(storyHtml, 'text/html');
  return [...doc.querySelectorAll('style')].map(st => st.textContent ?? '').join('\n');
}

/**
 * Replace the referenced block with `newOuterHtml` and return the updated story
 * HTML (null when the block can't be found). Serialization preserves the rest of
 * the document as the browser normalizes it — the same fidelity contract as the
 * DOM path's contentEditable editing, which also round-trips through innerHTML.
 */
export function replaceBlockHtml(storyHtml: string, ref: BlockRef, newOuterHtml: string): string | null {
  const doc = new DOMParser().parseFromString(storyHtml, 'text/html');
  const el = findBlockEl(doc, ref);
  if (!el) return null;
  el.outerHTML = newOuterHtml;
  // Leading <style>/<link> blocks (story fonts + custom CSS) get hoisted into <head>
  // during parsing — serialize them back in front or the commit silently drops them.
  const head = [...doc.head.querySelectorAll('style, link')].map(n => n.outerHTML).join('');
  return head + doc.body.innerHTML;
}
