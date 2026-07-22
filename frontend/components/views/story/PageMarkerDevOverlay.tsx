'use client';

/**
 * DEV-ONLY preview of the position markers that get baked into the agent's app-state screenshot.
 * Renders the SAME numbering (lib/screenshot/page-markers.ts) as an absolutely-positioned overlay on
 * the LIVE file view, so a developer can see exactly which content falls under which section number
 * without having to send a message and inspect the captured image. Pure (no Redux) — the container
 * gates it on devMode. Never shown to end users, never captured (it's live DOM the agent path draws
 * its own gutter for; this overlay is not what snapdom serializes because it mounts outside
 * data-file-id's captured subtree at the same offset).
 *
 * Anchored to its parent (which must be `position: relative`); measured via ResizeObserver so the
 * markers track the story's height as embeds load and reflow.
 */
import { useEffect, useRef, useState } from 'react';
import { pageMarkers } from '@/lib/screenshot/page-markers';

export function PageMarkerDevOverlay({ enabled, colorMode }: { enabled: boolean; colorMode: 'light' | 'dark' }) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const update = () => setHeight(parent.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [enabled]);

  if (!enabled) return null;
  const dark = colorMode === 'dark';
  const line = dark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.14)';
  const badgeBg = dark ? '#0D1117' : '#FFFFFF';
  const badgeBorder = dark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)';
  const badgeFg = dark ? '#E6EDF3' : '#1F2328';

  return (
    <div ref={ref} aria-hidden aria-label="Page marker dev overlay" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 4 }}>
      {pageMarkers(height).map((m) => (
        <div key={m.label} style={{ position: 'absolute', top: m.y, left: 0, right: 0 }}>
          {m.y > 0 && <div style={{ borderTop: `1px dashed ${line}`, width: '100%' }} />}
          <div
            style={{
              position: 'absolute',
              top: 4,
              left: 4,
              minWidth: 22,
              height: 22,
              padding: '0 6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 5,
              background: badgeBg,
              border: `1px solid ${badgeBorder}`,
              color: badgeFg,
              font: '600 13px ui-monospace, "SF Mono", Menlo, monospace',
            }}
          >
            {m.label}
          </div>
        </div>
      ))}
    </div>
  );
}
