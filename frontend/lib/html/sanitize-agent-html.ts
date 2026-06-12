/**
 * Sanitizer for agent-authored HTML documents (browser/jsdom only —
 * DOMPurify needs a window).
 *
 * Anything executable is stripped (scripts, event handlers, iframes, forms).
 * <style> blocks ARE allowed: the document renders inside an isolated
 * same-origin iframe (AgentHtml), so its CSS — classes, web-font @imports,
 * animations — cannot leak into the app. `data-question-id` attributes
 * survive (DOMPurify keeps data-* by default) — chart components are portaled
 * in AFTER sanitization, so they are never touched by it.
 */
import DOMPurify, { type Config } from 'dompurify';

const SANITIZE_CONFIG: Config = {
  USE_PROFILES: { html: true, svg: true, svgFilters: true },
  ADD_TAGS: ['style'],
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'base', 'link', 'meta'],
};

export function sanitizeAgentHtml(html: string): string {
  // Wrap before sanitizing: the HTML parser hoists a leading <style> out of a
  // bare fragment into <head>, and DOMPurify only returns the body — the
  // agent's style block would silently vanish. Inside a <div> it can't be
  // hoisted. The wrapper stays in the output (harmless block element).
  return DOMPurify.sanitize(`<div data-mx-story-root>${html}</div>`, SANITIZE_CONFIG);
}
