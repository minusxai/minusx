'use client';

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Box } from '@chakra-ui/react';

import { sanitizeAgentHtml } from '@/lib/html/sanitize-agent-html';
import { mirrorAppStyles } from '@/lib/html/mirror-app-styles';
import { serializeEditedStory } from '@/lib/html/serialize-story';
import SmartEmbeddedQuestionContainer from '@/components/containers/SmartEmbeddedQuestionContainer';
import EmbeddedQuestionContainer from '@/components/containers/EmbeddedQuestionContainer';
import StoryParamControl from '@/components/views/story/StoryParamControl';
import { paramFromPlaceholderEl, storyParamToQuestionParameter, type StoryParam } from '@/lib/data/story-params';
import { inlineQuestionFromEl, inlineEmbedToQuestionContent } from '@/lib/data/story-question';
import type { QuestionContent } from '@/lib/types';

interface ChartTarget {
  el: HTMLElement;
  questionId: number;
}

interface InlineChartTarget {
  el: HTMLElement;
  content: QuestionContent;
  /** single_value: render compact + without the chart-card chrome so the number blends in. */
  bare?: boolean;
}

interface ParamTarget {
  el: HTMLElement;
  param: StoryParam;
}

interface AgentHtmlProps {
  html: string;
  /** Fixed logical canvas width in px (the agent authors against it). */
  width: number;
  /** Fixed canvas height in px; omit for content-driven height (story pages). */
  height?: number;
  /** Public read-only render (shared story): embedded charts hide actions + auth-gated links. */
  readOnly?: boolean;
  /**
   * Fluid mode (mobile): render at 100% of the container width and let the
   * authored flow layout reflow, instead of pinning to `width`px (which the
   * parent then transform-scales). A small CSS shim caps fixed-width chart
   * embeds / media to the viewport so they don't overflow. Designed for the
   * agent's encouraged "stacked full-width sections" layout.
   */
  fluid?: boolean;
  /**
   * Inline edit mode: makes the story's text contenteditable (charts stay
   * locked as atomic, non-editable islands). Read the edited HTML back via the
   * imperative `serialize()` handle.
   */
  editable?: boolean;
  /**
   * Shared story param values (keyed by `<Param name>`). Default/current values; the reader
   * changes them via the inline `<Param>` controls and every embedded `<Question>` re-runs.
   */
  paramValues?: Record<string, unknown>;
  /** Called when the reader changes a param (so the page can persist/submit the values). */
  onParamValuesChange?: (values: Record<string, unknown>) => void;
}

export interface AgentHtmlHandle {
  /** Serialize the live (edited) shadow DOM back to a clean content.story string. */
  serialize: () => string | null;
}

