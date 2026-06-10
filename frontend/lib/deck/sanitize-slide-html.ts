/**
 * Sanitizer for agent-authored deck slide HTML (browser/jsdom only —
 * DOMPurify needs a window).
 *
 * The deck contract is inline-styles-only: <style> is stripped along with
 * anything executable. `data-question-id` attributes survive (DOMPurify keeps
 * data-* by default) — chart components are portaled in AFTER sanitization,
 * so they are never touched by it.
 */
import DOMPurify, { type Config } from 'dompurify';

const SANITIZE_CONFIG: Config = {
  USE_PROFILES: { html: true, svg: true, svgFilters: true },
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'base', 'link', 'meta'],
};

export function sanitizeSlideHtml(html: string): string {
  return DOMPurify.sanitize(html, SANITIZE_CONFIG);
}
