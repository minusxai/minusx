// QuestionV2 type is registered end-to-end: its content validates (content is vestigial —
// the query/viz live in the file's `jsx` body), and the template default is produced.
import { describe, it, expect } from 'vitest';
import { validateFileState } from '../content-validators';
import { getTemplateDefaults } from '@/lib/data/template-defaults';

describe('QuestionV2 registration', () => {
  it('validates minimal content (with or without description)', () => {
    expect(validateFileState({ type: 'questionv2', content: { description: '' } })).toBeNull();
    expect(validateFileState({ type: 'questionv2', content: {} })).toBeNull();
  });

  it('rejects malformed content (wrong description type)', () => {
    expect(validateFileState({ type: 'questionv2', content: { description: 123 } })).not.toBeNull();
  });

  it('produces a template default', () => {
    expect(getTemplateDefaults('questionv2')).toEqual({ description: '' });
  });
});
