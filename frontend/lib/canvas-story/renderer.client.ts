'use client';

import initWasm, { Renderer } from '@takumi-rs/wasm';
import { StoryRendererEngine } from '@/lib/canvas-story/types';

/**
 * Browser-side takumi renderer singleton. The wasm binary is served from
 * /public/takumi (copied from @takumi-rs/wasm) and fetched lazily on first use;
 * fonts register once per page load.
 */

let rendererPromise: Promise<StoryRendererEngine> | null = null;

// Registration order defines the fallback chain: Inter first so unmatched sans
// stacks fall back to Inter (not mono). Serif files are registered under the
// concrete family names in Tailwind's font-serif stack so `font-serif` matches.
const BASE_FONTS: Array<{ url: string; name?: string }> = [
  { url: '/fonts/Inter-Variable.ttf' },
  { url: '/fonts/NotoSerif-Regular.ttf', name: 'Georgia' },
  { url: '/fonts/NotoSerif-Italic.ttf', name: 'Georgia' },
  { url: '/fonts/NotoSerif-Regular.ttf', name: 'ui-serif' },
  { url: '/fonts/NotoSerif-Italic.ttf', name: 'ui-serif' },
  { url: '/fonts/JetBrainsMono-Regular.ttf' },
  { url: '/fonts/JetBrainsMono-Bold.ttf' },
];

async function fetchBuffer(url: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

async function createRenderer(): Promise<StoryRendererEngine> {
  await initWasm({ module_or_path: fetch('/takumi/takumi_wasm_bg.wasm') });
  const renderer = new Renderer();
  for (const font of BASE_FONTS) {
    const buf = await fetchBuffer(font.url);
    if (!buf) continue;
    try {
      await renderer.registerFont(font.name ? ({ name: font.name, data: new Uint8Array(buf) } as never) : new Uint8Array(buf));
    } catch { /* best-effort: a bad face must not sink the renderer */ }
  }
  return renderer as unknown as StoryRendererEngine;
}

export function getStoryRenderer(): Promise<StoryRendererEngine> {
  if (!rendererPromise) rendererPromise = createRenderer();
  return rendererPromise;
}

// eslint-disable-next-line no-restricted-syntax -- client-only module ('use client'): per-browser-tab font dedup cache, never runs server-side
const registeredFontUrls = new Set<string>();

/**
 * Register story-declared fonts: given @font-face CSS (from resolveImportFontCss),
 * fetch each `src: url(...)` binary and register it. Best-effort, deduped per URL.
 */
export async function registerFontFaceCss(renderer: StoryRendererEngine, fontCss: string): Promise<void> {
  const urls = [...fontCss.matchAll(/url\((['"]?)([^)'"]+)\1\)/g)]
    .map(m => m[2])
    .filter(u => /\.(woff2?|ttf|otf)(\?|$)/i.test(u));
  for (const url of urls) {
    if (registeredFontUrls.has(url)) continue;
    registeredFontUrls.add(url);
    const buf = await fetchBuffer(url);
    if (!buf) continue;
    try {
      await renderer.registerFont(new Uint8Array(buf));
    } catch {
      // unsupported format — skip silently, fallback fonts cover it
    }
  }
}
