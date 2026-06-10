'use client';

import AgentHtml from '@/components/views/shared/AgentHtml';

/** Logical slide canvas size — the agent authors HTML against these pixels. */
export const SLIDE_W = 1280;
export const SLIDE_H = 720;

/**
 * Renders one agent-authored HTML slide at the fixed 1280×720 logical size.
 * Sanitization + chart-placeholder hydration live in the shared AgentHtml.
 */
export default function SlideHtml({ html }: { html: string }) {
  return <AgentHtml html={html} width={SLIDE_W} height={SLIDE_H} />;
}
