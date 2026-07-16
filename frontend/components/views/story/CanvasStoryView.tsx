'use client';

/**
 * Canvas story renderer (Settings → "Use Canvas Renderer").
 *
 * The story's static surface — text, layout, typography, backgrounds — is rendered to a
 * single bitmap by the takumi raster pipeline (lib/canvas-story) and drawn on a <canvas>.
 * Embeds (saved/inline questions, inline numbers, param controls) mount as live islands:
 * absolutely-positioned divs over their measured boxes, hydrated by the SAME StoryEmbeds
 * component the DOM/iframe path uses — so embed behavior is identical by construction.
 *
 * Text selection runs on canvas from the measured run geometry (drag, double-click word,
 * cmd/ctrl+C). Any pipeline failure flips to the DOM fallback passed in via `fallback`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box } from '@chakra-ui/react';
import StoryEmbeds, { type ChartTarget, type InlineChartTarget, type NumberTarget, type ParamTarget } from '@/components/views/shared/StoryEmbeds';
import { renderStoryRaster } from '@/lib/canvas-story/raster';
import { getStoryRenderer, registerFontFaceCss } from '@/lib/canvas-story/renderer.client';
import type { StoryEmbedBox, StoryRasterResult, StoryTextRun } from '@/lib/canvas-story/types';
import { sanitizeAgentHtml } from '@/lib/html/sanitize-agent-html';
import { resolveImportFontCss } from '@/lib/html/resolve-story-fonts';
import { inlineQuestionFromEl, inlineEmbedToQuestionContent } from '@/lib/data/story/story-question';
import { numberFromEl } from '@/lib/data/story/story-number';
import { paramFromPlaceholderEl } from '@/lib/data/story/story-params';

const DPR = 2;
const SELECTION_FILL = 'rgba(59,130,246,0.30)';

export interface CanvasStoryViewProps {
  html: string;
  compiledCss?: string | null;
  width: number;
  readOnly: boolean;
  paramValues?: Record<string, unknown>;
  onParamValuesChange?: (values: Record<string, unknown>) => void;
  storyPath?: string;
  colorMode?: 'light' | 'dark';
  /** Rendered instead when the canvas pipeline fails (DOM/iframe path). */
  fallback: React.ReactNode;
}

interface SelPoint { run: StoryTextRun; off: number; }

const attrShim = (e: StoryEmbedBox) => ({ getAttribute: (name: string) => e.attributes[name] ?? null });

