'use client';

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Box } from '@chakra-ui/react';

import { sanitizeSlideHtml } from '@/lib/deck/sanitize-slide-html';
import SmartEmbeddedQuestionContainer from '@/components/containers/SmartEmbeddedQuestionContainer';

/** Logical slide canvas size — the agent authors HTML against these pixels. */
export const SLIDE_W = 1280;
export const SLIDE_H = 720;

interface ChartTarget {
  el: HTMLElement;
  questionId: number;
}

/**
 * Renders one agent-authored HTML slide at the fixed 1280×720 logical size.
 * The HTML is sanitized (scripts/handlers/style tags stripped), then every
 * `<div data-question-id="N">` placeholder is hydrated with a live embedded
 * question chart via a portal — the placeholders live in innerHTML (outside
 * React's vdom), so targets are re-discovered whenever the HTML changes.
 */
export default function SlideHtml({ html }: { html: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [targets, setTargets] = useState<ChartTarget[]>([]);

  const sanitized = useMemo(() => sanitizeSlideHtml(html || ''), [html]);
  // React 19 diffs dangerouslySetInnerHTML by object REFERENCE — an inline
  // `{{ __html }}` object would re-apply innerHTML on every re-render, wiping
  // the hydrated chart portals. Memoize so innerHTML is only rewritten when
  // the sanitized HTML actually changes.
  const innerHtml = useMemo(() => ({ __html: sanitized }), [sanitized]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const found: ChartTarget[] = [];
    host.querySelectorAll<HTMLElement>('[data-question-id]').forEach(el => {
      const questionId = parseInt(el.getAttribute('data-question-id') || '', 10);
      if (Number.isNaN(questionId)) return;
      el.replaceChildren(); // drop authored fallback content; the portal takes over
      found.push({ el, questionId });
    });
    // Portal targets only exist after the innerHTML commit, so discovery is
    // necessarily effect → state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTargets(found);
  }, [sanitized]);

  return (
    <>
      <Box
        ref={hostRef}
        width={`${SLIDE_W}px`}
        height={`${SLIDE_H}px`}
        position="relative"
        overflow="hidden"
        bg="white"
        color="black"
        dangerouslySetInnerHTML={innerHtml}
      />
      {targets.map((t, i) => createPortal(
        <Box w="100%" h="100%" css={{ '& > div': { height: '100%' } }}>
          <SmartEmbeddedQuestionContainer questionId={t.questionId} showTitle={false} />
        </Box>,
        t.el,
        `${i}-${t.questionId}`,
      ))}
    </>
  );
}
