/**
 * Validates that company-template.json contains only schema-valid question and dashboard documents.
 * This test catches regressions where the seed template gets invalid vizSettings or layout items.
 */

import { validateFileState } from '../content-validators';
import companyTemplate from '../../database/company-template.json';
import type { FileType } from '@/lib/types';

const VALIDATED_TYPES = new Set<FileType>(['question', 'dashboard']);

describe('company-template.json - validateFileState', () => {
  const company = companyTemplate.companies[0];
  const validatableDocs = company.documents.filter(doc =>
    VALIDATED_TYPES.has(doc.type as FileType)
  );

  it('has at least one question and one dashboard to validate', () => {
    const types = validatableDocs.map(d => d.type);
    expect(types).toContain('question');
    expect(types).toContain('dashboard');
  });

  it.each(validatableDocs.map(doc => [doc.path, doc]))(
    '%s is valid',
    (_path, doc) => {
      const error = validateFileState({ type: doc.type as FileType, content: doc.content });
      expect(error).toBeNull();
    }
  );
});
