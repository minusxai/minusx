import { RootProvider } from 'fumadocs-ui/provider/next';
import { JetBrains_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import './global.css';

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
});

export const metadata = {
  title: 'MinusX Docs',
  description: 'Documentation for MinusX — the agentic BI tool',
  icons: { icon: '/favicon.ico' },
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={mono.variable}>
      <body>
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
