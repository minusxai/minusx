'use client';

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createPortal } from 'react-dom';

import { sanitizeAgentHtml } from '@/lib/html/sanitize-agent-html';
import { mirrorAppStyles } from '@/lib/html/mirror-app-styles';
import { AGENT_IFRAME_CSP } from '@/lib/html/agent-iframe-csp';
import { serializeEditedStory } from '@/lib/html/serialize-story';
import { collectStoryFontImports, resolveImportFontCss } from '@/lib/html/resolve-story-fonts';
import {
  mountStorySurface, autoSizeStorySurface, STORY_FLUID_SHIM_CSS,
  type StorySurface, type StorySurfaceKind,
} from '@/lib/story-surface';
import StoryEmbeds, {
  type ChartTarget, type InlineChartTarget, type NumberTarget, type ParamTarget, type StoryQuestionEditRequest,
} from '@/components/views/shared/StoryEmbeds';
import StoryJsxBody, { type StoryJsxEditApi } from '@/components/views/shared/StoryJsxBody';
import { STORY_FLOATING_CSS } from '@/lib/story-ui';
import { getStoryFontCss, STORY_FONTS_ATTR } from '@/lib/data/story/story-fonts';
import StorySelectionPopover from '@/components/views/story/StorySelectionPopover';
import { paramFromPlaceholderEl, type StoryParam } from '@/lib/data/story/story-params';
import { inlineQuestionFromEl, inlineEmbedToQuestionContent, savedQuestionVizFromEl } from '@/lib/data/story/story-question';
import { envelopeVizType } from '@/lib/viz/viz-templates';
import { numberFromEl } from '@/lib/data/story/story-number';
import type { EditWithAgentSource } from '@/lib/chat/edit-with-agent';

interface AgentHtmlProps {
  html: string;
  /**
   * Story body format. Undefined (default) = legacy sanitized-HTML path (placeholder embeds).
   * 'jsx' = new-format story (Story_Design_V2 §2): `html` carries STATIC JSX source, parsed and
   * rendered through the lib/story-ui interpreter into the same nested-in-iframe React root the
   * legacy path uses for embeds (see StoryJsxBody). WYSIWYG edits commit by AST write-back
   * (applyDomEditsToJsx) — the DOM is render output, never scraped into the file.
   */
  format?: 'jsx';
  /** Fixed logical canvas width in px (the agent authors against it). */
  width: number;
  /** Fixed canvas height in px; omit for content-driven height (story pages). */
  height?: number;
  /** Public read-only render (shared story): embedded charts hide actions + auth-gated links. */
  readOnly?: boolean;
  /** Color mode for the iframe document's dark/light class (sourced by the caller, M4.2). */
  colorMode: 'light' | 'dark';
  /**
   * Design theme (Story_Design_V2 §5) — the story's `content.theme`. Jsx stories only: stamped
   * as `data-theme` on the story root so the compiledCss's `[data-theme]` token blocks (and the
   * matching platform font set) activate. Switching is an attribute change — no doc rebuild.
   */
  theme?: string | null;
  /**
   * Fluid mode (mobile): render at 100% of the container width and let the
   * authored flow layout reflow, instead of pinning to `width`px.
   */
  fluid?: boolean;
  /**
   * Where the story body mounts inside the iframe (see lib/story-surface):
   *  - 'svg' (default, and the only production path) — the body sits in <svg><foreignObject>, so a
   *    capture can serialize the LIVE surface (browser-rendered, snapdom-free).
   *  - 'dom' — the body IS document.body. Kept as the surface abstraction's second implementation
   *    (not selectable via any config).
   */
  surface?: StorySurfaceKind;
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
  /** Request to edit a question embed (saved / override / ephemeral) in the story-level modal. */
  onEditQuestion?: (req: StoryQuestionEditRequest) => void;
  /** When set, a "Interact with {agentName}" pill appears on text selection (edit mode only). */
  selectionSource?: EditWithAgentSource;
  /** Fired (debounced) with the serialized story while editing, so the caller can sync dirty state. */
  onChange?: (story: string) => void;
  /** Path of the file being rendered — forwarded to embeds' /api/query so share guests pass the embed allowlist. */
  filePath?: string;
  /**
   * Server-compiled design-system stylesheet (story content.compiledCss). Injected into the
   * iframe HEAD — before the story's own <body> <style> blocks in document order, so authored
   * CSS wins ties — and never serialized back (the WYSIWYG serializer reads body only).
   */
  compiledCss?: string | null;
}

