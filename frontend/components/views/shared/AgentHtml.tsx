'use client';

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { sanitizeAgentHtml } from '@/lib/html/sanitize-agent-html';
import { mirrorAppStyles } from '@/lib/html/mirror-app-styles';
import { serializeEditedStory } from '@/lib/html/serialize-story';
import StoryEmbeds, {
  type ChartTarget, type InlineChartTarget, type NumberTarget, type ParamTarget,
} from '@/components/views/shared/StoryEmbeds';
import StorySelectionPopover from '@/components/views/story/StorySelectionPopover';
import { paramFromPlaceholderEl, type StoryParam } from '@/lib/data/story-params';
import { inlineQuestionFromEl, inlineEmbedToQuestionContent } from '@/lib/data/story-question';
import { numberFromEl } from '@/lib/data/story-number';
import type { EditWithAgentSource } from '@/lib/chat/edit-with-agent';
import { useAppSelector } from '@/store/hooks';

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
   * authored flow layout reflow, instead of pinning to `width`px.
   */
  fluid?: boolean;
  /**
   * Inline edit mode: makes the story's text contenteditable (charts stay
   * locked as atomic, non-editable islands). Read the edited HTML back via the
   * imperative `serialize()` handle.
   */
  editable?: boolean;
  /** Shared story param values (keyed by `<Param name>`). Default/current values. */
  paramValues?: Record<string, unknown>;
  /** Called when the reader changes a param (so the page can persist/submit the values). */
  onParamValuesChange?: (values: Record<string, unknown>) => void;
  /** Request to edit an inline `<Number>`'s query (opens a light-DOM Monaco drawer). */
  onEditNumber?: (req: NumberQueryEditRequest) => void;
  /** When set, a "Interact with {agentName}" pill appears on text selection (edit mode only). */
  selectionSource?: EditWithAgentSource;
}

export interface NumberQueryEditRequest {
  query: string;
  connection?: string;
  apply: (newQuery: string) => void;
}

export interface AgentHtmlHandle {
  /** Serialize the live (edited) iframe DOM back to a clean content.story string. */
  serialize: () => string | null;
}

// Placeholder sizing floors/defaults (same contract as the dashboard grid).
const MIN_CHART_W = 320;
const MIN_CHART_H = 340;
const DEFAULT_CHART_H = 400;
const SINGLE_VALUE_MIN_H = 48;
const SINGLE_VALUE_DEFAULT_H = 120;

/**
 * Renders one agent-authored HTML document into a SAME-ORIGIN IFRAME on a fixed-width logical canvas
 * (fixed height for slides, content-driven for story pages). The iframe natively scopes the
 * document's <style> blocks and @import web-fonts (which, unlike a shadow root, just load), while the
 * app's stylesheet rules are mirrored in (mirrorAppStyles) so embedded charts keep the app theme.
 * Scripts/handlers are stripped by sanitizeAgentHtml before injection.
 *
 * Live embeds (charts, inline questions, inline numbers, params) are rendered by a NESTED React root
 * mounted INSIDE the iframe (see StoryEmbeds) and portaled into their `<div data-question-id="N">`-style
 * placeholders — a nested root is required because iframe DOM events don't bubble to the parent
 * document, so the main root's event delegation would never see interactions inside the iframe.
 */
