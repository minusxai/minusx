/**
 * Backfill: heal stored `story` documents bloated by the historical serialize bugs (nested
 * `data-mx-story-root` wrappers + leaked inline-`<Number>` popover DOM). Enumerates every story
 * across all modes/paths, reruns the fixed serialize over its stored HTML (`healStoryHtml`), and
 * writes back only the ones that actually shrink. Data-layer module (uses DocumentDB directly, like
 * migrate-conversations-v3.server) invoked by `scripts/heal-stories.ts`.
 */
import { DocumentDB } from '@/lib/database/documents-db';
import { healStoryHtml } from '@/lib/html/heal-story.server';
import type { StoryContent } from '@/lib/types';

export interface HealedStory {
  id: number;
  path: string;
  beforeBytes: number;
  afterBytes: number;
}

export interface HealStoriesReport {
  total: number;
  healed: HealedStory[];
  skipped: number;
  totalBytesBefore: number;
  totalBytesAfter: number;
  dry: boolean;
}

export async function healStories({ dry = false }: { dry?: boolean } = {}): Promise<HealStoriesReport> {
  const stories = await DocumentDB.listAll('story', undefined, undefined, true);
  const report: HealStoriesReport = {
    total: stories.length, healed: [], skipped: 0, totalBytesBefore: 0, totalBytesAfter: 0, dry,
  };

  for (const file of stories) {
    const content = file.content as StoryContent | null;
    const story = content?.story;
    if (!story) { report.skipped++; continue; }

    const { html, changed } = healStoryHtml(story);
    if (!changed) { report.skipped++; continue; }

    report.healed.push({ id: file.id, path: file.path, beforeBytes: story.length, afterBytes: html.length });
    report.totalBytesBefore += story.length;
    report.totalBytesAfter += html.length;

    if (!dry) {
      const nextContent: StoryContent = { ...content, story: html };
      await DocumentDB.update(
        file.id, file.name, file.path, nextContent, file.references ?? [],
        `heal-stories-${file.id}-v${file.version ?? 1}`,
      );
    }
  }

  return report;
}
