'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function SidebarTabs() {
  const pathname = usePathname();
  const isGuides = pathname.startsWith('/guides');

  return (
    <div style={{
      display: 'flex',
      gap: '4px',
      padding: '4px',
      borderRadius: '8px',
      background: 'var(--color-fd-muted)',
      marginBottom: '12px',
    }}>
      <Link
        href="/docs"
        style={{
          flex: 1,
          textAlign: 'center',
          padding: '6px 12px',
          borderRadius: '6px',
          fontSize: '13px',
          fontWeight: 500,
          textDecoration: 'none',
          transition: 'all 0.15s',
          background: !isGuides ? 'var(--color-fd-primary)' : 'transparent',
          color: !isGuides ? '#ffffff' : 'var(--color-fd-muted-foreground)',
          boxShadow: !isGuides ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
        }}
      >
        Docs
      </Link>
      <Link
        href="/guides"
        style={{
          flex: 1,
          textAlign: 'center',
          padding: '6px 12px',
          borderRadius: '6px',
          fontSize: '13px',
          fontWeight: 500,
          textDecoration: 'none',
          transition: 'all 0.15s',
          background: isGuides ? 'var(--color-fd-primary)' : 'transparent',
          color: isGuides ? '#ffffff' : 'var(--color-fd-muted-foreground)',
          boxShadow: isGuides ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
        }}
      >
        Guides
      </Link>
    </div>
  );
}
