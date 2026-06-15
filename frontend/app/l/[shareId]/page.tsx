'use client';

import { use } from 'react';
import SharePageClient from '@/components/share/SharePageClient';

interface SharePageProps {
  params: Promise<{ shareId: string }>;
}

/**
 * Public, unauthenticated landing for a shared data story: https://host/l/<shareId>.
 * Establishes an anonymous guest session, renders the story read-only with live charts,
 * and (when chat is enabled) offers a lead-gated side chat. All access is enforced
 * server-side by the guest session + canAccessFile; this page is just composition.
 */
export default function SharePage({ params }: SharePageProps) {
  const { shareId } = use(params);
  return <SharePageClient shareId={shareId} />;
}
