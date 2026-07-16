/**
 * Canvas story renderer — shared contracts.
 *
 * The raster pipeline turns a story's HTML (the `StoryContent.story` field) plus its
 * compiled Tailwind CSS into a single bitmap (PNG bytes) and the geometry needed for
 * interactivity: text runs (selection, links) and embed boxes (live embed islands).
 * All geometry is in CSS pixels relative to the story's top-left, at the given width.
 */

/** One laid-out fragment of text (a line piece within a block). Document order. */
export interface StoryTextRun {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Monotonic id of the layout node this run belongs to — newline boundaries. */
  block: number;
}

export type StoryEmbedKind = 'question' | 'question-inline' | 'number-inline' | 'param';

/** A story embed placeholder's laid-out box; live components are mounted over it. */
export interface StoryEmbedBox {
  kind: StoryEmbedKind;
  /** data-question-id / data-param-name value; raw attribute value. */
  ref: string;
  /** Index among placeholders in document order (stable key). */
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** All attributes on the placeholder — feed production parsers via a getAttribute shim. */
  attributes: Record<string, string>;
}

export interface StoryRasterInput {
  /** The story HTML (StoryContent.story), already sanitized upstream. */
  html: string;
  /** Stylesheets applied in order (compiled Tailwind CSS, font CSS, resets). */
  stylesheets: string[];
  /** Story column width in CSS px. */
  width: number;
  /** Device pixel ratio for the bitmap (geometry is still returned in CSS px). */
  dpr: number;
}

export interface StoryRasterResult {
  /** Encoded PNG of the full story at width*dpr device pixels. */
  png: Uint8Array;
  /** CSS-px dimensions of the story raster. */
  width: number;
  height: number;
  runs: StoryTextRun[];
  embeds: StoryEmbedBox[];
}

/**
 * The engine-facing renderer: satisfied by @takumi-rs/core (native, tests/server)
 * and @takumi-rs/wasm (browser) Renderer instances.
 */
export interface StoryRendererEngine {
  render(node: unknown, options?: unknown): Promise<Uint8Array | Buffer>;
  measure(node: unknown, options?: unknown): Promise<MeasuredNodeLike>;
  registerFont(font: Uint8Array | ArrayBuffer, signal?: AbortSignal): Promise<unknown>;
}

/** Subset of takumi's MeasuredNode we rely on. Transforms are root-absolute. */
export interface MeasuredNodeLike {
  width: number;
  height: number;
  transform?: [number, number, number, number, number, number];
  children?: MeasuredNodeLike[];
  runs?: Array<{ text: string; x: number; y: number; width: number; height: number }>;
}

/** Default sizes assigned to embed placeholders so layout reserves space for islands. */
/** Mirrors AgentHtml's sizeEmbedEl defaults (DEFAULT_CHART_H = 400) for parity. */
export const EMBED_DEFAULT_SIZE: Record<StoryEmbedKind, { width: string | number; height: number }> = {
  question: { width: '100%', height: 400 },
  'question-inline': { width: '100%', height: 400 },
  'number-inline': { width: 90, height: 22 },
  param: { width: 170, height: 34 },
};
