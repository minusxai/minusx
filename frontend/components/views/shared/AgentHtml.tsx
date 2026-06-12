'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { sanitizeAgentHtml } from '@/lib/html/sanitize-agent-html';
import SmartEmbeddedQuestionContainer from '@/components/containers/SmartEmbeddedQuestionContainer';

interface ChartTarget {
  el: HTMLElement;
  questionId: number;
}

interface AgentHtmlProps {
  html: string;
  /** Fixed logical canvas width in px (the agent authors against it). */
  width: number;
  /** Fixed canvas height in px; omit for content-driven height (story pages). */
  height?: number;
}

const MIRROR_ATTR = 'data-mx-style-mirror';

// The chart portal wrapper + its child must fill the agent's placeholder div.
const FRAME_BASE_CSS = `.mx-chart-fill, .mx-chart-fill > div { width: 100%; height: 100%; }`;

/**
 * Copy the app's stylesheets into the iframe document so portaled chart
 * components (Chakra/emotion class-based styles) lay out correctly inside it.
 * Reads cssRules rather than cloning <style> tags because emotion in
 * production inserts rules via CSSOM (speedy mode) — the tags are empty.
 * Mirrored styles are appended to <head>, so the story's own <style> blocks
 * (in <body>) win ties. Re-run after portals mount: emotion injects styles
 * lazily on first render.
 */
function mirrorAppStyles(doc: Document) {
  const css: string[] = [FRAME_BASE_CSS];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      css.push(Array.from(sheet.cssRules).map(r => r.cssText).join('\n'));
    } catch {
      // Cross-origin stylesheet — skip
    }
  }
  const joined = css.join('\n');
  const existing = doc.head.querySelector(`style[${MIRROR_ATTR}]`);
  if (existing) {
    if (existing.textContent !== joined) existing.textContent = joined;
    return;
  }
  const tag = doc.createElement('style');
  tag.setAttribute(MIRROR_ATTR, '');
  tag.textContent = joined;
  doc.head.appendChild(tag);
}

/**
 * Renders one agent-authored HTML document into an isolated same-origin
 * iframe on a fixed-width logical canvas (fixed height for slides,
 * content-driven for story pages). Isolation cuts both ways: the document's
 * <style> blocks / web fonts / animations are allowed and cannot leak into
 * the app, and the app's CSS doesn't restyle the document (app sheets are
 * mirrored into the frame only so portaled chart components work). Scripts
 * and event handlers are stripped by sanitizeAgentHtml before injection.
 * Every `<div data-question-id="N">` placeholder is hydrated with a live
 * embedded question chart via a portal into the iframe document.
 */
export default function AgentHtml({ html, width, height }: AgentHtmlProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [targets, setTargets] = useState<ChartTarget[]>([]);
  const [docHeight, setDocHeight] = useState(0);

  const sanitized = useMemo(() => sanitizeAgentHtml(html || ''), [html]);

  useLayoutEffect(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;

    // The src-less iframe keeps its initial about:blank document — write
    // straight into it. <style> elements added via innerHTML DO apply
    // (unlike <script>, which wouldn't execute — and is stripped anyway).
    doc.body.style.margin = '0';
    doc.body.style.background = 'white';
    // Default typography for documents that don't set their own.
    doc.body.style.fontFamily = 'Helvetica, Arial, sans-serif';
    doc.body.style.fontSize = '16px';
    doc.body.style.lineHeight = '1.4';
    doc.body.style.color = 'black';
    doc.body.innerHTML = sanitized;
    mirrorAppStyles(doc);

    const found: ChartTarget[] = [];
    doc.body.querySelectorAll<HTMLElement>('[data-question-id]').forEach(el => {
      const questionId = parseInt(el.getAttribute('data-question-id') || '', 10);
      if (Number.isNaN(questionId)) return;
      el.replaceChildren(); // drop authored fallback content; the portal takes over
      found.push({ el, questionId });
    });
    // Portal targets only exist after the innerHTML write, so discovery is
    // necessarily effect → state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTargets(found);

    // Content-driven height: track the document's natural height so the
    // outer page scrolls instead of the iframe.
    const syncHeight = () => setDocHeight(doc.body.scrollHeight || 0);
    syncHeight();
    const RO: typeof ResizeObserver | undefined =
      (iframeRef.current?.contentWindow as (Window & typeof globalThis) | null)?.ResizeObserver ?? window.ResizeObserver;
    const ro = RO ? new RO(syncHeight) : null;
    ro?.observe(doc.body);
    return () => ro?.disconnect();
  }, [sanitized]);

  // Emotion injects chart styles lazily as portal content first renders —
  // re-mirror shortly after, and once more for late async chunks.
  useEffect(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc || targets.length === 0) return;
    mirrorAppStyles(doc);
    const t1 = window.setTimeout(() => mirrorAppStyles(doc), 250);
    const t2 = window.setTimeout(() => mirrorAppStyles(doc), 1500);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
  }, [targets]);

  return (
    <>
      <iframe
        ref={iframeRef}
        aria-label="Story document"
        title="Story document"
        style={{
          width: `${width}px`,
          height: `${height ?? docHeight}px`,
          border: 'none',
          display: 'block',
          background: 'white',
        }}
      />
      {targets.map((t, i) => createPortal(
        <div className="mx-chart-fill">
          <SmartEmbeddedQuestionContainer questionId={t.questionId} showTitle={false} />
        </div>,
        t.el,
        `${i}-${t.questionId}`,
      ))}
    </>
  );
}
