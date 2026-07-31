/**
 * Single source of truth for agent-facing image output (sizing, quality, branding).
 *
 * Dependency-free on purpose: this is the one module that the browser capture path
 * (serialization), the client chart renderer, AND the server Sharp/Resvg renderer can all
 * import without pulling in each other's heavy deps. Every agent-image magic number lives here —
 * do not re-declare these literals at call sites.
 */

// ── Sizing ──────────────────────────────────────────────────────────────────
/**
 * Longest-side cap (px) for every image we send to the agent: chart attachments render at this
 * width, the Screenshot tool caps the file view to it, and region capture caps its crop to it.
 */
export const AGENT_IMAGE_MAX_PX = 512;

/**
 * HEIGHT cap (px) for a FULL-HEIGHT agent capture (the post-edit review screenshot of a whole
 * file view). Without it a long story rasterizes at AGENT_IMAGE_MAX_PX × several-thousand px —
 * pure image tokens for something the model can barely read anyway. The cap DOWNSCALES the whole
 * view (never crops: the review contract is "the whole rendered view"), so at this value an
 * 800×6000 css story lands at 341×2560 instead of 512×3840 — ~1.5× fewer pixels with the width
 * still legible. Raising it costs tokens; lowering it costs legibility (the width shrinks with it).
 */
export const AGENT_IMAGE_MAX_H_PX = 2560;

/**
 * Longest-side cap (px) for an image shown to the USER before it becomes an agent image — today the
 * region-capture crop the annotator displays and lets the user draw on. Larger than
 * AGENT_IMAGE_MAX_PX so the annotator canvas is crisp on a retina screen (a 512px bitmap stretched
 * across the ~720px dialog looks blurry). The annotated result is downscaled to AGENT_IMAGE_MAX_PX
 * only at attach time, so the LLM payload is unchanged — display and send resolutions are decoupled.
 */
export const DISPLAY_IMAGE_MAX_PX = 1536;

/**
 * Supersampling factor for agent images. Charts render off-screen at this ratio then downscale to
 * AGENT_IMAGE_MAX_PX for crisp text; region capture caps the device pixel ratio at this so a retina
 * screen doesn't rasterize the whole view at full DPR.
 */
export const AGENT_IMAGE_PIXEL_RATIO = 2;

// ── Quality ─────────────────────────────────────────────────────────────────
/**
 * JPEG quality (0–1) for every agent image. Used directly by canvas encoders; the
 * server Sharp pipeline takes 0–100, so multiply by 100 there.
 */
export const AGENT_IMAGE_JPEG_QUALITY = 0.85;

// ── Branding (chart watermark) ────────────────────────────────────────────────
/**
 * Square padding (px) framing a watermarked chart; the logo sits in the bottom-right P×P zone.
 * Shared by the client (canvas) and server (Sharp) chart renderers so they stay pixel-aligned.
 */
export const CHART_WATERMARK_PADDING_PX = 48;

/** Logo size as a fraction of CHART_WATERMARK_PADDING_PX (≈20% gap on each side within the P×P zone). */
export const CHART_WATERMARK_LOGO_SCALE = 0.6;
