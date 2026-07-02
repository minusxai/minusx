import type { DashboardContent, DashboardLayoutItem } from '@/lib/types';
import type { DeterministicContext, RubricFinding } from '../types';
import { estimateTokens, finding, isBlank } from './shared';

const MIN_TILE = 3;
export const MIN_TILE_W = 2;
export const MIN_TILE_H = 2;
export const MAX_VISUALS = 15;
export const MAX_TEXT_TOKENS = 400;
// Cartesian plots need real 2-D room to read; a sliver tile is unreadable.
export const MIN_PLOT_TILE = 3;
export const PLOT_VIZ_TYPES = new Set(['line', 'area', 'bar', 'scatter']);

function overlaps(a: DashboardLayoutItem, b: DashboardLayoutItem): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Deterministic health findings for a dashboard. `ctx.vizTypeByQuestionId` (from the resolved
 *  references) enables tile-type-aware rules like cartesian-plots-need-3x3. */
export function scoreDashboard(content: DashboardContent, ctx?: DeterministicContext): RubricFinding[] {
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

  // no-parameters (clarity, info — dashboards are far more useful when filterable)
  if (Object.keys(content.parameterValues ?? {}).length === 0) {
    out.push(finding('dashboard.no-parameters', 'clarity', 'info', 'No parameters',
      'The dashboard has no parameters/filters.',
      'Add shared parameters (e.g. a date range or region filter) so viewers can slice the data — dashboards are far more useful when interactive.'));
  }

  // visual-count (clarity — too few/many hurts comprehension, not correctness)
  if (questionIds.length < 1) {
    out.push(finding('dashboard.visual-count', 'clarity', 'error', 'Empty dashboard',
      'The dashboard has no question visuals.',
      `Add ${MIN_TILE}–${MAX_VISUALS} question tiles that answer the dashboard's decision.`));
  } else if (questionIds.length > MAX_VISUALS) {
    out.push(finding('dashboard.visual-count', 'clarity', 'warn', 'Too many visuals',
      `The dashboard has ${questionIds.length} visuals (more than ${MAX_VISUALS}).`,
      `Keep ${MIN_TILE}–${MAX_VISUALS} visuals per dashboard; split into multiple dashboards or drop low-value charts.`));
  }

  // too-much-text (clarity — a dashboard should be mostly visuals, not walls of prose)
  const textTokens = estimateTokens(assets.map((a) => (a.type === 'text' ? a.content ?? '' : '')).join('\n'));
  if (textTokens > MAX_TEXT_TOKENS) {
    out.push(finding('dashboard.too-much-text', 'clarity', 'warn', 'Too much text',
      `The dashboard's inline text is ~${textTokens} tokens (over ${MAX_TEXT_TOKENS}).`,
      'Trim inline text to short annotations — a dashboard should be mostly visuals; move long prose into a story.'));
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
          `Add a layout item for question ${id}, or remove it from assets.`));
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
      if (typeof it.id === 'number' && (it.w < MIN_TILE_W || it.h < MIN_TILE_H)) {
        out.push(finding('dashboard.tile-too-small', 'clarity', 'warn', 'Tile too small',
          `Tile ${it.id} is ${it.w}×${it.h} (min ${MIN_TILE_W}×${MIN_TILE_H}).`,
          `Question tiles need ≥${MIN_TILE_W}×${MIN_TILE_H} to be legible; enlarge tile ${it.id}.`));
      }
    }
    // plot-too-small (clarity — cartesian plots need ≥3×3 to read; needs the tile's chart type)
    const vizById = ctx?.vizTypeByQuestionId;
    if (vizById) {
      for (const it of items) {
        if (typeof it.id !== 'number') continue;
        const vt = vizById[it.id];
        if (vt && PLOT_VIZ_TYPES.has(vt) && (it.w < MIN_PLOT_TILE || it.h < MIN_PLOT_TILE)) {
          out.push(finding('dashboard.plot-too-small', 'clarity', 'warn', 'Plot tile too small',
            `Tile ${it.id} is a ${vt} chart at ${it.w}×${it.h}; cartesian plots need ≥${MIN_PLOT_TILE}×${MIN_PLOT_TILE} to read.`,
            `Resize tile ${it.id} to at least ${MIN_PLOT_TILE}×${MIN_PLOT_TILE}, or use a compact viz (single_value / table).`));
        }
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
