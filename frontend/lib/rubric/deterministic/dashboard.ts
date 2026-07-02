import type { DashboardContent, DashboardLayoutItem } from '@/lib/types';
import type { RubricFinding } from '../types';
import { finding, isBlank } from './shared';

const MIN_TILE = 3;
const MAX_VISUALS = 9;

function overlaps(a: DashboardLayoutItem, b: DashboardLayoutItem): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Deterministic health findings for a dashboard. Pure function of content. */
export function scoreDashboard(content: DashboardContent): RubricFinding[] {
  const out: RubricFinding[] = [];
  const assets = content.assets ?? [];
  const questionIds = assets.filter((a) => a.type === 'question').map((a) => a.id as number);
  const items = content.layout?.items ?? [];
  const numericLayoutIds = items.filter((i) => typeof i.id === 'number').map((i) => i.id as number);
  // Only validate asset↔layout integrity when an explicit layout exists (else it's auto-laid-out).
  const hasLayout = !!content.layout?.items;

  // no-description (clarity)
  if (isBlank(content.description)) {
    out.push(finding('dashboard.no-description', 'clarity', 'info', 'No description',
      'The dashboard has no description.',
      "Add a description stating the dashboard's decision purpose."));
  }

  // visual-count (clarity — too few/many hurts comprehension, not correctness)
  if (questionIds.length < 1) {
    out.push(finding('dashboard.visual-count', 'clarity', 'error', 'Empty dashboard',
      'The dashboard has no question visuals.',
      "Add 5–9 question tiles that answer the dashboard's decision."));
  } else if (questionIds.length > MAX_VISUALS) {
    out.push(finding('dashboard.visual-count', 'clarity', 'warn', 'Too many visuals',
      `The dashboard has ${questionIds.length} visuals (more than ${MAX_VISUALS}).`,
      'Keep 5–9 visuals per dashboard; split into multiple dashboards or drop low-value charts.'));
  }

  // duplicate-question (correctness — an inconsistent/redundant reference)
  const seen = new Set<number>();
  const dupes = new Set<number>();
  for (const id of questionIds) (seen.has(id) ? dupes : seen).add(id);
  for (const id of dupes) {
    out.push(finding('dashboard.duplicate-question', 'correctness', 'info', 'Duplicated question',
      `Question ${id} is referenced more than once.`,
      `Reference question ${id} once; parameterize instead of duplicating.`));
  }

  if (hasLayout) {
    const layoutIdSet = new Set(numericLayoutIds);
    const questionIdSet = new Set(questionIds);

    // asset-not-in-layout (correctness)
    for (const id of questionIdSet) {
      if (!layoutIdSet.has(id)) {
        out.push(finding('dashboard.asset-not-in-layout', 'correctness', 'error', 'Asset missing from layout',
          `Question ${id} is in assets but has no layout tile.`,
          `Add a layout item (≥3×3) for question ${id}, or remove it from assets.`));
      }
    }
    // layout-orphan (correctness)
    for (const id of layoutIdSet) {
      if (!questionIdSet.has(id)) {
        out.push(finding('dashboard.layout-orphan', 'correctness', 'error', 'Orphan layout item',
          `Layout item ${id} has no matching question asset.`,
          `Remove layout item ${id}, or add the matching question to assets.`));
      }
    }
    // tile-too-small (clarity — too small to read)
    for (const it of items) {
      if (typeof it.id === 'number' && (it.w < MIN_TILE || it.h < MIN_TILE)) {
        out.push(finding('dashboard.tile-too-small', 'clarity', 'warn', 'Tile too small',
          `Tile ${it.id} is ${it.w}×${it.h} (min 3×3).`,
          `Question tiles need ≥3×3 to be legible; enlarge tile ${it.id}.`));
      }
    }
    // tile-overlap (correctness)
    let flaggedOverlap = false;
    for (let i = 0; i < items.length && !flaggedOverlap; i++) {
      for (let j = i + 1; j < items.length; j++) {
        if (overlaps(items[i], items[j])) {
          out.push(finding('dashboard.tile-overlap', 'correctness', 'warn', 'Overlapping tiles',
            `Tiles ${items[i].id} and ${items[j].id} overlap on the grid.`,
            "Reposition tiles so their grid rectangles don't overlap."));
          flaggedOverlap = true;
          break;
        }
      }
    }
  }

  return out;
}