// Placeholder sizing floors/defaults: title bar (~40px) + chart minHeight
// (300px, ChartHost DEFAULT_CHART_STYLE) is the smallest tile that renders
// without clipping.
const MIN_CHART_W = 320;
const MIN_CHART_H = 340;
const DEFAULT_CHART_H = 400;
// single_value embeds are just a number — far smaller floors so they read as inline figures.
const SINGLE_VALUE_MIN_H = 48;
const SINGLE_VALUE_DEFAULT_H = 120;

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
const AgentHtml = forwardRef<AgentHtmlHandle, AgentHtmlProps>(function AgentHtml(
  { html, width, height, readOnly = false, fluid = false, editable = false, paramValues, onParamValuesChange },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fontTagRef = useRef<HTMLStyleElement | null>(null);
  const importsRef = useRef<string[]>([]);
  const [targets, setTargets] = useState<ChartTarget[]>([]);
  const [inlineTargets, setInlineTargets] = useState<InlineChartTarget[]>([]);
  const [paramTargets, setParamTargets] = useState<ParamTarget[]>([]);
  // The shared param context: the reader's current values, seeded once from the story
  // defaults. (AgentHtml remounts via `key` when the story reloads, re-seeding.)
  const [values, setValues] = useState<Record<string, unknown>>(paramValues ?? {});
  const setParamValue = (name: string, v: unknown) => setValues((prev) => {
    const next = { ...prev, [name]: v };
    onParamValuesChange?.(next);
    return next;
  });
  // Param defs (from the placeholders) → the QuestionParameter shape the embeds consume.
  const externalParameters = useMemo(() => paramTargets.map((t) => storyParamToQuestionParameter(t.param)), [paramTargets]);

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

    // Fluid (mobile) shim: cap fixed-width chart embeds and media to the
    // viewport so the authored 1280px layout reflows instead of overflowing.
    // Appended last so it wins ties against the story's own rules. Charts keep
    // their fixed px height (ECharts re-fits width); we never touch <canvas>.
    if (fluid) {
      const shim = document.createElement('style');
      shim.setAttribute('data-mx-fluid-shim', '');
      shim.textContent =
        // min-width:0 lets the embed shrink to its container when it's a flex/grid
        // item (default min-width:auto would otherwise let a wide child — e.g. a
        // many-column table with its own min-width — blow past the story's edge
        // instead of letting the embed's internal overflow:auto scroll).
        '[data-question-id]{max-width:100%!important;width:100%!important;min-width:0!important}' +
        'img,svg,video,table,pre{max-width:100%!important}' +
        'img,video{height:auto!important}';
      root.appendChild(shim);
    }

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
    // Remember the hoisted @imports so edit-mode serialization can put them back
    // into the saved story (they were stripped out of the story's <style>).
    importsRef.current = imports;

    // Sizing contract (dashboards enforce the same idea via DashboardLayoutItem min w/h grid
    // units): honor explicit px sizes, default a missing height, and clamp below-minimum boxes —
    // the tile (title bar + the chart's built-in 300px minHeight) can't physically render
    // smaller, it would just clip. Applied identically to saved and inline embeds.
    const sizeEmbedEl = (el: HTMLElement, minH = MIN_CHART_H, defaultH = DEFAULT_CHART_H) => {
      el.replaceChildren(); // drop authored fallback content; the portal takes over
      // Snapshot the AUTHORED inline style before we clamp, so edit-mode serialization can restore it.
      el.setAttribute('data-mx-osz', el.getAttribute('style') ?? '');
      const px = (v: string) => (v.endsWith('px') ? parseFloat(v) : NaN);
      const w = px(el.style.width);
      if (Number.isFinite(w)) el.style.width = `${Math.max(w, MIN_CHART_W)}px`;
      else if (!el.style.width) el.style.width = '100%';
      const h = px(el.style.height);
      el.style.height = `${Number.isFinite(h) ? Math.max(h, minH) : defaultH}px`;
    };

    const found: ChartTarget[] = [];
    root.querySelectorAll<HTMLElement>('[data-question-id]').forEach(el => {
      const questionId = parseInt(el.getAttribute('data-question-id') || '', 10);
      if (Number.isNaN(questionId)) return;
      sizeEmbedEl(el);
      found.push({ el, questionId });
    });
    // <div data-question-inline="…"> → a story-local inline question (query/connection/viz live
    // in the body, no saved file). Rendered live, just like a saved embed.
    const inlineFound: InlineChartTarget[] = [];
    root.querySelectorAll<HTMLElement>('[data-question-inline]').forEach(el => {
      const embed = inlineQuestionFromEl(el);
      if (!embed) return;
      // A single_value embed is just a styled number — it should NOT get the tall 340px chart-card
      // treatment. Render it COMPACT (small height floor + compact default) and CHROME-LIGHT (no
      // card border/bg) so it blends into the surrounding editorial layout; the agent styles the
      // figure via singleValueConfig + its own container.
      const isSingleValue = embed.vizSettings?.type === 'single_value';
      sizeEmbedEl(el, isSingleValue ? SINGLE_VALUE_MIN_H : MIN_CHART_H, isSingleValue ? SINGLE_VALUE_DEFAULT_H : DEFAULT_CHART_H);
      inlineFound.push({ el, content: inlineEmbedToQuestionContent(embed), bare: isSingleValue });
    });
    // <div data-param-name="…"> → a reader filter control bound to the shared param context.
    const paramsFound: ParamTarget[] = [];
    root.querySelectorAll<HTMLElement>('[data-param-name]').forEach((el) => {
      const param = paramFromPlaceholderEl(el);
      if (!param) return;
      el.replaceChildren();
      paramsFound.push({ el, param });
    });
    // Portal targets only exist after the shadow-root write, so discovery is
    // necessarily effect → state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTargets(found);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInlineTargets(inlineFound);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setParamTargets(paramsFound);
  }, [sanitized, fluid]);

  // Remove the hoisted font tag when the story unmounts.
  useEffect(() => () => {
    fontTagRef.current?.remove();
    fontTagRef.current = null;
  }, []);

  // Inline edit mode: make the story's top-level text containers contenteditable
  // while keeping chart embeds locked as atomic, non-editable islands. Runs after
  // the shadow tree + chart targets exist, and re-applies when `editable` flips —
  // WITHOUT rebuilding the shadow root (that would re-mount the chart portals).
  useEffect(() => {
    const root = hostRef.current?.shadowRoot;
    if (!root) return;
    Array.from(root.children).forEach(el => {
      if (el.tagName === 'STYLE') return;
      (el as HTMLElement).contentEditable = editable ? 'true' : 'inherit';
    });
    root.querySelectorAll<HTMLElement>('[data-question-id],[data-question-inline]').forEach(el => {
      el.contentEditable = 'false';
    });
  }, [editable, targets, inlineTargets, sanitized]);

  // Read the edited story back out as a clean content.story string.
  useImperativeHandle(ref, () => ({
    serialize: () => {
      const root = hostRef.current?.shadowRoot;
      return root ? serializeEditedStory(root, importsRef.current) : null;
    },
  }), []);

  // Emotion injects each embedded chart's styles lazily — only when that tile's
  // body mounts. Tiles mount staggered on idle time (SmartEmbeddedQuestion
  // Container gates each on requestIdleCallback), so a couple of fixed re-mirror
  // timeouts race the late ones: a CSS-based viz like TrendPlot (vs. a
  // self-sizing ECharts canvas) then renders unstyled — collapsed, top-left.
  // Instead, re-mirror whenever the shadow tree itself mutates. A tile mounting
  // its chart DOM is exactly such a mutation, and by then emotion has already
  // inserted that tile's rules into the document sheets, so the copy catches
  // them. Debounced to coalesce bursts; mirrorAppStyles no-ops when unchanged.
  useEffect(() => {
    const root = hostRef.current?.shadowRoot;
    if (!root) return;
    mirrorAppStyles(root);
    let debounce = 0;
    const schedule = () => {
      if (debounce) return;
      debounce = window.setTimeout(() => { debounce = 0; mirrorAppStyles(root); }, 80);
    };
    // childList only (not attributes) — ECharts mutates its canvas attributes
    // every animation frame, which would thrash the (O(rules)) re-mirror.
    const observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true });
    // Belt-and-suspenders for any rule inserted without a shadow-DOM mutation.
    const timers = [250, 1500, 3000].map(ms => window.setTimeout(() => mirrorAppStyles(root), ms));
    return () => {
      observer.disconnect();
      if (debounce) window.clearTimeout(debounce);
      timers.forEach(t => window.clearTimeout(t));
    };
  }, [targets]);

  return (
    <>
      <Box
        ref={hostRef}
        aria-label="Story document"
        width={fluid ? '100%' : `${width}px`}
        height={height !== undefined ? `${height}px` : 'auto'}
        position="relative"
        overflow="hidden"
        // Edit-mode affordance on the host (outside the shadow root, so it is
        // never serialized into the saved story).
        outline={editable ? '2px dashed' : undefined}
        outlineColor="accent.teal"
        outlineOffset="3px"
        // Fluid stories paint their own full-bleed background; a transparent
        // host avoids white gutters when the story's max-width is narrower than
        // the column (and lets dark stories sit on a dark page).
        bg={fluid ? 'transparent' : 'white'}
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
          {/* Stories are a reading surface — charts display only; never open the
              click-to-drill-down popup (regardless of read-only/public). */}
          <SmartEmbeddedQuestionContainer
            questionId={t.questionId}
            showTitle={true}
            index={i}
            readOnly={readOnly}
            enableDrilldown={false}
            externalParameters={externalParameters.length ? externalParameters : undefined}
            externalParamValues={externalParameters.length ? values : undefined}
          />
        </Box>,
        t.el,
        `${i}-${t.questionId}`,
      ))}
      {inlineTargets.map((t, i) => createPortal(
        // Inline story-local question. A regular chart gets the same chart-card chrome as a saved
        // embed (border + bg, no title bar). A single_value (`bare`) renders CHROME-LIGHT —
        // transparent, no border — so the styled number blends into the surrounding design; the
        // agent owns its look via singleValueConfig + its own container. Renders straight from the
        // inline content (no file load).
        <Box
          className="mx-chart-fill"
          {...(t.bare
            ? {}
            : { bg: 'bg.subtle', borderWidth: '1px', borderColor: 'border.default', borderRadius: 'md' })}
          overflow="hidden"
          display="flex"
          flexDirection="column"
        >
          <EmbeddedQuestionContainer
            question={t.content}
            questionId={0}
            externalParameters={externalParameters.length ? externalParameters : undefined}
            externalParamValues={externalParameters.length ? values : undefined}
            enableDrilldown={false}
          />
        </Box>,
        t.el,
        `inline-${i}`,
      ))}
      {paramTargets.map((t, i) => createPortal(
        <StoryParamControl param={t.param} value={values[t.param.name]} onChange={(v) => setParamValue(t.param.name, v)} />,
        t.el,
        `param-${i}-${t.param.name}`,
      ))}
    </>
  );
});

export default AgentHtml;
