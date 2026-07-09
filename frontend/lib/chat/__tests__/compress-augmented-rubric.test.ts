// Rubric v2: the rubric is NO LONGER auto-injected into CompressedFileState (AppState /
// ReadFiles carry no rubric — feedback lands where the agent ACTS: EditFile / CreateFile /
// ReviewFile attach it in their own responses).
import { describe, it, expect } from 'vitest';
import { dbFileToCompressedAugmented } from '@/lib/chat/compress-augmented';
import type { DbFile } from '@/lib/types';

function dbFile(type: string, content: unknown): DbFile {
  return { id: 1, name: 'f', path: `/org/f`, type, content } as unknown as DbFile;
}

describe('compressed file state carries no rubric', () => {
  it('does not attach a rubric to an unhealthy question (ReadFiles/AppState are rubric-free)', () => {
    const file = dbFile('question', {
      description: '', query: 'SELECT * FROM t WHERE d > :start', vizSettings: { type: 'table' },
      parameters: null, parameterValues: null, connection_name: 'w', references: null, cachePolicy: null,
    });
    const { fileState } = dbFileToCompressedAugmented(file);
    expect((fileState as unknown as Record<string, unknown>).rubric).toBeUndefined();
  });

  it('does not attach a rubric to non-scored file types either', () => {
    const { fileState } = dbFileToCompressedAugmented(dbFile('folder', {}));
    expect((fileState as unknown as Record<string, unknown>).rubric).toBeUndefined();
  });
});
