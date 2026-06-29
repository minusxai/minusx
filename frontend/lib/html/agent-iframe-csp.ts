// Defense-in-depth CSP for the agent-authored HTML iframe (data stories).
//
// The nested React root runs in the TOP realm (it only renders DOM into the iframe) and chart data
// is fetched there too, so NOTHING executes or fetches in the iframe realm — `default-src 'none'`
// (covering script-src/connect-src) blocks any script/exfiltration the sanitizer might miss. Only the
// presentation resources the story needs (styles, web fonts, images) are explicitly allowed. Primary
// defense remains sanitizeAgentHtml; this is a backstop. (Same-origin iframe, so not full isolation.)
//
// `font-src` must include 'self': the app's fonts (JetBrains Mono / Inter) are self-hosted by Next.js
// at same-origin /_next/static/media/*.woff2, and mirrorAppStyles copies their @font-face rules into
// the iframe. Without 'self' those font files are CSP-blocked, so embedded ECharts charts fall back to
// a system font and render with the wrong typeface/size.
export const AGENT_IFRAME_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",  // story + emotion inline styles; @import css
  "font-src 'self' https://fonts.gstatic.com data:",         // self-hosted app fonts + Google web-fonts + data URIs
  "img-src 'self' https: data: blob:",                       // story + chart images
  "media-src 'self' https: data: blob:",
].join('; ');
