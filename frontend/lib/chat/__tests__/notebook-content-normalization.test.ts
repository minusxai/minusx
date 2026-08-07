import { describe, expect, it } from 'vitest';
import { dbFileToFileState } from '@/lib/chat/compress-augmented';
import type { DbFile } from '@/lib/types';

describe('legacy notebook result normalization', () => {
  it('drops persisted cellResults when a notebook enters client state', () => {
    const file = {
      id: 7,
      name: 'Notebook',
      path: '/org/notebook',
      type: 'notebook',
      content: {
        description: null,
        cells: [],
        cellResults: { old: { data: { columns: ['n'], types: ['int'], rows: [{ n: 1 }] } } },
      },
      references: [],
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
      version: 1,
      last_edit_id: null,
      draft: false,
      meta: null,
    } as unknown as DbFile;

    expect(dbFileToFileState(file).content).not.toHaveProperty('cellResults');
  });
});