/** A number-edit request the editor modal can commit: the `apply` closure owns the write-back. */
export interface NumberQueryEdit {
  query: string;
  connection?: string;
  apply: (newQuery: string) => void;
}

/**
 * Request to edit an inline `<Number>`'s query. The legacy html path hands back an `apply`
 * closure (the placeholder's DOM attribute is the working copy); the jsx path hands back the
 * embed's AST path instead — the story view owns the source write-back there
 * (updateNumberQueryInJsx) and normalizes to a {@link NumberQueryEdit} before opening the modal.
 */
export type NumberQueryEditRequest =
  | NumberQueryEdit
  | { query: string; connection?: string; astPath: string };

export interface AgentHtmlHandle {
  /** Serialize the live (edited) iframe DOM back to a clean content.story string. */
  serialize: () => string | null;
}

// Placeholder sizing floors/defaults (same contract as the dashboard grid, and the default the
// skill documents: "Missing height defaults to 430px").
const MIN_CHART_W = 320;
const MIN_CHART_H = 340;
const DEFAULT_CHART_H = 430;
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
  { html, format, width, height, readOnly = false, fluid = false, editable = false, surface: surfaceKind = 'svg', paramValues, onParamValuesChange, onEditNumber, onEditQuestion, selectionSource, onChange, filePath, colorMode, theme, compiledCss },
  ref,
) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const docRef = useRef<Document | null>(null);
  const surfaceRef = useRef<StorySurface | null>(null);
  const reactRootRef = useRef<Root | null>(null);
  const [targets, setTargets] = useState<ChartTarget[]>([]);
  const [inlineTargets, setInlineTargets] = useState<InlineChartTarget[]>([]);
  const [numberTargets, setNumberTargets] = useState<NumberTarget[]>([]);
  const [paramTargets, setParamTargets] = useState<ParamTarget[]>([]);
  // Jsx WYSIWYG: pending-edit access into StoryJsxBody (AST write-back) for serialize().
  const jsxEditApiRef = useRef<StoryJsxEditApi | null>(null);

  const isJsx = format === 'jsx';
  // Legacy path: sanitize + innerHTML-inject. Jsx path: the raw source IS the body input — it is
  // parsed to an AST and interpreted (never injected as HTML), so sanitizeAgentHtml never runs.
  const sanitized = useMemo(() => (isJsx ? '' : sanitizeAgentHtml(html || '')), [html, isJsx]);
  const bodySource = isJsx ? (html || '') : sanitized;

  // ── Build the iframe document + discover embed placeholders ──────────────────────────────────
  useLayoutEffect(() => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!iframe || !doc) return;

    // Fresh document each build. Injected styles do NOT go in <head>: they live INSIDE the story
    // root (Story_Design_V2 §4 self-contained doc) so a serialized capture of the <svg> surface
    // carries them without head-cloning — see the prepend below.
    // Defense-in-depth CSP for the agent-authored document (see lib/html/agent-iframe-csp.ts).
    const CSP = AGENT_IFRAME_CSP;
    // `<base target="_top">`: links inside an iframe navigate the IFRAME by default, which would load
    // the whole app inside it (e.g. clicking an embedded chart's title → /f/<id>). Targeting _top sends
    // every link navigation (chart titles, author links) to the top window instead.
    doc.open();
    doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><base target="_top"></head><body></body></html>`);
    doc.close();
    docRef.current = doc;
    const root = doc.documentElement;
    root.classList.toggle('dark', colorMode === 'dark');
    root.classList.toggle('light', colorMode !== 'dark');
    doc.body.style.margin = '0';
    if (height === undefined) {
      // Content-driven height: the iframe is sized to its content (syncHeight below), so its document
      // must never scroll on its own. body.scrollHeight is an integer while the true content height
      // can be fractional — the sync can leave the iframe ~0.5px short, which Chrome treats as
      // scrollable: a second scrollbar next to the page's, and wheel scrolling jerks through the
      // half-pixel inner range before chaining to the page scroller. Pin vertical overflow shut.
      doc.documentElement.style.overflowY = 'hidden';
      doc.body.style.overflowY = 'hidden';
      // The app's own body{min-height:100dvh} is mirrored in (mirrorAppStyles), and inside the
      // iframe 100dvh = the iframe's CURRENT height — a ratchet: once the iframe grows (side-chat
      // open narrows the pane, text wraps taller), body.scrollHeight can never report smaller and
      // the iframe never shrinks back, leaving a blank void below the story. Pin it off.
      doc.documentElement.style.minHeight = '0';
      doc.body.style.minHeight = '0';
    }
    // Where the story body lives: document.body ('dom') or an <svg><foreignObject> in it ('svg').
    // Everything downstream (embeds, editing, serialization, height) targets `surface.root`, so the
    // renderer difference is confined to lib/story-surface.
    const surface = mountStorySurface(doc, surfaceKind, width);
    surfaceRef.current = surface;
    // Legacy path only: the sanitized story HTML IS the body. A jsx body renders through the
    // interpreter into the nested React root below (portaled into surface.root) — never innerHTML.
    // @import web-fonts load natively inside an iframe (unlike a shadow root) — no hoisting needed.
    if (!isJsx) surface.root.innerHTML = sanitized;

    // ── Injected styles: INSIDE the story root, as data-mx-*-tagged nodes (Story_Design_V2 §4) ──
    // The serialized <svg> subtree must be self-contained, so everything the story depends on lives
    // in-root, not in <head>. Prepend order (first → last): app-styles mirror, compiled Tailwind,
    // floating css, platform fonts — the story's own <style> blocks come later in document order and
    // win ties. Every save path strips these via INJECTED_STYLE_SELECTOR (lib/html/serialize-story).
    const injectedStyles: HTMLStyleElement[] = [];
    const makeStyle = (attr: string, css: string) => {
      const el = doc.createElement('style');
      el.setAttribute(attr, '');
      el.textContent = css;
      injectedStyles.push(el);
    };
    makeStyle('data-mx-app-styles', ''); // filled by mirrorAppStyles below (it finds the tag by attr)
    // Design-system stylesheet (server-compiled Tailwind), via textContent (DOM insertion, not
    // doc.write, so no escaping concerns).
    if (compiledCss) makeStyle('data-mx-tw', compiledCss);
    if (isJsx) {
      // Vendored Tooltip/Popover render un-portaled, and Radix's popper wrapper must be forced to
      // absolute positioning (fixed is broken inside <svg><foreignObject>).
      makeStyle('data-mx-floating', STORY_FLOATING_CSS);
      // Platform-provided fonts (theme registry — lib/data/story/story-fonts.ts; neutral default).
      // Live form is URL-loaded static assets; capture splices data-URIs into the parsed copy only.
      const fontCss = getStoryFontCss(theme ?? undefined);
      if (fontCss) makeStyle(STORY_FONTS_ATTR, fontCss);
      // Design theme (§5): data-theme on the story root activates the compiledCss's
      // [data-theme] token blocks. Changes are synced by the theme effect below (attribute
      // only, no rebuild); this stamp covers fresh documents (theme unchanged across rebuilds).
      if (theme) surface.root.setAttribute('data-theme', theme);
    }
    surface.root.prepend(...injectedStyles);
    mirrorAppStyles(doc);

    // A hidden host for the nested React root that portals the live embeds into the placeholders below.
    // Stays on document.body (NOT the surface root): it renders nothing itself, and keeping it out of
    // the SVG surface means it never lands in a serialized capture.
    const embedRoot = doc.createElement('div');
    embedRoot.setAttribute('data-mx-embed-root', '');
    embedRoot.style.display = 'none';
    doc.body.appendChild(embedRoot);

    // Fluid (mobile) shim: cap fixed-width chart embeds / media to the container so the authored
    // layout reflows instead of overflowing (STORY_FLUID_SHIM_CSS — the other half of the surface's
    // width contract). Appended last so it wins ties. Into the surface root, not the body: on the
    // SVG surface the shim must sit inside the serialized subtree or a capture would render without
    // it (uncapped chart widths).
    if (fluid) {
      const shim = doc.createElement('style');
      shim.setAttribute('data-mx-fluid-shim', '');
      shim.textContent = STORY_FLUID_SHIM_CSS;
      surface.root.appendChild(shim);
    }

    // Sizing contract: honor explicit px sizes, default a missing height, clamp below-minimum boxes.
    // Discovery empties each placeholder into a blank fixed-height box; its React embed only
    // mounts a render pass later. Stamp the placeholder busy so the screenshot readiness wait
    // (waitForFileViewReady) never captures that half-hydrated window — StoryEmbeds clears the
    // stamp after the embed commits (a still-loading embed then carries its own busy marker).
    const sizeEmbedEl = (el: HTMLElement, minH = MIN_CHART_H, defaultH = DEFAULT_CHART_H) => {
      el.replaceChildren();
      el.setAttribute('data-mx-busy', 'true');
      el.setAttribute('data-mx-osz', el.getAttribute('style') ?? '');
      const px = (v: string) => (v.endsWith('px') ? parseFloat(v) : NaN);
      const w = px(el.style.width);
      if (Number.isFinite(w)) el.style.width = `${Math.max(w, MIN_CHART_W)}px`;
      else if (!el.style.width) el.style.width = '100%';
      const h = px(el.style.height);
      el.style.height = `${Number.isFinite(h) ? Math.max(h, minH) : defaultH}px`;
    };

    // Embed placeholder discovery is a LEGACY-path concern: a jsx body has no data-* placeholder
    // divs — its embeds mount as interpreter adapter components (StoryJsxBody). The state setters
    // still run below (with empty arrays) so the render effect re-fires against the fresh root.
    const found: ChartTarget[] = [];
    const inlineFound: InlineChartTarget[] = [];
    const numbersFound: NumberTarget[] = [];
    const paramsFound: ParamTarget[] = [];
    if (!isJsx) {
    doc.querySelectorAll<HTMLElement>('[data-question-id]').forEach(el => {
      const questionId = parseInt(el.getAttribute('data-question-id') || '', 10);
      if (Number.isNaN(questionId)) return;
      sizeEmbedEl(el);
      found.push({ el, questionId, vizOverride: savedQuestionVizFromEl(el) });
    });
    doc.querySelectorAll<HTMLElement>('[data-question-inline]').forEach(el => {
      const embed = inlineQuestionFromEl(el);
      if (!embed) return;
      const isSingleValue = envelopeVizType(embed.viz) === 'single_value';
      sizeEmbedEl(el, isSingleValue ? SINGLE_VALUE_MIN_H : MIN_CHART_H, isSingleValue ? SINGLE_VALUE_DEFAULT_H : DEFAULT_CHART_H);
      inlineFound.push({ el, content: inlineEmbedToQuestionContent(embed), bare: isSingleValue, embed });
    });
    doc.querySelectorAll<HTMLElement>('[data-number-inline]').forEach(el => {
      const embed = numberFromEl(el);
      if (!embed) return;
      el.replaceChildren();
      el.setAttribute('data-mx-busy', 'true'); // cleared by StoryEmbeds on mount (see sizeEmbedEl)
      numbersFound.push({ el, embed });
    });
    doc.querySelectorAll<HTMLElement>('[data-param-name]').forEach(el => {
      const param: StoryParam | null = paramFromPlaceholderEl(el);
      if (!param) return;
      el.replaceChildren();
      el.setAttribute('data-mx-busy', 'true'); // cleared by StoryEmbeds on mount (see sizeEmbedEl)
      paramsFound.push({ el, param });
    });
    }

    // Mount the nested React root for this fresh document. The deferred teardown (cleanup below)
    // can run after the iframe document was already rewritten; React then throws NOT_FOUND
    // detaching orphaned portal nodes — AFTER the embeds' effect cleanups (ECharts dispose,
    // ResizeObserver disconnect) have run. React reports commit-phase errors through this hook
    // (not the unmount() call stack), so suppress exactly that case here; everything else keeps
    // the default console reporting.
    let tearingDown = false;
    reactRootRef.current = createRoot(embedRoot, {
      onUncaughtError: (error) => {
        if (tearingDown && (error as DOMException)?.name === 'NotFoundError') return;
        console.error(error);
      },
    });

    // Discovery is necessarily effect → state (placeholders exist only after the doc write).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTargets(found);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInlineTargets(inlineFound);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNumberTargets(numbersFound);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setParamTargets(paramsFound);

    // Keep the surface sized to its container — as wide as the iframe (fluid only), as tall as its
    // content — at mount and on every later resize (side-chat toggle, window resize). The whole
    // sizing contract (order, fluid gating, ResizeObserver wiring) lives in lib/story-surface, where
    // the real-browser guard (scripts/story-width-matrix.ts) drives it directly.
    const disposeAutoSize = autoSizeStorySurface({ surface, iframe, doc, fluid, fixedHeight: height });

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
      disposeAutoSize();
      observer.disconnect();
      if (debounce) window.clearTimeout(debounce);
      timers.forEach(t => window.clearTimeout(t));
      // Defer unmount: cleanup runs during the parent's commit, and synchronously unmounting another
      // root then warns ("unmount while React was already rendering"). Always unmount — even when the
      // iframe document is already gone (remount rewrote it via doc.open, or the iframe was detached),
      // because unmounting is what runs the embeds' effect cleanups: ECharts dispose(), ResizeObserver
      // disconnects. Skipping it leaks one undisposed chart set per rebuild (ECharts registers every
      // instance until disposed). React runs effect destroys before host-node removal, so the cleanups
      // land even if detaching orphaned portal nodes then throws — onUncaughtError above eats that.
      const root = reactRootRef.current;
      reactRootRef.current = null;
      tearingDown = true;
      if (root) setTimeout(() => { try { root.unmount(); } catch { /* detached doc nodes */ } }, 0);
    };
  }, [bodySource, isJsx, sanitized, fluid, height, compiledCss, surfaceKind, width]); // colorMode + theme handled separately so they don't rebuild the doc

  // Keep the story root's design theme in sync without rebuilding the document — a theme switch
  // is an attribute change only (all [data-theme] token blocks already ship in compiledCss).
  // The platform font set follows the theme (same node the build effect injected).
  useEffect(() => {
    const root = surfaceRef.current?.root;
    if (!root || !isJsx) return;
    if (theme) root.setAttribute('data-theme', theme);
    else root.removeAttribute('data-theme');
    const fontsEl = root.querySelector(`style[${STORY_FONTS_ATTR}]`);
    if (fontsEl) fontsEl.textContent = getStoryFontCss(theme ?? undefined);
  }, [theme, isJsx]);

  // Render (and re-render) the nested embeds root with the latest targets/props.
  // Jsx path: the same nested root instead renders the WHOLE story body (interpreter output),
  // portaled into the story surface root — the StoryEmbeds architecture generalized from
  // "portal each embed into its placeholder" to "portal the interpreted body into the surface".
  useEffect(() => {
    const doc = docRef.current;
    if (!doc || !reactRootRef.current) return;
    if (isJsx) {
      const surfaceRoot = surfaceRef.current?.root;
      if (!surfaceRoot) return;
      reactRootRef.current.render(
        createPortal(
          <StoryJsxBody
            doc={doc}
            jsx={html || ''}
            readOnly={readOnly}
            paramValues={paramValues}
            onParamValuesChange={onParamValuesChange}
            filePath={filePath}
            colorMode={colorMode}
            editable={editable && !readOnly}
            onChange={onChange}
            onEditNumber={onEditNumber}
            onEditQuestion={onEditQuestion}
            editApiRef={jsxEditApiRef}
          />,
          surfaceRoot,
        ),
      );
      return;
    }
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
        onEditQuestion={onEditQuestion}
        storyPath={filePath}
        colorMode={colorMode}
      />,
    );
  }, [targets, inlineTargets, numberTargets, paramTargets, isJsx, html, readOnly, editable, paramValues, onParamValuesChange, onEditNumber, onEditQuestion, filePath, colorMode]);

  // Keep the iframe's color-mode class in sync without rebuilding the whole document.
  useEffect(() => {
    const doc = docRef.current;
    if (!doc) return;
    doc.documentElement.classList.toggle('dark', colorMode === 'dark');
    doc.documentElement.classList.toggle('light', colorMode !== 'dark');
    mirrorAppStyles(doc); // token rules switch on the html.dark/light class
  }, [colorMode]);

  // Resolve the story's @import web-fonts into real @font-face rules in the TOP document.head, so the
  // capture embeds the actual fonts. snapdom's embedCustomFonts reads the GLOBAL document for
  // @font-face (snapdom #441), so fonts that live only in the iframe (or behind a cross-origin
  // @import, snapdom #309) are ignored and the captured title falls back to a wider serif — which
  // wraps an extra line and overlaps the next block. The live iframe keeps using its own @import.
  useEffect(() => {
    const doc = docRef.current;
    if (!doc) return;
    let cancelled = false;
    let tag: HTMLStyleElement | null = null;
    const urls = collectStoryFontImports(doc);
    if (urls.length) {
      resolveImportFontCss(urls).then(css => {
        if (cancelled || !css) return;
        tag = document.createElement('style');
        tag.setAttribute('data-mx-story-fonts', '');
        tag.textContent = css;
        document.head.appendChild(tag);
      }).catch(() => {});
    }
    return () => { cancelled = true; tag?.remove(); };
  }, [bodySource]);

  // Inline edit mode: make the story's top-level text containers contenteditable while keeping chart
  // embeds locked as atomic, non-editable islands. Runs after the doc + targets exist.
  useEffect(() => {
    const root = surfaceRef.current?.root;
    // Jsx stories manage their own scoped contenteditable via React props (StoryJsxBody) —
    // this DOM-level pass is legacy-only (mutating attributes under React would be clobbered).
    if (!root || isJsx) return;
    Array.from(root.children).forEach(el => {
      if (el.tagName === 'STYLE' || el.hasAttribute('data-mx-embed-root')) return;
      (el as HTMLElement).contentEditable = editable ? 'true' : 'inherit';
    });
    root.querySelectorAll<HTMLElement>('[data-question-id],[data-question-inline],[data-number-inline]').forEach(el => {
      el.contentEditable = 'false';
    });
  }, [editable, targets, inlineTargets, numberTargets, sanitized, isJsx]);

  // While editing, sync inline edits out (debounced + flush on focus loss) so the caller can mark the
  // file dirty and the shared header's Save persists them — the iframe DOM is the source of truth.
  //
  // The flush is gated on a REAL user `input` event. Embedded React controls (charts, params)
  // mounting/unmounting inside the iframe fire `focusout` programmatically; an ungated flush then
  // serialized the body MID-HYDRATION (placeholders emptied, embeds half-mounted) and replaced the
  // file's content with that partial echo — wiping an agent EditFile moments after it staged (the
  // "story goes blank after the agent edits" bug). No user input → nothing to sync → no echo.
  useEffect(() => {
    const doc = docRef.current;
    const root = surfaceRef.current?.root;
    if (!doc || !root || !editable || !onChange || isJsx) return;
    let t = 0;
    let userEdited = false;
    // Serialize the SURFACE ROOT, never document.body: on the SVG surface the body also holds the
    // <svg> wrapper + the hidden embed host, which would corrupt the saved story.
    const flush = () => {
      const r = surfaceRef.current?.root;
      if (userEdited && r) onChange(serializeEditedStory(r, []));
    };
    const schedule = () => { userEdited = true; if (t) window.clearTimeout(t); t = window.setTimeout(() => { t = 0; flush(); }, 400); };
    // Listen on the document: events from the editable content bubble up either way, and the SVG
    // surface's content is same-document DOM, so this is identical for both surfaces.
    doc.addEventListener('input', schedule);
    doc.addEventListener('focusout', flush);
    return () => {
      doc.removeEventListener('input', schedule);
      doc.removeEventListener('focusout', flush);
      if (t) window.clearTimeout(t);
    };
  }, [editable, onChange, targets, isJsx]);

  // Read the edited story back out as a clean content.story string.
  useImperativeHandle(ref, () => ({
    serialize: () => {
      // Jsx stories serialize via AST write-back (StoryJsxBody → applyDomEditsToJsx): the
      // current source with pending edits applied, or null when nothing was edited. The DOM
      // is render output, never the source of truth — no DOM scraping.
      if (isJsx) return jsxEditApiRef.current?.serialize() ?? null;
      const root = surfaceRef.current?.root;
      return root ? serializeEditedStory(root, []) : null;
    },
  }), [isJsx]);

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
