/**
 * Browser DOM controller for the shared multi-series tooltip + vertical guide line
 * (Viz Arch V2). Owns the floating `#vg-tooltip-element` (reused across charts) and a
 * per-chart guide `<div>` inside the chart container. The tooltip CONTENT (all series at
 * x, color swatches) is built by the pure `tooltip-plan` module; this only positions and
 * shows/hides. Browser-only.
 */
export class SharedTooltip {
  private el: HTMLElement;
  private guide: HTMLDivElement;

  constructor(private container: HTMLElement, private theme: 'light' | 'dark') {
    // Our OWN element (not Vega's `#vg-tooltip-element`) — sharing it fought the default
    // per-mark tooltip that pie/scatter/maps still use, leaving that one stuck hidden.
    // Both the tooltip and the guide live on <body>, fixed-positioned, so the Vega
    // container rebuilds can't wipe them.
    let el = document.getElementById('mx-shared-tooltip');
    if (!el) {
      el = document.createElement('div');
      el.id = 'mx-shared-tooltip';
      document.body.appendChild(el);
    }
    this.el = el;
    const g = document.createElement('div');
    g.className = 'mx-tt-guide';
    document.body.appendChild(g);
    this.guide = g;
  }

  /**
   * Show the tooltip near the cursor (flipped to stay on-screen) and the vertical guide
   * SNAPPED to a data x. All coordinates are viewport (clientX/Y) pixels.
   */
  show(html: string, geom: { cursorX: number; cursorY: number; guideX: number; guideTop: number; guideHeight: number }): void {
    const el = this.el;
    el.className = `mx-tt-shared${this.theme === 'dark' ? ' dark-theme' : ''}`;
    el.innerHTML = html;
    el.style.position = 'fixed';
    el.style.zIndex = '1000';
    el.style.pointerEvents = 'none';
    el.style.visibility = 'visible';
    el.style.display = 'block';

    const pad = 16;
    const r = el.getBoundingClientRect();
    let x = geom.cursorX + pad;
    let y = geom.cursorY + pad;
    if (x + r.width > window.innerWidth) x = geom.cursorX - r.width - pad;
    if (y + r.height > window.innerHeight) y = geom.cursorY - r.height - pad;
    el.style.left = `${Math.max(4, x)}px`;
    el.style.top = `${Math.max(4, y)}px`;

    const g = this.guide;
    g.style.position = 'fixed';
    g.style.zIndex = '999';
    g.style.pointerEvents = 'none';
    g.style.left = `${geom.guideX}px`;
    g.style.top = `${geom.guideTop}px`;
    g.style.height = `${geom.guideHeight}px`;
    g.style.display = 'block';
  }

  hide(): void {
    this.el.style.display = 'none';
    this.guide.style.display = 'none';
  }

  /** Remove the per-chart guide (the shared tooltip element is left for other charts). */
  destroy(): void {
    this.hide();
    this.guide.remove();
  }
}
