/**
 * The image-variant contract shared by the QA metrics recorder and the report
 * renderer (`scripts/qa-report.ts`).
 *
 * A report's image rows are toggleable — size (mobile vs laptop) and renderer
 * (Playwright's element screenshot vs the app's OWN capture, the one behind
 * ReviewFile / dev-tools "Get image"). Those are properties of the CAPTURE, and
 * the report is generated after the run is over, so the toggle can only switch
 * between images that already exist: the recorder captures the full matrix and
 * the renderer picks one. That is the whole reason this module exists as a
 * contract instead of an option on either side.
 *
 * Dependency-free on purpose — `scripts/qa-report.ts` runs under plain `tsx`
 * and must not pull Playwright in through a transitive import.
 */

export const IMAGE_SIZES = ['laptop', 'mobile'] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];

export const IMAGE_RENDERERS = ['playwright', 'download'] as const;
export type ImageRenderer = (typeof IMAGE_RENDERERS)[number];

export interface ImageVariant {
  size: ImageSize;
  renderer: ImageRenderer;
}

/**
 * What a report shows before anyone touches the settings, and what an image row
 * with NO recorded variant (a pre-matrix run on disk) is read as — laptop width,
 * captured by Playwright — so pre-matrix runs still render.
 */
export const DEFAULT_IMAGE_VARIANT: ImageVariant = { size: 'laptop', renderer: 'playwright' };

/**
 * Viewport width per size. Layout input, not output scale: the story surface
 * tracks its container, so the width is what decides which container-query
 * bands a document lays out in — capturing wide and downscaling would show a
 * layout no phone reader ever sees.
 *
 * `laptop` is 1280 because that is `STORY_CANVAS_WIDTH` — the logical canvas a
 * story is authored against, and the width `lib/headless-capture` renders at
 * for the same reason. `mobile` is 390 (iPhone-class CSS width). Both are
 * DEVICE widths, and the capture loads the document chrome-free so the canvas
 * actually gets them; a capture taken inside the app shell gets whatever the
 * rails and side chat leave over, which is a different layout entirely.
 */
export const VIEWPORT_WIDTH_PX: Record<ImageSize, number> = { laptop: 1280, mobile: 390 };

/** Stable key for one variant — the key of an `ImageSet` in the merged report. */
export function variantKey(variant: ImageVariant): string {
  return `${variant.size}:${variant.renderer}`;
}

/** Human label for the settings UI and the fallback note. */
export function variantLabel(variant: ImageVariant): string {
  return `${variant.size === 'laptop' ? 'Laptop' : 'Mobile'} · ${variant.renderer === 'playwright' ? 'Playwright image' : 'File download'}`;
}

/** Every variant, in display order. */
export function allVariants(): ImageVariant[] {
  return IMAGE_SIZES.flatMap((size) => IMAGE_RENDERERS.map((renderer) => ({ size, renderer })));
}