export default function CanvasStoryView(props: CanvasStoryViewProps) {
  const { html, compiledCss, width, readOnly, paramValues, onParamValuesChange, storyPath, colorMode, fallback } = props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bitmapRef = useRef<ImageBitmap | null>(null);
  const selRef = useRef<{ a: SelPoint; b: SelPoint } | null>(null);
  const draggingRef = useRef(false);
  const [result, setResult] = useState<StoryRasterResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [islandEls, setIslandEls] = useState<Record<number, HTMLElement | null>>({});
  // Fluid display: the raster is laid out at `width` CSS px but displayed scaled to the
  // container (like AgentHtml's fluid mode). Geometry maps through `scale`.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerW, setContainerW] = useState<number | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w) setContainerW(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = containerW ? Math.min(1, containerW / width) : 1;

  // ---------- raster ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const renderer = await getStoryRenderer();
      const clean = sanitizeAgentHtml(html);
      const importUrls = [...clean.matchAll(/@import\s+url\((['"]?)([^)'"]+)\1\)/g)].map(m => m[2]);
      const fontCss = importUrls.length ? await resolveImportFontCss(importUrls) : '';
      if (fontCss) await registerFontFaceCss(renderer, fontCss);
      const raster = await renderStoryRaster(renderer, {
        html: clean,
        stylesheets: [compiledCss ?? '', fontCss].filter(Boolean),
        width,
        dpr: DPR,
      });
      if (cancelled) return;
      const blob = new Blob([raster.png as BlobPart], { type: 'image/png' });
      const bitmap = await createImageBitmap(blob);
      if (cancelled) return;
      bitmapRef.current = bitmap;
      setResult(raster);
    })().catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [html, compiledCss, width]);

  // ---------- compositor: bitmap + selection highlight ----------
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const bitmap = bitmapRef.current;
    const raster = result;
    if (!canvas || !bitmap || !raster) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0);
    const sel = selRef.current;
    if (!sel) return;
    const [a, b] = [sel.a, sel.b].sort((p, q) =>
      p.run.block === q.run.block && p.run.y === q.run.y && p.run.x === q.run.x
        ? p.off - q.off
        : runIndex(raster.runs, p.run) - runIndex(raster.runs, q.run));
    const ai = runIndex(raster.runs, a.run);
    const bi = runIndex(raster.runs, b.run);
    ctx.fillStyle = SELECTION_FILL;
    raster.runs.forEach((r, i) => {
      if (i < ai || i > bi) return;
      let x0 = r.x, x1 = r.x + r.w;
      if (i === ai) x0 = r.x + (a.off / Math.max(1, r.text.length)) * r.w;
      if (i === bi) x1 = r.x + (b.off / Math.max(1, r.text.length)) * r.w;
      if (x1 > x0) ctx.fillRect(x0 * DPR, r.y * DPR, (x1 - x0) * DPR, r.h * DPR);
    });
  }, [result]);

  useEffect(() => { draw(); }, [draw]);

  // ---------- selection ----------
  const toStoryPx = useCallback((e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const scale = width / rect.width;
    return [(e.clientX - rect.left) * scale, (e.clientY - rect.top) * scale] as const;
  }, [width]);

  const locate = useCallback((x: number, y: number): SelPoint | null => {
    if (!result) return null;
    let best: StoryTextRun | null = null;
    let bestD = Infinity;
    for (const r of result.runs) {
      const dy = y < r.y ? r.y - y : y > r.y + r.h ? y - (r.y + r.h) : 0;
      const dx = x < r.x ? r.x - x : x > r.x + r.w ? x - (r.x + r.w) : 0;
      const d = dy * 4 + dx;
      if (d < bestD) { bestD = d; best = r; }
    }
    if (!best) return null;
    const frac = Math.min(1, Math.max(0, (x - best.x) / Math.max(1, best.w)));
    return { run: best, off: Math.round(frac * best.text.length) };
  }, [result]);

  const selectedText = useCallback((): string => {
    const sel = selRef.current;
    const raster = result;
    if (!sel || !raster) return '';
    const ai = runIndex(raster.runs, sel.a.run), bi = runIndex(raster.runs, sel.b.run);
    const [lo, hi] = ai <= bi ? [sel.a, sel.b] : [sel.b, sel.a];
    const loI = Math.min(ai, bi), hiI = Math.max(ai, bi);
    let out = '';
    let prev: StoryTextRun | null = null;
    raster.runs.forEach((r, i) => {
      if (i < loI || i > hiI) return;
      let t = r.text;
      if (i === hiI) t = t.slice(0, hi.off);
      if (i === loI) t = t.slice(lo.off);
      if (prev) out += prev.block !== r.block && Math.abs(r.y - prev.y) > 2 ? '\n' : (out.endsWith(' ') || t.startsWith(' ') ? '' : ' ');
      out += t;
      prev = r;
    });
    return out.replace(/ {2,}/g, ' ').replace(/[ \t]+\n/g, '\n');
  }, [result]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const [x, y] = toStoryPx(e);
    const p = locate(x, y);
    if (!p) return;
    selRef.current = { a: p, b: p };
    draggingRef.current = true;
    draw();
  }, [toStoryPx, locate, draw]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!draggingRef.current || !selRef.current) return;
    const [x, y] = toStoryPx(e);
    const p = locate(x, y);
    if (p) { selRef.current = { ...selRef.current, b: p }; draw(); }
  }, [toStoryPx, locate, draw]);

  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    const [x, y] = toStoryPx(e);
    const p = locate(x, y);
    if (!p) return;
    const t = p.run.text;
    const isWord = (c: string) => /[\w$%.,'’-]/.test(c);
    let a = Math.min(p.off, t.length - 1), b = a;
    if (!isWord(t[a] ?? '')) return;
    while (a > 0 && isWord(t[a - 1])) a--;
    while (b < t.length && isWord(t[b])) b++;
    selRef.current = { a: { run: p.run, off: a }, b: { run: p.run, off: b } };
    draw();
  }, [toStoryPx, locate, draw]);

  useEffect(() => {
    const onUp = () => { draggingRef.current = false; };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'c' && selRef.current) {
        const text = selectedText();
        if (text) {
          e.preventDefault();
          void navigator.clipboard.writeText(text);
        }
      }
    };
    window.addEventListener('mouseup', onUp);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mouseup', onUp); window.removeEventListener('keydown', onKey); };
  }, [selectedText]);

  // ---------- embed islands ----------
  const embeds = useMemo(() => result?.embeds ?? [], [result]);
  // Ref callbacks must be identity-stable across renders — a fresh callback per render
  // makes React detach/reattach every ref, and the resulting setState ping-pong loops.
  const islandRefs = useMemo(() => {
    const map = new Map<number, (el: HTMLElement | null) => void>();
    for (const e of embeds) {
      map.set(e.index, (el: HTMLElement | null) => {
        setIslandEls(prev => (prev[e.index] === el ? prev : { ...prev, [e.index]: el }));
      });
    }
    return map;
  }, [embeds]);

  const targets = useMemo(() => {
    const charts: ChartTarget[] = [];
    const inline: InlineChartTarget[] = [];
    const numbers: NumberTarget[] = [];
    const params: ParamTarget[] = [];
    for (const e of embeds) {
      const el = islandEls[e.index];
      if (!el) continue;
      if (e.kind === 'question') {
        const questionId = parseInt(e.ref, 10);
        if (!Number.isNaN(questionId)) charts.push({ el, questionId });
      } else if (e.kind === 'question-inline') {
        const embed = inlineQuestionFromEl(attrShim(e));
        if (embed) inline.push({ el, content: inlineEmbedToQuestionContent(embed), bare: embed.vizSettings?.type === 'single_value' });
      } else if (e.kind === 'number-inline') {
        const embed = numberFromEl(attrShim(e));
        if (embed) numbers.push({ el, embed });
      } else {
        const param = paramFromPlaceholderEl(attrShim(e));
        if (param) params.push({ el, param });
      }
    }
    return { charts, inline, numbers, params };
  }, [embeds, islandEls]);

  if (failed) return <>{fallback}</>;

  return (
    <Box ref={containerRef} position="relative" width="100%" maxW={`${width}px`} aria-label="canvas-story">
      <canvas
        ref={canvasRef}
        width={(result?.width ?? width) * DPR}
        height={(result?.height ?? 0) * DPR}
        style={{ display: 'block', width: `${(result?.width ?? width) * scale}px`, height: `${(result?.height ?? 0) * scale}px`, cursor: 'text' }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onDoubleClick={onDoubleClick}
        aria-label="canvas-story-surface"
      />
      {embeds.map(e => (
        <Box
          key={e.index}
          ref={islandRefs.get(e.index)}
          position="absolute"
          left={`${e.x * scale}px`}
          top={`${e.y * scale}px`}
          width={`${e.w * scale}px`}
          height={e.kind === 'number-inline' || e.kind === 'param' ? undefined : `${e.h * scale}px`}
          minHeight={`${e.h * scale}px`}
          aria-label={`canvas-story-embed-${e.kind}`}
        />
      ))}
      {(targets.charts.length || targets.inline.length || targets.numbers.length || targets.params.length) ? (
        <StoryEmbeds
          doc={document}
          targets={targets.charts}
          inlineTargets={targets.inline}
          numberTargets={targets.numbers}
          paramTargets={targets.params}
          readOnly={readOnly}
          editable={false}
          paramValues={paramValues}
          onParamValuesChange={onParamValuesChange}
          storyPath={storyPath}
          colorMode={colorMode}
        />
      ) : null}
    </Box>
  );
}

function runIndex(runs: StoryTextRun[], run: StoryTextRun): number {
  return runs.indexOf(run);
}
