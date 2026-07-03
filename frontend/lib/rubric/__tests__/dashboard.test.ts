import { describe, it, expect } from 'vitest';
import { scoreDashboard, MIN_TILE_W, MAX_VISUALS, MAX_TEXT_TOKENS, MAX_TEXT_TOKENS_ERROR } from '../deterministic/dashboard';
import type { AssetReference } from '@/lib/types';
import { makeDashboard } from './fixtures';

const ids = (fs: { ruleId: string }[]) => fs.map((f) => f.ruleId);
const q = (id: number): AssetReference => ({ type: 'question', id });

describe('scoreDashboard', () => {
  it('flags a question asset missing from the layout', () => {
    const findings = scoreDashboard(makeDashboard({ assets: [q(5)], layout: { items: [] } }));
    const f = findings.find((x) => x.ruleId === 'dashboard.asset-not-in-layout');
    expect(f?.severity).toBe('error');
    expect(f?.detail).toContain('5');
  });

  it('flags a layout item with no matching asset', () => {
    const findings = scoreDashboard(makeDashboard({
      assets: [q(1)],
      layout: { items: [{ id: 1, x: 0, y: 0, w: 6, h: 4 }, { id: 9, x: 6, y: 0, w: 6, h: 4 }] },
    }));
    expect(findings.find((x) => x.ruleId === 'dashboard.layout-orphan')?.severity).toBe('error');
  });

  it('flags overlapping tiles, but not adjacent ones', () => {
    const overlap = scoreDashboard(makeDashboard({
      assets: [q(1), q(2)],
      layout: { items: [{ id: 1, x: 0, y: 0, w: 4, h: 4 }, { id: 2, x: 2, y: 2, w: 4, h: 4 }] },
    }));
    expect(overlap.find((x) => x.ruleId === 'dashboard.tile-overlap')?.severity).toBe('warn');

    const adjacent = scoreDashboard(makeDashboard({
      assets: [q(1), q(2)],
      layout: { items: [{ id: 1, x: 0, y: 0, w: 4, h: 4 }, { id: 2, x: 4, y: 0, w: 4, h: 4 }] },
    }));
    expect(ids(adjacent)).not.toContain('dashboard.tile-overlap');
  });

  it('flags a tile smaller than 3x3', () => {
    const findings = scoreDashboard(makeDashboard({
      assets: [q(1)],
      layout: { items: [{ id: 1, x: 0, y: 0, w: MIN_TILE_W - 1, h: 4 }] },
    }));
    expect(findings.find((x) => x.ruleId === 'dashboard.tile-too-small')?.severity).toBe('warn');
  });

  it('flags too many visuals (warn) and an empty dashboard (error < 1)', () => {
    const many = Array.from({ length: MAX_VISUALS + 1 }, (_, i) => q(i + 1));
    const tooMany = scoreDashboard(makeDashboard({
      assets: many,
      layout: { items: many.map((_, i) => ({ id: i + 1, x: 0, y: i * 4, w: 6, h: 4 })) },
    }));
    expect(tooMany.find((x) => x.ruleId === 'dashboard.visual-count')?.severity).toBe('warn');

    const empty = scoreDashboard(makeDashboard({ assets: [], layout: { items: [] } }));
    expect(empty.find((x) => x.ruleId === 'dashboard.visual-count')?.severity).toBe('error');
  });

  it('flags a duplicated question reference', () => {
    const findings = scoreDashboard(makeDashboard({
      assets: [q(1), q(1)],
      layout: { items: [{ id: 1, x: 0, y: 0, w: 6, h: 4 }] },
    }));
    expect(findings.find((x) => x.ruleId === 'dashboard.duplicate-question')?.severity).toBe('info');
  });

  it('flags a dashboard with too much inline text', () => {
    const bigText: AssetReference = { type: 'text', id: 'inline-0', content: 'x'.repeat((MAX_TEXT_TOKENS + 50) * 4) };
    const findings = scoreDashboard(makeDashboard({ assets: [q(1), bigText], layout: { items: [{ id: 1, x: 0, y: 0, w: 6, h: 4 }] } }));
    expect(findings.find((x) => x.ruleId === 'dashboard.too-much-text')?.severity).toBe('warn');
  });

  it('escalates to error when inline text is very large', () => {
    const hugeText: AssetReference = { type: 'text', id: 'inline-0', content: 'x'.repeat((MAX_TEXT_TOKENS_ERROR + 50) * 4) };
    const findings = scoreDashboard(makeDashboard({ assets: [q(1), hugeText], layout: { items: [{ id: 1, x: 0, y: 0, w: 6, h: 4 }] } }));
    expect(findings.find((x) => x.ruleId === 'dashboard.too-much-text')?.severity).toBe('error');
  });

  it('flags a dashboard with no parameters (info)', () => {
    const findings = scoreDashboard(makeDashboard({ parameterValues: null }));
    expect(findings.find((x) => x.ruleId === 'dashboard.no-parameters')?.severity).toBe('info');
  });

  it('flags a cartesian plot smaller than 3x3 (needs referenced viz types)', () => {
    const board = makeDashboard({ assets: [q(1)], layout: { items: [{ id: 1, x: 0, y: 0, w: 2, h: 4 }] } });
    // a line chart in a 2-wide tile → too small
    const flagged = scoreDashboard(board, { vizTypeByQuestionId: { 1: 'line' } });
    expect(flagged.find((x) => x.ruleId === 'dashboard.plot-too-small')?.severity).toBe('warn');
    // a single_value in the same tile → fine (no cartesian axes)
    const ok = scoreDashboard(board, { vizTypeByQuestionId: { 1: 'single_value' } });
    expect(ids(ok)).not.toContain('dashboard.plot-too-small');
    // no viz context → check can't run
    expect(ids(scoreDashboard(board))).not.toContain('dashboard.plot-too-small');
  });

  it('returns no findings for a healthy dashboard', () => {
    expect(scoreDashboard(makeDashboard())).toEqual([]);
  });
});