const AgentHtml = forwardRef<AgentHtmlHandle, AgentHtmlProps>(function AgentHtml(
  { html, width, height, readOnly = false, fluid = false, editable = false, paramValues, onParamValuesChange, onEditNumber, selectionSource },
  ref,
) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const docRef = useRef<Document | null>(null);
  const reactRootRef = useRef<Root | null>(null);
  const [targets, setTargets] = useState<ChartTarget[]>([]);
  const [inlineTargets, setInlineTargets] = useState<InlineChartTarget[]>([]);
  const [numberTargets, setNumberTargets] = useState<NumberTarget[]>([]);
  const [paramTargets, setParamTargets] = useState<ParamTarget[]>([]);
  const colorMode = useAppSelector(s => s.ui.colorMode);

  const sanitized = useMemo(() => sanitizeAgentHtml(html || ''), [html]);

  // ── Build the iframe document + discover embed placeholders ──────────────────────────────────
  useLayoutEffect(() => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!iframe || !doc) return;

    // Fresh document each build. <style data-mx-app-styles> sits FIRST (in <head>) so the story's own
    // <style> blocks (in <body>, later in document order) win ties.
    doc.open();
    doc.write('<!DOCTYPE html><html><head><meta charset="utf-8"><style data-mx-app-styles></style></head><body></body></html>');
    doc.close();
    docRef.current = doc;
    const root = doc.documentElement;
    root.classList.toggle('dark', colorMode === 'dark');
    root.classList.toggle('light', colorMode !== 'dark');
    doc.body.style.margin = '0';
    // @import web-fonts load natively inside an iframe (unlike a shadow root) — no hoisting needed.
    doc.body.innerHTML = sanitized;
    mirrorAppStyles(doc);

    // A hidden host for the nested React root that portals the live embeds into the placeholders below.
    const embedRoot = doc.createElement('div');
    embedRoot.setAttribute('data-mx-embed-root', '');
    embedRoot.style.display = 'none';
    doc.body.appendChild(embedRoot);

    // Fluid (mobile) shim: cap fixed-width chart embeds / media to the viewport so the authored layout
    // reflows instead of overflowing. Appended last so it wins ties. Never touches <canvas>.
    if (fluid) {
      const shim = doc.createElement('style');
      shim.setAttribute('data-mx-fluid-shim', '');
      shim.textContent =
        '[data-question-id]{max-width:100%!important;width:100%!important;min-width:0!important}' +
        'img,svg,video,table,pre{max-width:100%!important}img,video{height:auto!important}';
      doc.body.appendChild(shim);
    }

    // Sizing contract: honor explicit px sizes, default a missing height, clamp below-minimum boxes.
    const sizeEmbedEl = (el: HTMLElement, minH = MIN_CHART_H, defaultH = DEFAULT_CHART_H) => {
      el.replaceChildren();
      el.setAttribute('data-mx-osz', el.getAttribute('style') ?? '');
      const px = (v: string) => (v.endsWith('px') ? parseFloat(v) : NaN);
      const w = px(el.style.width);
      if (Number.isFinite(w)) el.style.width = `${Math.max(w, MIN_CHART_W)}px`;
      else if (!el.style.width) el.style.width = '100%';
      const h = px(el.style.height);
      el.style.height = `${Number.isFinite(h) ? Math.max(h, minH) : defaultH}px`;
    };

    const found: ChartTarget[] = [];
    doc.querySelectorAll<HTMLElement>('[data-question-id]').forEach(el => {
      const questionId = parseInt(el.getAttribute('data-question-id') || '', 10);
      if (Number.isNaN(questionId)) return;
      sizeEmbedEl(el);
      found.push({ el, questionId });
    });
    const inlineFound: InlineChartTarget[] = [];
    doc.querySelectorAll<HTMLElement>('[data-question-inline]').forEach(el => {
      const embed = inlineQuestionFromEl(el);
      if (!embed) return;
      const isSingleValue = embed.vizSettings?.type === 'single_value';
      sizeEmbedEl(el, isSingleValue ? SINGLE_VALUE_MIN_H : MIN_CHART_H, isSingleValue ? SINGLE_VALUE_DEFAULT_H : DEFAULT_CHART_H);
      inlineFound.push({ el, content: inlineEmbedToQuestionContent(embed), bare: isSingleValue });
    });
    const numbersFound: NumberTarget[] = [];
    doc.querySelectorAll<HTMLElement>('[data-number-inline]').forEach(el => {
      const embed = numberFromEl(el);
      if (!embed) return;
      el.replaceChildren();
      numbersFound.push({ el, embed });
    });
    const paramsFound: ParamTarget[] = [];
    doc.querySelectorAll<HTMLElement>('[data-param-name]').forEach(el => {
      const param: StoryParam | null = paramFromPlaceholderEl(el);
      if (!param) return;
      el.replaceChildren();
      paramsFound.push({ el, param });
    });

    // Mount the nested React root for this fresh document.
    reactRootRef.current = createRoot(embedRoot);

    // Discovery is necessarily effect → state (placeholders exist only after the doc write).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTargets(found);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInlineTargets(inlineFound);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNumberTargets(numbersFound);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setParamTargets(paramsFound);

    // Content-driven height: keep the iframe as tall as its content (no inner scrollbar).
    let ro: ResizeObserver | undefined;
    const syncHeight = () => {
      if (height === undefined && iframeRef.current && docRef.current) {
        iframeRef.current.style.height = `${docRef.current.body.scrollHeight}px`;
      }
    };
    syncHeight();
    if (height === undefined && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(syncHeight);
      ro.observe(doc.body);
    }

    // Re-mirror app styles whenever the iframe tree mutates — emotion injects each tile's styles lazily
    // (into the MAIN document.head) only when that tile mounts; mirrorAppStyles copies them across.
    let debounce = 0;
    const schedule = () => {
      if (debounce) return;
      debounce = window.setTimeout(() => { debounce = 0; if (docRef.current) mirrorAppStyles(docRef.current); }, 80);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(doc.body, { childList: true, subtree: true });
    const timers = [250, 1500, 3000].map(ms => window.setTimeout(() => { if (docRef.current) mirrorAppStyles(docRef.current); }, ms));

    return () => {
      ro?.disconnect();
      observer.disconnect();
      if (debounce) window.clearTimeout(debounce);
      timers.forEach(t => window.clearTimeout(t));
      // Defer unmount: cleanup runs during the parent's commit, and synchronously unmounting another
      // root then warns ("unmount while React was already rendering"). The iframe doc is torn down with
      // this component, so a microtask-later unmount is safe.
      const root = reactRootRef.current;
      reactRootRef.current = null;
      // Defer so we don't unmount during the parent's commit (React warns about that). Only unmount if
      // the embed host is STILL connected: on a remount / teardown the iframe document is already gone,
      // so its nodes are detached and React's unmount would throw NOT_FOUND trying to detach them — in
      // that case skip and let GC reclaim the orphaned fiber along with the destroyed document.
      if (root) setTimeout(() => { if (embedRoot.isConnected) root.unmount(); }, 0);
    };
  }, [sanitized, fluid, height]); // colorMode handled separately so it doesn't rebuild the doc

  // Render (and re-render) the nested embeds root with the latest targets/props.
  useEffect(() => {
    const doc = docRef.current;
    if (!doc || !reactRootRef.current) return;
    reactRootRef.current.render(
      <StoryEmbeds
        doc={doc}
        targets={targets}
        inlineTargets={inlineTargets}
        numberTargets={numberTargets}
        paramTargets={paramTargets}
        readOnly={readOnly}
        editable={editable}
        paramValues={paramValues}
        onParamValuesChange={onParamValuesChange}
        onEditNumber={onEditNumber}
      />,
    );
  }, [targets, inlineTargets, numberTargets, paramTargets, readOnly, editable, paramValues, onParamValuesChange, onEditNumber]);

  // Keep the iframe's color-mode class in sync without rebuilding the whole document.
  useEffect(() => {
    const doc = docRef.current;
    if (!doc) return;
    doc.documentElement.classList.toggle('dark', colorMode === 'dark');
    doc.documentElement.classList.toggle('light', colorMode !== 'dark');
    mirrorAppStyles(doc); // token rules switch on the html.dark/light class
  }, [colorMode]);

  // Inline edit mode: make the story's top-level text containers contenteditable while keeping chart
  // embeds locked as atomic, non-editable islands. Runs after the doc + targets exist.
  useEffect(() => {
    const doc = docRef.current;
    if (!doc) return;
    Array.from(doc.body.children).forEach(el => {
      if (el.tagName === 'STYLE' || el.hasAttribute('data-mx-embed-root')) return;
      (el as HTMLElement).contentEditable = editable ? 'true' : 'inherit';
    });
    doc.body.querySelectorAll<HTMLElement>('[data-question-id],[data-question-inline],[data-number-inline]').forEach(el => {
      el.contentEditable = 'false';
    });
  }, [editable, targets, inlineTargets, numberTargets, sanitized]);

  // Read the edited story back out as a clean content.story string.
  useImperativeHandle(ref, () => ({
    serialize: () => {
      const doc = docRef.current;
      return doc ? serializeEditedStory(doc.body, []) : null;
    },
  }), []);

  return (
    <>
      <iframe
        ref={iframeRef}
        title="Story document"
        aria-label="Story document"
        style={{
          width: fluid ? '100%' : `${width}px`,
          height: height !== undefined ? `${height}px` : undefined,
          border: 0,
          display: 'block',
          colorScheme: 'normal',
          background: 'transparent',
        }}
      />
      {/* Select-to-chat: a floating Ask/Edit pill on any text selection while editing the story. */}
      {selectionSource && <StorySelectionPopover iframeRef={iframeRef} source={selectionSource} active={editable} />}
    </>
  );
});

export default AgentHtml;
