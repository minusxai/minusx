import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import type { ReactNode } from 'react';
import { guidesSource } from '@/lib/source';
import { Logo } from '@/components/logo';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={guidesSource.pageTree}
      nav={{
        title: <Logo />,
      }}
    >
      {children}
    </DocsLayout>
  );
}
