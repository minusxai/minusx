/**
 * Fluid (mobile) shim CSS injected into a story iframe (AgentHtml) when rendering FLUID, so the
 * authored layout reflows to the viewport instead of overflowing / forcing horizontal scroll.
 *
 * Widget-resize contract: chart embeds are CAPPED to the viewport (`max-width:100%`) but their width
 * is NOT forced to 100%. Forcing it (the previous behavior) overrode an authored/resized inline px
 * width — a widget dragged to `width:640px` still rendered full-cell-width because `width:100%!important`
 * won the cascade. Capping-without-forcing lets a resized px width be honored while still never letting
 * an embed overflow a phone. Embeds authored WITHOUT a width still get `width:100%` inline from
 * AgentHtml.sizeEmbedEl, so they keep filling their cell as before — the shim just stops overriding
 * the ones that DO carry an explicit width.
 */
export function buildFluidShimCss(): string {
  return (
    // Cap chart embeds — saved (data-question-id) AND inline (data-question-inline) — to the viewport,
    // but do NOT force their width (that override breaks px resize). min-width:0 lets them shrink.
    '[data-question-id],[data-question-inline]{max-width:100%!important;min-width:0!important}' +
    // Inline numbers live in prose — clamp their max-width without forcing block width.
    '[data-number-inline]{max-width:100%!important}' +
    // Belt-and-braces: never let the authored document force horizontal scroll/cutoff of the page.
    'img,svg,video,table,pre{max-width:100%!important}img,video{height:auto!important}' +
    'html,body{max-width:100%!important;overflow-x:hidden!important}'
  );
}
