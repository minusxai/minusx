/**
 * Design-system CSS for the story being RENDERED, saved or staged.
 *
 * Saved stories carry server-computed `compiledCss` (FilesAPI recomputes on every write). A
 * DRAFT — agent EditFile staged in Redux, or an in-progress WYSIWYG edit — hasn't been saved,
 * so its persisted CSS is absent or stale; this hook fetches the preview compile
 * (POST /api/story-css) for exactly that case and otherwise returns the persisted value
 * without any network traffic. Results are memoized by story text so repeated renders and
 * edit keystrokes don't re-hit the API.
 */
import { useEffect, useMemo, useState } from 'react';
import { hasDesignSystemMarker, type CompiledCssStoryContent } from '@/lib/data/story/story-css';

// eslint-disable-next-line no-restricted-syntax -- client-only hook: the cache lives in one browser tab (keyed by story text), never across server requests
const cache = new Map<string, string | null>();
const CACHE_MAX = 20;

function remember(story: string, css: string | null) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(story, css);
}

/** The design CSS for the current story, plus whether it actually corresponds to
 *  that story. `ready` is false ONLY while we serve a stale/persisted placeholder
 *  because the CURRENT story's compile is still in flight — the caller uses it to
 *  hold the previous styled frame until the new one's CSS lands (no unstyled flash). */
export interface StoryPreviewCss {
  css: string | null;
  ready: boolean;
}

/**
 * @param content the story content being rendered (merged: saved + staged edits)
 * @param dirty   whether the content differs from the last save (persisted CSS may be stale)
 */
export function useStoryPreviewCss(
  content: CompiledCssStoryContent | undefined,
  dirty: boolean,
): StoryPreviewCss {
  const story = content?.story ?? '';
  const persisted = content?.compiledCss ?? null;
  const isJsx = content?.format === 'jsx';
  const marked = isJsx || hasDesignSystemMarker(story);
  const needsPreview = marked && (dirty || persisted === null);
  const cached = needsPreview ? cache.get(story) : undefined;

  // Best available value right now: cached preview → persisted → null. The persisted CSS is
  // served while a stale-preview fetch is in flight so the story never flashes unstyled.
  const [fetched, setFetched] = useState<{ story: string; css: string | null } | null>(null);

  useEffect(() => {
    if (!needsPreview || cached !== undefined) return;
    let cancelled = false;
    const t = setTimeout(() => {
      fetch('/api/story-css', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isJsx ? { story, format: 'jsx' } : { story }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          const css: string | null = j?.data?.css ?? null;
          remember(story, css);
          if (!cancelled) setFetched({ story, css });
        })
        .catch(() => {}); // best-effort: a failed preview just renders with the persisted CSS
    }, 300); // debounce mid-edit keystrokes
    return () => { cancelled = true; clearTimeout(t); };
  }, [needsPreview, cached, story, isJsx]);

  // `ready` = the returned css belongs to THIS story. Only the final fallback
  // (serving persisted/null while the current story's compile is in flight) is not ready.
  // `ready` = the returned css belongs to THIS story. Only the final fallback
  // (serving persisted/null while the current story's compile is in flight) is not ready.
  if (!marked) return { css: null, ready: true };
  if (!needsPreview) return { css: persisted, ready: true };
  if (cached !== undefined) return { css: cached, ready: true };
  if (fetched && fetched.story === story) return { css: fetched.css, ready: true };
  return { css: persisted, ready: false };
}

/**
 * The story body + design CSS to actually RENDER, holding the swap until the two are
 * in sync. An agent edit changes the story; its recompiled Tailwind lands one async
 * round-trip later — rendering the new story before its CSS is ready flashes unstyled.
 * So in VIEW mode we keep serving the previous {story, css} pair until the new story's
 * CSS is `ready`, then swap both together → the surface rebuilds once, already styled.
 *
 * In EDIT mode the story flows live (the WYSIWYG inline-edit transforms read the current
 * story, and a stale body there would be silent data loss). Theme / param values are NOT
 * held — the caller keeps passing those live (a theme pick is an instant attribute change).
 */
export function useHeldStoryRender(
  content: CompiledCssStoryContent | undefined,
  dirty: boolean,
  editing: boolean,
): { story: string; css: string | null } {
  const { css, ready } = useStoryPreviewCss(content, dirty);
  const liveStory = content?.story ?? '';
  const [committed, setCommitted] = useState<{ story: string; css: string | null }>({ story: liveStory, css });
  // Adjust-state-during-render (React re-renders synchronously) — advance only when the
  // pair is in sync (or we're editing, where the story must not lag).
  if ((editing || ready) && (committed.story !== liveStory || committed.css !== css)) {
    setCommitted({ story: liveStory, css });
  }
  return useMemo(() => committed, [committed.story, committed.css]);
}
