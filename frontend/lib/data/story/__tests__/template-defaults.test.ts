/**
 * New-question default (Viz Arch V2 §21 item 3): a fresh question scaffolds an
 * authoritative V2 `viz` envelope (kind:'table') so it renders + edits as V2 from the
 * first turn. The required `vizSettings` placeholder stays (schema-required; `viz` wins)
 * until item 5 drops the field.
 */
import { describe, it, expect } from 'vitest';
import { getTemplateDefaults } from '../template-defaults';
import type { QuestionContent } from '@/lib/types';

describe('getTemplateDefaults question → V2', () => {
  it('scaffolds a viz envelope (kind:table); born viz-only, no vizSettings', () => {
    const content = getTemplateDefaults('question') as QuestionContent;
    expect(content.viz).toBeTruthy();
    expect(content.viz!.version).toBe(2);
    expect((content.viz!.source as unknown as { kind: string }).kind).toBe('table');
    // vizSettings is optional (viz-first): new questions are born WITHOUT it —
    // on rollback the classic pipeline falls back to a table just-in-time.
    expect('vizSettings' in content).toBe(false);
  });

  it('threads the seed query through', () => {
    const content = getTemplateDefaults('question', { query: 'SELECT 1' }) as QuestionContent;
    expect(content.query).toBe('SELECT 1');
  });
});
