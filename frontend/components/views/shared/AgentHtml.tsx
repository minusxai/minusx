'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Box } from '@chakra-ui/react';

import { sanitizeAgentHtml } from '@/lib/html/sanitize-agent-html';
import { mirrorAppStyles } from '@/lib/html/mirror-app-styles';
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

// Placeholder sizing floors/defaults: title bar (~40px) + chart minHeight
// (300px, ChartHost DEFAULT_CHART_STYLE) is the smallest tile that renders
// without clipping.
const MIN_CHART_W = 320;
const MIN_CHART_H = 340;
const DEFAULT_CHART_H = 400;

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
      // Sizing contract (dashboards enforce the same idea via
      // DashboardLayoutItem min w/h grid units): honor explicit px sizes,
      // default a missing height, and clamp below-minimum boxes — the tile
      // (title bar + the chart's built-in 300px minHeight) can't physically
      // render smaller, it would just clip.
      const px = (v: string) => (v.endsWith('px') ? parseFloat(v) : NaN);
      const w = px(el.style.width);
      if (Number.isFinite(w)) el.style.width = `${Math.max(w, MIN_CHART_W)}px`;
      else if (!el.style.width) el.style.width = '100%';
      const h = px(el.style.height);
      el.style.height = `${Number.isFinite(h) ? Math.max(h, MIN_CHART_H) : DEFAULT_CHART_H}px`;
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
        // The same tile the dashboard renders (DashboardView grid item):
        // flex-column box + SmartEmbedded with clickable title and actions.
        <Box
          className="mx-chart-fill"
          bg="bg.subtle"
          borderWidth="1px"
          borderColor="border.default"
          borderRadius="md"
          overflow="hidden"
          display="flex"
          flexDirection="column"
        >
          <SmartEmbeddedQuestionContainer questionId={t.questionId} showTitle={true} index={i} />
        </Box>,
        t.el,
        `${i}-${t.questionId}`,
      ))}
    </>
  );
}
