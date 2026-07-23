'use client';

/**
 * DashboardSurface (Renderer_v2 Phase 8 — self-contained dashboards): hosts the dashboard view
 * in a SAME-ORIGIN IFRAME whose document is self-contained — the chrome stylesheet
 * (lib/dashboard-surface/chrome-css.gen.ts) + the app-styles mirror (fonts residue) are the
 * document's ONLY style sources, injected INSIDE the svg surface root so a serialized capture
 * carries them by construction. Live render and capture read the same style universe: the
 * environment-loss patching the old main-document surface needed (inherited-style snapshot,
 * html-class carry, per-sheet url absolutizing — serialize-surface.ts, deleted) has nothing
 * left to patch.
 *
 * Reuses the story machinery wholesale: `mountStorySurface`/`autoSizeStorySurface` (the svg
 * surface + fluid sizing contract), `StoryEmbedProviders` (nested-root Redux/Chakra/ark
 * environment re-provide — iframe events don't bubble to the parent document, so the dashboard
 * MUST render from a root inside the iframe), and — because the surface svg carries
 * STORY_SVG_ATTR — the story capture path (`findStorySvg`/`serializeStorySvg`) picks dashboards
 * up with zero new code.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createPortal } from 'react-dom';

import { mountStorySurface, autoSizeStorySurface, type StorySurface } from '@/lib/story-surface';
import { mirrorAppStyles } from '@/lib/html/mirror-app-styles';
import { DASHBOARD_CHROME_CSS } from '@/lib/dashboard-surface/chrome-css.gen';
import { SurfaceWidthContext } from '@/lib/dashboard-surface/surface-width';
import { StoryEmbedProviders } from '@/components/views/shared/StoryEmbeds';

interface DashboardSurfaceProps {
  /** The app's color mode — stamped as html.dark/.light on the iframe document. */
  colorMode: 'light' | 'dark';
  /** The dashboard view tree — rendered INSIDE the iframe via a nested React root. */
  children: React.ReactNode;
}

/** Clears the surface root's busy stamp AFTER the nested root's first commit (effects run
 *  post-commit), so the capture readiness gate never settles on an empty surface. */
function ClearBusyStamp({ root }: { root: HTMLElement }) {
  useEffect(() => {
    root.removeAttribute('data-mx-busy');
  }, [root]);
  return null;
}

