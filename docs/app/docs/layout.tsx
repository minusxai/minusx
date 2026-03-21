import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import type { ReactNode } from 'react';
import { docsSource } from '@/lib/source';
import { Logo } from '@/components/logo';
import { SidebarTabs } from '@/lib/tabs';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={docsSource.pageTree}
      nav={{
        title: <Logo />,
      }}
      sidebar={{
        banner: <SidebarTabs />,
      }}
    >
      {children}
    </DocsLayout>
  );
}
