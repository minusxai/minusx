import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import type { ReactNode } from 'react';
import { docsSource } from '@/lib/source';
import { Logo } from '@/components/logo';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={docsSource.pageTree}
      nav={{
        title: <Logo />,
      }}
      sidebar={{
        tabs: {
          transform(option) {
            return { ...option, icon: undefined };
          },
        },
      }}
    >
      {children}
    </DocsLayout>
  );
}
