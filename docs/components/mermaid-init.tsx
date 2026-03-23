'use client';

import { useEffect, useRef } from 'react';
import mermaid from 'mermaid';

let initialized = false;

export function Mermaid({ chart }: { chart: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!initialized) {
      mermaid.initialize({
        startOnLoad: false,
        theme: document.documentElement.classList.contains('dark') ? 'dark' : 'default',
        fontFamily: 'ui-monospace, monospace',
        fontSize: 13,
      });
      initialized = true;
    }

    const id = `mermaid-${Math.random().toString(36).slice(2)}`;
    mermaid.render(id, chart).then(({ svg }) => {
      if (ref.current) ref.current.innerHTML = svg;
    });
  }, [chart]);

  return <div ref={ref} style={{ display: 'flex', justifyContent: 'center', margin: '1.5rem 0' }} />;
}
