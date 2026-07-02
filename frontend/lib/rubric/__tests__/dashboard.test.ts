import { describe, it, expect } from 'vitest';
import { scoreDashboard } from '../deterministic/dashboard';
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
      layout: { items: [{ id: 1, x: 0, y: 0, w: 2, h: 4 }] },
    }));
    expect(findings.find((x) => x.ruleId === 'dashboard.tile-too-small')?.severity).toBe('warn');
  });

  it('flags too many visuals (warn > 9) and an empty dashboard (error < 1)', () => {
    const many = Array.from({ length: 11 }, (_, i) => q(i + 1));
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

  it('returns no findings for a healthy dashboard', () => {
    expect(scoreDashboard(makeDashboard())).toEqual([]);
  });
});
