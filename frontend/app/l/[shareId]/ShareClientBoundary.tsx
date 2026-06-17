'use client';

import dynamic from 'next/dynamic';

// Render the story body on the client only. Its subtree pulls in browser-only deps
// (the @polyglot-sql/sdk WASM used by the SQL editor/validation) that throw during
// server render. Keeping it `ssr: false` lets the server emit a clean <head> (OG/Twitter
// metadata for crawlers) while the full interactive story renders after hydration — the
// page already shows a spinner while it mints the guest session, so there's no UX change.
// next/dynamic requires the `() => import()` form to enable `ssr: false`; this is the one
// sanctioned use of a dynamic import (not a circular-dep workaround).
// eslint-disable-next-line no-restricted-syntax
const SharePageClient = dynamic(() => import('@/components/share/SharePageClient'), {
  ssr: false,
});

export default function ShareClientBoundary({ shareId }: { shareId: string }) {
  return <SharePageClient shareId={shareId} />;
}
