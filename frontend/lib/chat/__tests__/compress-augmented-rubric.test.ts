// Auto-inject: the deterministic health rubric is attached to every question/dashboard/story
// CompressedFileState so the agent sees current health (score + fixes) on read/app-state.
import { describe, it, expect } from 'vitest';
import { dbFileToCompressedAugmented } from '@/lib/chat/compress-augmented';
import type { DbFile } from '@/lib/types';

function dbFile(type: string, content: unknown): DbFile {
  return { id: 1, name: 'f', path: `/org/f`, type, content } as unknown as DbFile;
}

describe('auto-injected rubric on compressed file state', () => {
  it('attaches a rubric with findings for an unhealthy question', () => {
    const file = dbFile('question', {
      description: '', query: 'SELECT * FROM t WHERE d > :start', vizSettings: { type: 'table' },
      parameters: null, parameterValues: null, connection_name: 'w', references: null, cachePolicy: null,
    });
    const { fileState } = dbFileToCompressedAugmented(file);
    const findings = fileState.rubric!.categories.flatMap((c) => c.findings);
    const undeclared = findings.find((f) => f.ruleId === 'question.undeclared-param');
    expect(undeclared).toBeDefined();
    expect(undeclared?.source).toBe('rule'); // each finding is tagged rule|llm
  });

  it('attaches a good-grade rubric for a healthy question', () => {
    const file = dbFile('question', {
      description: 'ok', query: 'SELECT 1', vizSettings: { type: 'table' },
      parameters: null, parameterValues: null, connection_name: 'w', references: null, cachePolicy: null,
    });
    const { fileState } = dbFileToCompressedAugmented(file);
    expect(fileState.rubric?.grade).toBe('good');
    expect(fileState.rubric?.overall).toBe(5);
  });

  it('does not attach a rubric to non-scored file types', () => {
    const { fileState } = dbFileToCompressedAugmented(dbFile('folder', {}));
    expect(fileState.rubric).toBeUndefined();
  });
});
