import { parseThinkingAnswer, combineContent } from '../xml-parser';

describe('parseThinkingAnswer', () => {
  describe('Basic parsing', () => {
    it('should parse single thinking and single answer block', () => {
      const content = '<thinking>Analysis here</thinking><answer>Final result</answer>';
      const parsed = parseThinkingAnswer(content);

      expect(parsed).not.toBeNull();
      expect(parsed!.thinking).toEqual(['Analysis here']);
      expect(parsed!.answer).toEqual(['Final result']);
      expect(parsed!.unparsed).toBe('');
    });

    it('should parse multiple thinking blocks', () => {
      const content = '<thinking>First thought</thinking><thinking>Second thought</thinking><answer>Result</answer>';
      const parsed = parseThinkingAnswer(content);

      expect(parsed).not.toBeNull();
      expect(parsed!.thinking).toEqual(['First thought', 'Second thought']);
      expect(parsed!.answer).toEqual(['Result']);
    });

    it('should parse multiple answer blocks', () => {
      const content = '<thinking>Analysis</thinking><answer>First part</answer><answer>Second part</answer>';
      const parsed = parseThinkingAnswer(content);

      expect(parsed).not.toBeNull();
      expect(parsed!.thinking).toEqual(['Analysis']);
      expect(parsed!.answer).toEqual(['First part', 'Second part']);
    });

    it('should parse interleaved thinking and answer blocks', () => {
      const content = '<thinking>Think 1</thinking><answer>Answer 1</answer><thinking>Think 2</thinking><answer>Answer 2</answer>';
      const parsed = parseThinkingAnswer(content);

      expect(parsed).not.toBeNull();
      expect(parsed!.thinking).toEqual(['Think 1', 'Think 2']);
      expect(parsed!.answer).toEqual(['Answer 1', 'Answer 2']);
    });
  });

  describe('Mixed content', () => {
    it('should capture content before first tag as unparsed', () => {
      const content = 'Some intro text\n<thinking>Analysis</thinking><answer>Result</answer>';
      const parsed = parseThinkingAnswer(content);

      expect(parsed).not.toBeNull();
      expect(parsed!.unparsed).toBe('Some intro text');
      expect(parsed!.thinking).toEqual(['Analysis']);
      expect(parsed!.answer).toEqual(['Result']);
    });

    it('should handle content with newlines and formatting', () => {
      const content = `<thinking>
Let me analyze the data...
Looking at the results...
      </thinking>
      <answer>
Based on my analysis, the revenue is $1.2M.
      </answer>`;
      const parsed = parseThinkingAnswer(content);

      expect(parsed).not.toBeNull();
      expect(parsed!.thinking.length).toBe(1);
      expect(parsed!.thinking[0]).toContain('Let me analyze');
      expect(parsed!.answer.length).toBe(1);
      expect(parsed!.answer[0]).toContain('revenue is $1.2M');
    });
  });

  describe('Edge cases', () => {
    it('should return null for content without tags', () => {
      const content = 'Just plain text without any XML tags';
      const parsed = parseThinkingAnswer(content);

      expect(parsed).toBeNull();
    });

    it('should return null for empty content', () => {
      const parsed = parseThinkingAnswer('');
      expect(parsed).toBeNull();
    });

    it('should return null for null content', () => {
      const parsed = parseThinkingAnswer(null as any);
      expect(parsed).toBeNull();
    });

    it('should handle empty tags', () => {
      const content = '<thinking></thinking><answer>Result</answer>';
      const parsed = parseThinkingAnswer(content);

      expect(parsed).not.toBeNull();
      expect(parsed!.thinking).toEqual([]);
      expect(parsed!.answer).toEqual(['Result']);
    });

    it('should handle tags with only whitespace', () => {
      const content = '<thinking>   \n  </thinking><answer>Result</answer>';
      const parsed = parseThinkingAnswer(content);

      expect(parsed).not.toBeNull();
      expect(parsed!.thinking).toEqual([]);
      expect(parsed!.answer).toEqual(['Result']);
    });

    it('should return null if no tags were successfully parsed', () => {
      const content = '<thinking></thinking><answer></answer>';
      const parsed = parseThinkingAnswer(content);

      expect(parsed).toBeNull();
    });
  });

  describe('Streaming support', () => {
    it('should immediately show incomplete thinking content while streaming', () => {
      const content = '<thinking>Exploring schem';
      const parsed = parseThinkingAnswer(content, true);

      expect(parsed).not.toBeNull();
      expect(parsed!.thinking).toEqual(['Exploring schem']);
      expect(parsed!.answer).toEqual([]);
    });

    it('should immediately show incomplete answer content while streaming', () => {
      const content = '<answer>I have found th';
      const parsed = parseThinkingAnswer(content, true);

      expect(parsed).not.toBeNull();
      expect(parsed!.thinking).toEqual([]);
      expect(parsed!.answer).toEqual(['I have found th']);
    });

    it('should show incomplete thinking content with preceding text', () => {
      const content = 'Some intro <thinking>Partial content';
      const parsed = parseThinkingAnswer(content, true);

      expect(parsed).not.toBeNull();
      expect(parsed!.unparsed).toBe('Some intro');
      expect(parsed!.thinking).toEqual(['Partial content']);
      expect(parsed!.answer).toEqual([]);
    });

    it('should handle streaming with complete and incomplete tags', () => {
      const content = '<thinking>Complete thought</thinking><answer>Partial ans';
      const parsed = parseThinkingAnswer(content, true);

      expect(parsed).not.toBeNull();
      expect(parsed!.thinking).toEqual(['Complete thought']);
      expect(parsed!.answer).toEqual(['Partial ans']);
    });

    it('should treat incomplete tag as partial content when not streaming', () => {
      const content = 'Complete content <thinking>Partial';
      const parsed = parseThinkingAnswer(content, false);

      expect(parsed).not.toBeNull();
      expect(parsed!.thinking).toEqual(['Partial']);
    });

    it('should not mark incomplete if tag is closed', () => {
      const content = '<thinking>Complete</thinking>';
      const parsed = parseThinkingAnswer(content, true);

      expect(parsed).not.toBeNull();
      expect(parsed!.thinking).toEqual(['Complete']);
    });
  });

  describe('Case sensitivity', () => {
    it('should require lowercase tags (model always outputs lowercase)', () => {
      // The model is instructed to output lowercase tags, so we only support that
      const uppercaseContent = '<THINKING>Analysis</THINKING><ANSWER>Result</ANSWER>';
      const uppercaseParsed = parseThinkingAnswer(uppercaseContent);
      expect(uppercaseParsed).toBeNull();

      const lowercaseContent = '<thinking>Analysis</thinking><answer>Result</answer>';
      const lowercaseParsed = parseThinkingAnswer(lowercaseContent);
      expect(lowercaseParsed).not.toBeNull();
      expect(lowercaseParsed!.thinking).toEqual(['Analysis']);
      expect(lowercaseParsed!.answer).toEqual(['Result']);
    });
  });

  describe('Malformed XML', () => {
    it('should handle unclosed tags gracefully', () => {
      const content = '<thinking>Unclosed tag without ending';
      const parsed = parseThinkingAnswer(content, false);

      // When not streaming, treat as partial content
      expect(parsed).not.toBeNull();
      expect(parsed!.thinking).toEqual(['Unclosed tag without ending']);
    });

    it('should gracefully handle mismatched tags as incomplete', () => {
      const content = '<thinking>Some text</answer>';
      const parsed = parseThinkingAnswer(content, false);

      // Mismatched tags are treated as incomplete thinking content
      // This is acceptable graceful degradation
      expect(parsed).not.toBeNull();
      expect(parsed!.thinking).toEqual(['Some text</answer>']);
    });
  });
});

