/**
 * Single source of truth for agent-facing image sizing. Dependency-free so it can be imported
 * from anywhere (browser capture, chart rendering, server tool handlers) without pulling in
 * html-to-image / ECharts.
 */

/**
 * Longest-side cap (px) for every image we send to the agent: chart attachments render at this
 * width, the Screenshot tool caps the file view to it, and region capture caps its crop to it.
 * Keep ALL agent image sizes referencing this one value.
 */
export const AGENT_IMAGE_MAX_PX = 512;
