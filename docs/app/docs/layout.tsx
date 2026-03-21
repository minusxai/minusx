import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import type { ReactNode } from 'react';
import { docsSource } from '@/lib/source';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={docsSource.pageTree}
      nav={{ title: 'MinusX' }}
      sidebar={{ tabs: { transform(option, node) { return { ...option, icon: undefined }; } } }}
    >
      {children}
    </DocsLayout>
  );
}
