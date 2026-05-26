'use client';

import { Suspense } from 'react';
import dynamic from 'next/dynamic';

// Disable SSR for the wizard. The content depends on per-user Redux state
// (auth user, setupWizard config, hasConnections result) that the server
// can't render — causing Sentry MINUSX-BI-8 ("Hydration failed because the
// server rendered HTML didn't match the client"). The wizard has no SEO
// benefit from SSR and ships rapidly on first paint either way. Same pattern
// used in components/SqlEditor.tsx and components/plotx/ChartBuilder.tsx.
// eslint-disable-next-line no-restricted-syntax
const HelloWorldContent = dynamic(() => import('./HelloWorldContent').then(m => ({ default: m.HelloWorldContent })), { ssr: false });

export default function HelloWorldPage() {
  return (
    <Suspense>
      <HelloWorldContent />
    </Suspense>
  );
}
