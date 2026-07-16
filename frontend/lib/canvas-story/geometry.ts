import { MeasuredNodeLike, StoryEmbedBox, StoryTextRun } from '@/lib/canvas-story/types';
import { embedKindOf } from '@/lib/canvas-story/node-tree';

/**
 * Extract interaction geometry by walking the source node tree in parallel with the
 * measured tree. Two takumi behaviors this accounts for (canvas-arch.md §4.7):
 * - the measured tree prunes whitespace-only text children → filter before pairing;
 * - a synthetic wrapper level can appear at the root → descend when child counts
 *   mismatch and the measured node has a single run-less child.
 *
 * Node transforms are root-absolute; run x/y are content-box-relative — block text is
 * pre-wrapped (node-tree.ts) so runs attach to a node whose transform already includes
 * padding. All output is divided by dpr into CSS px.
 */

interface SrcNodeLike {
  type?: string;
  text?: string;
  tagName?: string;
  attributes?: Record<string, string>;
  children?: SrcNodeLike[];
}

export function extractGeometry(
  srcRoot: SrcNodeLike,
  measuredRoot: MeasuredNodeLike,
  dpr: number,
): { runs: StoryTextRun[]; embeds: StoryEmbedBox[] } {
  const runs: StoryTextRun[] = [];
  const embeds: StoryEmbedBox[] = [];
  let blockSeq = 0;
  let embedSeq = 0;

  // Pairing keeps only element-like children: bare text never becomes a measured
  // child node (its runs live on the parent), so it must not participate in pairing.
  const isMeaningful = (c: SrcNodeLike) => c.type !== 'text' || !!c.tagName;

  function walk(src: SrcNodeLike | null, m: MeasuredNodeLike): void {
    const x = m.transform?.[4] ?? 0;
    const y = m.transform?.[5] ?? 0;

    const embed = embedKindOf(src ?? undefined);
    if (embed) {
      embeds.push({
        kind: embed.kind, ref: embed.ref, index: embedSeq++,
        x: x / dpr, y: y / dpr, w: m.width / dpr, h: m.height / dpr,
        attributes: { ...(src?.attributes ?? {}) },
      });
      return; // placeholders have no content of interest below them
    }

    const blockId = blockSeq++;
    for (const r of m.runs ?? []) {
      if (!r.text.trim()) continue;
      runs.push({
        text: r.text, block: blockId,
        x: (x + r.x) / dpr, y: (y + r.y) / dpr, w: r.width / dpr, h: r.height / dpr,
      });
    }

    let srcKids = src ? (src.children ?? []).filter(isMeaningful) : [];
    const mKids = m.children ?? [];
    if (srcKids.length !== mKids.length && mKids.length === 1 && !(m.runs ?? []).length) {
      // synthetic wrapper level present only in the measured tree
      walk(src, mKids[0]);
      return;
    }
    if (srcKids.length !== mKids.length) srcKids = [];
    mKids.forEach((child, i) => walk(srcKids[i] ?? null, child));
  }

  walk(srcRoot, measuredRoot);
  return { runs, embeds };
}