describe('combineContent', () => {
  it('should combine unparsed, thinking, and answer sections', () => {
    const parsed = {
      thinking: ['Think 1', 'Think 2'],
      answer: ['Answer 1', 'Answer 2'],
      unparsed: 'Intro text',
    };

    const combined = combineContent(parsed, true);
    expect(combined).toContain('Intro text');
    expect(combined).toContain('Think 1');
    expect(combined).toContain('Think 2');
    expect(combined).toContain('Answer 1');
    expect(combined).toContain('Answer 2');
  });

  it('should exclude thinking when includeThinking is false', () => {
    const parsed = {
      thinking: ['Think 1'],
      answer: ['Answer 1'],
      unparsed: 'Intro',
    };

    const combined = combineContent(parsed, false);
    expect(combined).toContain('Intro');
    expect(combined).not.toContain('Think 1');
    expect(combined).toContain('Answer 1');
  });

  it('should join sections with double newlines', () => {
    const parsed = {
      thinking: ['Think 1', 'Think 2'],
      answer: ['Answer 1'],
      unparsed: '',
    };

    const combined = combineContent(parsed, true);
    expect(combined).toBe('Think 1\n\nThink 2\n\nAnswer 1');
  });

  it('should handle empty sections', () => {
    const parsed = {
      thinking: [],
      answer: ['Answer only'],
      unparsed: '',
    };

    const combined = combineContent(parsed, true);
    expect(combined).toBe('Answer only');
  });
});
