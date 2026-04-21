import { MIGRATIONS, applyMigrations, fixData } from '../migrations';
import { MINIMUM_SUPPORTED_DATA_VERSION, LATEST_DATA_VERSION } from '../constants';
import type { InitData } from '../import-export';

describe('Migration registry', () => {
  it('has no pending migrations — all historical migrations are folded into seed data', () => {
    expect(MIGRATIONS).toHaveLength(0);
  });

  it('MINIMUM_SUPPORTED_DATA_VERSION equals LATEST_DATA_VERSION', () => {
    expect(MINIMUM_SUPPORTED_DATA_VERSION).toBe(LATEST_DATA_VERSION);
  });
});

describe('applyMigrations', () => {
  const currentData: InitData = { version: LATEST_DATA_VERSION, users: [], documents: [] };

  it('rejects data below MINIMUM_SUPPORTED_DATA_VERSION', () => {
    expect(() => applyMigrations(currentData, MINIMUM_SUPPORTED_DATA_VERSION - 1)).toThrow(
      /below minimum supported version/
    );
  });

  it('accepts data at MINIMUM_SUPPORTED_DATA_VERSION without throwing', () => {
    expect(() => applyMigrations(currentData, MINIMUM_SUPPORTED_DATA_VERSION)).not.toThrow();
  });

  it('returns data unchanged (modulo fixData) when already at latest version', () => {
    const data: InitData = { version: LATEST_DATA_VERSION, users: [], documents: [] };
    const result = applyMigrations(data, LATEST_DATA_VERSION);
    expect(result.version).toBe(LATEST_DATA_VERSION);
    expect(result.documents).toEqual([]);
  });
});

describe('fixData', () => {
  it('adds missing pivotConfig to pivot questions', () => {
    const data: InitData = {
      version: LATEST_DATA_VERSION,
      users: [],
      documents: [{
        id: 1, name: 'q', path: '/org/q', type: 'question',
        content: { query: '', vizSettings: { type: 'pivot' }, connection_name: '' } as any,
        references: [], version: 1, last_edit_id: null,
        created_at: '2024-01-01', updated_at: '2024-01-01',
      }],
    };
    const result = fixData(data);
    const viz = (result.documents![0].content as any).vizSettings;
    expect(viz.pivotConfig).toEqual({ rows: [], columns: [], values: [] });
  });

  it('migrates legacy viz.colors into styleConfig.colors', () => {
    const colors = ['#ff0000', '#00ff00'];
    const data: InitData = {
      version: LATEST_DATA_VERSION,
      users: [],
      documents: [{
        id: 1, name: 'q', path: '/org/q', type: 'question',
        content: { query: '', vizSettings: { type: 'bar', colors }, connection_name: '' } as any,
        references: [], version: 1, last_edit_id: null,
        created_at: '2024-01-01', updated_at: '2024-01-01',
      }],
    };
    const result = fixData(data);
    const viz = (result.documents![0].content as any).vizSettings;
    expect(viz.styleConfig.colors).toEqual(colors);
  });
});
