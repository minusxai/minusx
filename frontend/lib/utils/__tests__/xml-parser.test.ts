import { describe, it, expect } from 'vitest';
import {
  parseSuggestedQuestions,
  parseTrustInfo,
  extractXmlBlocks,
} from '@/lib/utils/xml-parser';

describe('parseSuggestedQuestions', () => {
  it('extracts each <question> as a trimmed string', () => {
    const xml = `<suggested_questions>
<question>Break it down by vessel type for 2026</question>
<question>How does 2026 compare to 2025 same period?</question>
</suggested_questions>`;
    expect(parseSuggestedQuestions(xml)).toEqual([
      'Break it down by vessel type for 2026',
      'How does 2026 compare to 2025 same period?',
    ]);
  });

  it('returns an empty array when there are no questions', () => {
    expect(parseSuggestedQuestions('<suggested_questions></suggested_questions>')).toEqual([]);
  });
});

describe('parseTrustInfo', () => {
  it('parses level and reasons', () => {
    const xml = `<trust_info level="medium">
<reason>Summed all vessel type columns directly</reason>
</trust_info>`;
    expect(parseTrustInfo(xml)).toEqual({
      level: 'medium',
      reasons: ['Summed all vessel type columns directly'],
    });
  });

  it('returns null when there is no level attribute', () => {
    expect(parseTrustInfo('<trust_info><reason>x</reason></trust_info>')).toBeNull();
  });
});

describe('extractXmlBlocks', () => {
  it('strips both blocks from the text and returns parsed structures', () => {
    const content = `Total ship crossings through the Strait of Hormuz in 2026: 5,147 ships

Want a breakdown by vessel type?

<suggested_questions>
<question>Break it down by vessel type for 2026</question>
<question>How does 2026 compare to 2025 same period?</question>
</suggested_questions>

<trust_info level="medium">
<reason>Summed all vessel type columns directly</reason>
</trust_info>`;

    const result = extractXmlBlocks(content);

    expect(result.text).toBe(
      'Total ship crossings through the Strait of Hormuz in 2026: 5,147 ships\n\nWant a breakdown by vessel type?',
    );
    expect(result.suggestedQuestions).toEqual([
      'Break it down by vessel type for 2026',
      'How does 2026 compare to 2025 same period?',
    ]);
    expect(result.trustInfo).toEqual({
      level: 'medium',
      reasons: ['Summed all vessel type columns directly'],
    });
  });

  it('leaves plain text untouched and returns empty structures', () => {
    const result = extractXmlBlocks('Just a plain reply.');
    expect(result.text).toBe('Just a plain reply.');
    expect(result.suggestedQuestions).toEqual([]);
    expect(result.trustInfo).toBeNull();
  });
});
