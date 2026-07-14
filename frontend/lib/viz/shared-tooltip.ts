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
    // Both the tooltip and the guide live on <body> with FIXED positioning — decoupled
    // from Vega's container DOM (which the renderer rebuilds), so neither gets wiped.
    let el = document.getElementById('vg-tooltip-element');
    if (!el) {
      el = document.createElement('div');
      el.id = 'vg-tooltip-element';
      document.body.appendChild(el);
    }
    this.el = el;
    const g = document.createElement('div');
    g.className = 'mx-tt-guide';
    document.body.appendChild(g);
    this.guide = g;
  }

  /** Show the tooltip near the cursor (flipped to stay on-screen) + a guide down the chart at cursor x. */
  show(event: MouseEvent, html: string): void {
    const el = this.el;
    el.className = `mx-tt-shared${this.theme === 'dark' ? ' dark-theme' : ''}`;
    el.innerHTML = html;
    el.style.position = 'fixed';
    el.style.zIndex = '1000';
    el.style.pointerEvents = 'none';
    el.style.visibility = 'visible';
    el.style.display = 'block';

    const pad = 14;
    const r = el.getBoundingClientRect();
    let x = event.clientX + pad;
    let y = event.clientY + pad;
    if (x + r.width > window.innerWidth) x = event.clientX - r.width - pad;
    if (y + r.height > window.innerHeight) y = event.clientY - r.height - pad;
    el.style.left = `${Math.max(4, x)}px`;
    el.style.top = `${Math.max(4, y)}px`;

    // Guide: a fixed vertical line at the cursor x, spanning the chart container's height.
    const cr = this.container.getBoundingClientRect();
    const g = this.guide;
    g.style.position = 'fixed';
    g.style.zIndex = '999';
    g.style.pointerEvents = 'none';
    g.style.left = `${event.clientX}px`;
    g.style.top = `${cr.top}px`;
    g.style.height = `${cr.height}px`;
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
