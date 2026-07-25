/** Tooltip chrome must follow charts into iframe documents; globals.css only styles the app document. */
const STYLE_ID = 'mx-viz-tooltip-styles';

const TOOLTIP_CSS = `
#vg-tooltip-element,
#mx-shared-tooltip {
  z-index: 100002 !important;
  font-family: var(--font-jetbrains-mono, 'JetBrains Mono', monospace);
  font-size: 11px;
  line-height: 1.6;
  border: none !important;
  border-radius: 9px;
  padding: 9px 12px;
  color: inherit;
}
#vg-tooltip-element.dark-theme,
#mx-shared-tooltip.dark-theme {
  background: rgba(22, 27, 34, 0.96);
  color: #e6edf3;
  box-shadow: 0 8px 28px -8px rgba(0, 0, 0, 0.65), inset 0 0 0 0.5px rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(3px);
}
#vg-tooltip-element:not(.dark-theme),
#mx-shared-tooltip:not(.dark-theme) {
  background: rgba(255, 255, 255, 0.98);
  color: #1f2328;
  box-shadow: 0 8px 28px -8px rgba(20, 27, 45, 0.22), inset 0 0 0 0.5px rgba(20, 27, 45, 0.08);
  backdrop-filter: blur(3px);
}
#vg-tooltip-element table { border-collapse: collapse; }
#vg-tooltip-element table tr td { padding-top: 1px; padding-bottom: 1px; }
#vg-tooltip-element table tr td.key {
  opacity: 0.55;
  max-width: 150px;
  padding-right: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: text-top;
  font-weight: 500;
  text-align: right;
}
#vg-tooltip-element table tr td.value {
  display: block;
  max-width: 300px;
  max-height: 7em;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 600;
  text-align: left;
}
#mx-shared-tooltip { min-width: 132px; }
.mx-tt-shared .mx-tt-head { opacity: 0.5; font-size: 10.5px; margin-bottom: 5px; letter-spacing: 0.2px; }
.mx-tt-shared .mx-tt-row { display: flex; align-items: center; padding: 1.5px 0; }
.mx-tt-shared .mx-tt-dot { width: 8px; height: 8px; border-radius: 2px; flex: none; margin-right: 8px; }
.mx-tt-shared .mx-tt-name { opacity: 0.82; }
.mx-tt-shared .mx-tt-val { margin-left: auto; padding-left: 20px; font-weight: 600; }
`;

export function ensureTooltipStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = TOOLTIP_CSS;
  doc.head.appendChild(style);
}
