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
import { useEffect, useState } from 'react';
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

/**
 * @param content the story content being rendered (merged: saved + staged edits)
 * @param dirty   whether the content differs from the last save (persisted CSS may be stale)
 */
export function useStoryPreviewCss(
  content: CompiledCssStoryContent | undefined,
  dirty: boolean,
): string | null {
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

  if (!marked) return null;
  if (!needsPreview) return persisted;
  if (cached !== undefined) return cached;
  if (fetched && fetched.story === story) return fetched.css;
  return persisted;
}
