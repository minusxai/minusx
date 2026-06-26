/**
 * Single source of truth for agent-facing image output (sizing, quality, branding).
 *
 * Dependency-free on purpose: this is the one module that the browser capture path
 * (html-to-image), the ECharts client renderer, AND the server Sharp/Resvg renderer can all
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
 * Supersampling factor for agent images. Charts render off-screen at this ratio then downscale to
 * AGENT_IMAGE_MAX_PX for crisp text; region capture caps the device pixel ratio at this so a retina
 * screen doesn't rasterize the whole view at full DPR.
 */
export const AGENT_IMAGE_PIXEL_RATIO = 2;

// ── Quality ─────────────────────────────────────────────────────────────────
/**
 * JPEG quality (0–1) for every agent image. Used directly by canvas/html-to-image encoders; the
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
