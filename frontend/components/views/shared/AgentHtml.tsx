'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Box } from '@chakra-ui/react';

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

// The chart portal wrapper + its child must fill the agent's placeholder div.
const APP_STYLES_BASE_CSS = `.mx-chart-fill, .mx-chart-fill > div { width: 100%; height: 100%; }`;

/**
 * Fill the shadow root's dedicated app-styles tag with the document's
 * stylesheet rules so portaled chart components (Chakra/emotion class-based
 * styles) render correctly inside the shadow tree — document styles don't
 * match shadow content. Reads cssRules rather than cloning <style> tags
 * because emotion in production inserts rules via CSSOM (speedy mode) — the
 * tags are empty. The tag sits FIRST in the shadow root, so the story's own
 * <style> blocks win ties. Re-run after portals mount: emotion injects
 * styles lazily on first render.
 */
function mirrorAppStyles(root: ShadowRoot) {
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

/**
 * Renders one agent-authored HTML document into a shadow root on a
 * fixed-width logical canvas (fixed height for slides, content-driven for
 * story pages). The shadow tree natively scopes the document's <style>
 * blocks — they can't leak into the app and app CSS can't restyle the story —
 * while CSS variables (color-mode tokens) and document fonts still inherit,
 * so embedded charts keep the app theme. Scripts and event handlers are
 * stripped by sanitizeAgentHtml before injection. Every
 * `<div data-question-id="N">` placeholder is hydrated with a live embedded
 * question chart via a portal into the shadow root. @import lines in the
 * document's <style> blocks (web fonts) are hoisted to document.head —
 * font-faces declared inside shadow trees don't load.
 */
export default function AgentHtml({ html, width, height }: AgentHtmlProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fontTagRef = useRef<HTMLStyleElement | null>(null);
  const [targets, setTargets] = useState<ChartTarget[]>([]);

  const sanitized = useMemo(() => sanitizeAgentHtml(html || ''), [html]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });

    // App styles first (story styles below win ties), then the document.
    // <style> elements added via innerHTML DO apply (unlike <script>, which
    // wouldn't execute — and is stripped anyway).
    root.innerHTML = `<style data-mx-app-styles></style>${sanitized}`;
    mirrorAppStyles(root);

    // Hoist @import (web fonts) to document.head — font-faces don't load
    // inside shadow trees. One reused tag, removed on unmount.
    // Quoted URLs are matched atomically: Google Fonts URLs contain SEMICOLONS
    // (weight lists like wght@0,700;0,900), so a naive [^;]+ would cut the
    // import short and leave URL garbage to poison the next CSS rule.
    const importRe = /@import\s+(?:"[^"]*"|'[^']*'|url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\s*\))[^;{]*;/g;
    const imports: string[] = [];
    root.querySelectorAll('style:not([data-mx-app-styles])').forEach(style => {
      const text = style.textContent || '';
      const found = text.match(importRe);
      if (!found) return;
      imports.push(...found);
      style.textContent = found.reduce((t, imp) => t.replace(imp, ''), text);
    });
    if (imports.length > 0) {
      if (!fontTagRef.current) {
        fontTagRef.current = document.createElement('style');
        fontTagRef.current.setAttribute('data-mx-story-fonts', '');
        document.head.appendChild(fontTagRef.current);
      }
      fontTagRef.current.textContent = imports.join('\n');
    } else {
      fontTagRef.current?.remove();
      fontTagRef.current = null;
    }

    const found: ChartTarget[] = [];
    root.querySelectorAll<HTMLElement>('[data-question-id]').forEach(el => {
      const questionId = parseInt(el.getAttribute('data-question-id') || '', 10);
      if (Number.isNaN(questionId)) return;
      el.replaceChildren(); // drop authored fallback content; the portal takes over
      found.push({ el, questionId });
    });
    // Portal targets only exist after the shadow-root write, so discovery is
    // necessarily effect → state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTargets(found);
  }, [sanitized]);

  // Remove the hoisted font tag when the story unmounts.
  useEffect(() => () => {
    fontTagRef.current?.remove();
    fontTagRef.current = null;
  }, []);

  // Emotion injects chart styles lazily as portal content first renders —
  // re-mirror shortly after, and once more for late async chunks.
  useEffect(() => {
    const root = hostRef.current?.shadowRoot;
    if (!root || targets.length === 0) return;
    mirrorAppStyles(root);
    const t1 = window.setTimeout(() => mirrorAppStyles(root), 250);
    const t2 = window.setTimeout(() => mirrorAppStyles(root), 1500);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
  }, [targets]);

  return (
    <>
      <Box
        ref={hostRef}
        aria-label="Story document"
        width={`${width}px`}
        height={height !== undefined ? `${height}px` : 'auto'}
        position="relative"
        overflow="hidden"
        bg="white"
        color="black"
        // Pin every inheritable typography property inline: inherited
        // properties cross the shadow boundary, so this is the document's
        // baseline regardless of wrapper context (e.g. UA styles that don't
        // inherit, like a <button>'s font).
        style={{
          fontFamily: 'Helvetica, Arial, sans-serif',
          fontSize: '16px',
          fontWeight: 'normal',
          lineHeight: 1.4,
          letterSpacing: 'normal',
          textAlign: 'left',
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