export default function DashboardSurface({ colorMode, children }: DashboardSurfaceProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const docRef = useRef<Document | null>(null);
  const surfaceRef = useRef<StorySurface | null>(null);
  const reactRootRef = useRef<Root | null>(null);
  // The latest render inputs, so the build effect (mount-only) can render the nested root
  // without listing them as rebuild deps — content changes re-render, never rebuild.
  const renderRef = useRef<{ colorMode: 'light' | 'dark'; children: React.ReactNode }>({ colorMode, children });
  renderRef.current = { colorMode, children };
  // The surface's measured width, provided to the view tree (SurfaceWidthContext): the grid
  // consumes it directly — WidthProvider's polyfill observer is deaf inside the iframe realm.
  const surfaceWidthRef = useRef<number | null>(null);

  const renderNested = () => {
    const doc = docRef.current;
    const surface = surfaceRef.current;
    const root = reactRootRef.current;
    if (!doc || !surface || !root) return;
    const { colorMode: mode, children: content } = renderRef.current;
    root.render(
      createPortal(
        <StoryEmbedProviders doc={doc} colorMode={mode}>
          <SurfaceWidthContext.Provider value={surfaceWidthRef.current}>
            <ClearBusyStamp root={surface.root} />
            {content}
          </SurfaceWidthContext.Provider>
        </StoryEmbedProviders>,
        surface.root,
      ),
    );
  };
  const renderNestedRef = useRef(renderNested);
  renderNestedRef.current = renderNested;

  // ── Build the iframe document ONCE per mount ────────────────────────────────────────────────
  useLayoutEffect(() => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!iframe || !doc) return;

    // `<base target="_top">`: links inside the iframe (tile titles → /f/<id>) must navigate the
    // top window, not load the app inside the surface.
    doc.open();
    doc.write('<!DOCTYPE html><html><head><meta charset="utf-8"><base target="_top"></head><body></body></html>');
    doc.close();
    docRef.current = doc;
    doc.documentElement.classList.toggle('dark', renderRef.current.colorMode === 'dark');
    doc.documentElement.classList.toggle('light', renderRef.current.colorMode !== 'dark');
    doc.body.style.margin = '0';
    // Content-driven height (autoSizeStorySurface sizes the iframe to its content): the inner
    // document must never scroll on its own — same half-pixel-scrollbar contract as AgentHtml.
    doc.documentElement.style.overflowY = 'hidden';
    doc.body.style.overflowY = 'hidden';

    const mountWidth = iframe.clientWidth || doc.body.clientWidth || 1024;
    const surface = mountStorySurface(doc, 'svg', mountWidth);
    surfaceRef.current = surface;
    surfaceWidthRef.current = mountWidth;

    // ── Base text environment ─────────────────────────────────────────────────────────────
    // In the main document the app BODY establishes inherited color + font; this document has
    // no body styles, so unclassed text (heat-map pivot cells, loading copy) fell back to
    // initial BLACK. Establish the base ON THE SURFACE ROOT — inside the captured subtree, so
    // live render and capture stay identical by construction:
    //  - color: the `text-foreground` token class (mode/theme-correct via the chrome sheet);
    //  - font: the same stack globals.css puts on body. Its `--font-inter` (and the mono var
    //    utilities resolve) are next/font variables declared by CLASSES on the TOP <html>,
    //    whose rules live in app link sheets that never reach this document — copy the
    //    RESOLVED values inline instead (mode-independent, capture-safe).
    surface.root.classList.add('text-foreground');
    surface.root.style.fontFamily = "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    (surface.root.style as CSSStyleDeclaration & { webkitFontSmoothing?: string }).webkitFontSmoothing = 'antialiased';
    const topStyle = window.getComputedStyle(document.documentElement);
    for (const v of ['--font-inter', '--font-jetbrains-mono']) {
      const val = topStyle.getPropertyValue(v);
      if (val) surface.root.style.setProperty(v, val);
    }
    // Busy until the nested root commits (cleared by ClearBusyStamp) — the readiness gate
    // must never capture the pre-hydration empty surface.
    surface.root.setAttribute('data-mx-busy', 'true');

    // ── Injected styles: IN-ROOT, so the serialized <svg> subtree is self-contained ──────────
    // Prepend order (first → last): app-styles mirror (fonts + guards), chrome stylesheet.
    // Later wins ties on document order; both precede the rendered content.
    const mirrorTag = doc.createElement('style');
    mirrorTag.setAttribute('data-mx-app-styles', '');
    const chromeTag = doc.createElement('style');
    chromeTag.setAttribute('data-mx-tw', '');
    chromeTag.textContent = DASHBOARD_CHROME_CSS;
    surface.root.prepend(mirrorTag, chromeTag);
    mirrorAppStyles(doc);
    // Late link sheets (fonts) can land after first paint — one delayed re-mirror covers them.
    const mirrorTimer = window.setTimeout(() => { if (docRef.current) mirrorAppStyles(docRef.current); }, 1500);

    // Hidden host for the nested React root. On document.body, NOT the surface root: it renders
    // nothing itself and must never land in a serialized capture.
    const embedRoot = doc.createElement('div');
    embedRoot.setAttribute('data-mx-embed-root', '');
    embedRoot.style.display = 'none';
    doc.body.appendChild(embedRoot);

    let tearingDown = false;
    reactRootRef.current = createRoot(embedRoot, {
      onUncaughtError: (error) => {
        // Deferred teardown can detach orphaned portal nodes after the doc was torn down —
        // suppress exactly that; everything else keeps default reporting (AgentHtml contract).
        if (tearingDown && (error as DOMException)?.name === 'NotFoundError') return;
        console.error(error);
      },
    });
    renderNestedRef.current();

    // Fluid sizing: iframe is 100% of the container; the surface tracks the measured width and
    // the iframe is sized to the content height (page scrolls, never the iframe).
    const disposeAutoSize = autoSizeStorySurface({ surface, iframe, doc, fluid: true });

    // Chromium paint-invalidation workaround (Phase 4/7, verified live): after a RELAYOUT of
    // content inside <foreignObject> (pane toggle → width change → grid re-positions tiles),
    // the screen keeps the stale pixels until an unrelated invalidation. Toggling the svg onto
    // and off its own compositing layer after each committed size change forces the repaint.
    let nudgeRaf = 0;
    const nudge = () => {
      const svg = surface.svg;
      if (!svg || typeof requestAnimationFrame !== 'function') return;
      if (nudgeRaf) cancelAnimationFrame(nudgeRaf);
      nudgeRaf = requestAnimationFrame(() => {
        nudgeRaf = 0;
        svg.style.transform = 'translateZ(0)';
        requestAnimationFrame(() => { svg.style.transform = ''; });
      });
    };
    // Width provision: re-measure on iframe resizes (a TOP-document RO target — natively
    // reliable) and re-render the nested tree with the new width. Trailing 60ms debounce, same
    // rationale as the old SvgPageSurface: consolidate a resize burst into one grid relayout.
    let widthTimer = 0;
    const provideWidth = () => {
      window.clearTimeout(widthTimer);
      widthTimer = window.setTimeout(() => {
        const w = iframe.clientWidth;
        if (w > 0 && w !== surfaceWidthRef.current) {
          surfaceWidthRef.current = w;
          renderNestedRef.current();
        }
        nudge();
      }, 60);
    };
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(provideWidth);
      ro.observe(iframe);
    }

    return () => {
      disposeAutoSize();
      ro?.disconnect();
      if (nudgeRaf) cancelAnimationFrame(nudgeRaf);
      window.clearTimeout(widthTimer);
      window.clearTimeout(mirrorTimer);
      const root = reactRootRef.current;
      reactRootRef.current = null;
      docRef.current = null;
      surfaceRef.current = null;
      tearingDown = true;
      // Deferred unmount (AgentHtml contract): cleanup runs during the parent's commit, and
      // unmounting another root synchronously warns; unmounting is what runs the embeds' effect
      // cleanups, so it must always happen.
      if (root) setTimeout(() => { try { root.unmount(); } catch { /* detached doc */ } }, 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- build once per mount; content/colorMode re-render via the effects below, never rebuild the document
  }, []);

  // Re-render the nested root whenever inputs change (renderRef already holds the latest).
  useEffect(() => {
    renderNestedRef.current();
  }, [children, colorMode]);

  // Keep the iframe's color-mode class in sync without rebuilding the document.
  useEffect(() => {
    const doc = docRef.current;
    if (!doc) return;
    doc.documentElement.classList.toggle('dark', colorMode === 'dark');
    doc.documentElement.classList.toggle('light', colorMode !== 'dark');
  }, [colorMode]);

  return (
    <iframe
      ref={iframeRef}
      title="Dashboard"
      aria-label="Dashboard document"
      style={{
        width: '100%',
        border: 0,
        display: 'block',
        colorScheme: 'normal',
        background: 'transparent',
      }}
    />
  );
}
