import { uploadSlackFile } from '@/lib/integrations/slack/api';
import { extractSlackReply, markdownToSlackMrkdwn, buildSlackReplyBlocks, extractQueryChart, extractQueryCharts } from '@/lib/integrations/slack/messages';
import type { ConversationLogEntry } from '@/lib/types';

// ─── api.test.ts ───

describe('uploadSlackFile', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);

      if (url.startsWith('https://slack.com/api/files.getUploadURLExternal')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, upload_url: 'https://uploads.slack.test/file', file_id: 'F_TEST_FILE' }),
        } as Response;
      }

      if (url === 'https://uploads.slack.test/file') {
        return {
          ok: true,
          status: 200,
          text: async () => '',
        } as Response;
      }

      if (url === 'https://slack.com/api/files.completeUploadExternal') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, files: [{ id: 'F_TEST_FILE' }] }),
        } as Response;
      }

      throw new Error(`Unexpected fetch URL: ${url} (${JSON.stringify(init ?? {})})`);
    }) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('uploads file and associates with channel via completeUploadExternal', async () => {
    const result = await uploadSlackFile('xoxb-test', {
      channel: 'C123',
      filename: 'chart.png',
      fileData: Buffer.from('png-bytes'),
    });

    expect(result).toEqual({ fileId: 'F_TEST_FILE' });

    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const completeCall = fetchMock.mock.calls[2];
    expect(String(completeCall[0])).toBe('https://slack.com/api/files.completeUploadExternal');
    expect(JSON.parse(String(completeCall[1]?.body))).toEqual({
      files: [{ id: 'F_TEST_FILE', title: 'chart.png' }],
      channel_id: 'C123',
    });
  });
});

// ─── messages.unit.test.ts ───

function taskEntry(message: string): ConversationLogEntry {
  return {
    _type: 'task',
    args: { user_message: message },
  } as unknown as ConversationLogEntry;
}

function taskResultWithContent(content: string): ConversationLogEntry {
  return {
    _type: 'task_result',
    result: { success: true, content },
  } as unknown as ConversationLogEntry;
}

function taskResultWithTalkToUserContent(content: string): ConversationLogEntry {
  return {
    _type: 'task_result',
    result: {
      completed_tool_calls: [{
        function: { name: 'TalkToUser' },
        content: { success: true, content, citations: [] },
      }],
    },
  } as unknown as ConversationLogEntry;
}

function taskResultWithTalkToUserContentBlocks(blocks: Array<Record<string, unknown>>): ConversationLogEntry {
  return {
    _type: 'task_result',
    result: {
      completed_tool_calls: [{
        function: { name: 'TalkToUser' },
        content: {
          success: true,
          content_blocks: blocks,
        },
      }],
    },
  } as unknown as ConversationLogEntry;
}

describe('markdownToSlackMrkdwn', () => {
  describe('bold', () => {
    it('converts **bold** to *bold*', () => {
      expect(markdownToSlackMrkdwn('This is **bold** text')).toBe('This is *bold* text');
    });

    it('converts __bold__ to *bold*', () => {
      expect(markdownToSlackMrkdwn('This is __bold__ text')).toBe('This is *bold* text');
    });

    it('handles multiple bolds in one line', () => {
      expect(markdownToSlackMrkdwn('**one** and **two**')).toBe('*one* and *two*');
    });
  });

  describe('italic', () => {
    it('converts *italic* to _italic_', () => {
      expect(markdownToSlackMrkdwn('This is *italic* text')).toBe('This is _italic_ text');
    });

    it('converts _italic_ to _italic_ (no change)', () => {
      expect(markdownToSlackMrkdwn('This is _italic_ text')).toBe('This is _italic_ text');
    });
  });

  describe('bold + italic together', () => {
    it('converts bold and italic in the same string', () => {
      expect(markdownToSlackMrkdwn('**bold** and *italic*')).toBe('*bold* and _italic_');
    });
  });

  describe('strikethrough', () => {
    it('converts ~~strike~~ to ~strike~', () => {
      expect(markdownToSlackMrkdwn('This is ~~deleted~~ text')).toBe('This is ~deleted~ text');
    });
  });

  describe('links', () => {
    it('converts [text](url) to <url|text>', () => {
      expect(markdownToSlackMrkdwn('Click [here](https://example.com) now')).toBe('Click <https://example.com|here> now');
    });

    it('converts multiple links', () => {
      expect(markdownToSlackMrkdwn('[a](https://a.com) and [b](https://b.com)')).toBe('<https://a.com|a> and <https://b.com|b>');
    });

    it('does not convert image links ![alt](url)', () => {
      expect(markdownToSlackMrkdwn('![chart](https://example.com/chart.png)')).not.toContain('[chart]');
    });
  });

  describe('headers', () => {
    it('converts # Header to *Header*', () => {
      expect(markdownToSlackMrkdwn('# Main Title')).toBe('*Main Title*');
    });

    it('converts ## and ### headers to bold', () => {
      expect(markdownToSlackMrkdwn('## Section')).toBe('*Section*');
      expect(markdownToSlackMrkdwn('### Subsection')).toBe('*Subsection*');
    });
  });

  describe('code preservation', () => {
    it('preserves inline code', () => {
      expect(markdownToSlackMrkdwn('Run `SELECT * FROM t`')).toBe('Run `SELECT * FROM t`');
    });

    it('preserves code blocks', () => {
      const input = '```sql\nSELECT *\nFROM users\n```';
      expect(markdownToSlackMrkdwn(input)).toBe('```\nSELECT *\nFROM users\n```');
    });

    it('does not convert markdown inside code blocks', () => {
      const input = '```\n**not bold**\n```';
      expect(markdownToSlackMrkdwn(input)).toBe('```\n**not bold**\n```');
    });

    it('does not convert markdown inside inline code', () => {
      expect(markdownToSlackMrkdwn('Use `**not bold**` here')).toBe('Use `**not bold**` here');
    });
  });

  describe('mixed content', () => {
    it('handles a realistic LLM reply', () => {
      const input = [
        'Here are some things I can do:',
        '- **Answer data questions** — just ask in plain English',
        '- **Run SQL queries** — and visualize the results',
        '',
        'Check [this dashboard](https://app.minusx.ai/f/42) for details.',
      ].join('\n');

      const expected = [
        'Here are some things I can do:',
        '- *Answer data questions* — just ask in plain English',
        '- *Run SQL queries* — and visualize the results',
        '',
        'Check <https://app.minusx.ai/f/42|this dashboard> for details.',
      ].join('\n');

      expect(markdownToSlackMrkdwn(input)).toBe(expected);
    });
  });
});

describe('extractSlackReply', () => {
  it('returns text from a simple reply', () => {
    const log = [
      taskEntry('What is revenue?'),
      taskResultWithContent('Revenue is up 12%.'),
    ];
    const reply = extractSlackReply(log);
    expect(reply).not.toBeNull();
    expect(reply!.text).toBe('Revenue is up 12%.');
    expect(reply!.images).toEqual([]);
  });

  it('strips thinking tags', () => {
    const log = [
      taskEntry('Hello'),
      taskResultWithContent('<thinking>Let me think.</thinking>\nHello!'),
    ];
    expect(extractSlackReply(log)!.text).toBe('Hello!');
  });

  it('returns null for empty log', () => {
    expect(extractSlackReply([])).toBeNull();
  });

  it('returns null when only thinking with no visible text', () => {
    const log = [
      taskEntry('Hello'),
      taskResultWithContent('<thinking>Just thinking.</thinking>'),
    ];
    expect(extractSlackReply(log)).toBeNull();
  });

  it('uses the LAST task_result', () => {
    const log = [
      taskEntry('First'), taskResultWithContent('First answer.'),
      taskEntry('Second'), taskResultWithContent('Second answer.'),
    ];
    expect(extractSlackReply(log)!.text).toBe('Second answer.');
  });

  it('extracts from TalkToUser content field', () => {
    const log = [
      taskEntry('Sales?'),
      taskResultWithTalkToUserContent('Sales grew 15%.'),
    ];
    expect(extractSlackReply(log)!.text).toBe('Sales grew 15%.');
  });

  it('extracts from content_blocks', () => {
    const log = [
      taskEntry('Show data'),
      taskResultWithTalkToUserContentBlocks([{ type: 'text', text: 'Analysis here.' }]),
    ];
    expect(extractSlackReply(log)!.text).toBe('Analysis here.');
  });

  it('extracts images from content_blocks', () => {
    const log = [
      taskEntry('Show chart'),
      taskResultWithTalkToUserContentBlocks([
        { type: 'image', url: 'https://example.com/chart.png' },
        { type: 'text', text: 'Here is the chart.' },
      ]),
    ];
    const reply = extractSlackReply(log)!;
    expect(reply.text).toBe('Here is the chart.');
    expect(reply.images).toEqual(['https://example.com/chart.png']);
  });

  it('extracts multiple images', () => {
    const log = [
      taskEntry('Show charts'),
      taskResultWithTalkToUserContentBlocks([
        { type: 'image', url: 'https://example.com/a.png' },
        { type: 'image', url: 'https://example.com/b.png' },
        { type: 'text', text: 'Two charts.' },
      ]),
    ];
    const reply = extractSlackReply(log)!;
    expect(reply.images).toEqual(['https://example.com/a.png', 'https://example.com/b.png']);
  });

  it('returns null when content_blocks has only images and no text', () => {
    const log = [
      taskEntry('Show'),
      taskResultWithTalkToUserContentBlocks([
        { type: 'image', url: 'https://example.com/img.png' },
      ]),
    ];
    expect(extractSlackReply(log)).toBeNull();
  });

  it('ignores non-TalkToUser tool calls', () => {
    const log = [
      taskEntry('Run a query'),
      {
        _type: 'task_result',
        result: {
          completed_tool_calls: [
            { function: { name: 'ExecuteQuery' }, content: { success: true, content: 'raw result' } },
            { function: { name: 'TalkToUser' }, content: { success: true, content: 'Here are the results.', citations: [] } },
          ],
        },
      } as unknown as ConversationLogEntry,
    ];
    expect(extractSlackReply(log)!.text).toBe('Here are the results.');
  });

  it('extracts AtlasAnalystAgent replies', () => {
    const log = [
      taskEntry('Question'),
      {
        _type: 'task_result',
        result: {
          completed_tool_calls: [{
            function: { name: 'AtlasAnalystAgent' },
            content: { success: true, content: 'Agent response.' },
          }],
        },
      } as unknown as ConversationLogEntry,
    ];
    expect(extractSlackReply(log)!.text).toBe('Agent response.');
  });
});

describe('buildSlackReplyBlocks', () => {
  it('returns a section block with mrkdwn text', () => {
    const blocks = buildSlackReplyBlocks({ text: 'Hello world' });
    expect(blocks).toEqual([
      { type: 'section', text: { type: 'mrkdwn', text: 'Hello world' } },
    ]);
  });

  it('includes image blocks when images are provided', () => {
    const blocks = buildSlackReplyBlocks({
      text: 'Here is the chart.',
      images: ['https://example.com/chart.png'],
    });
    expect(blocks).toEqual([
      { type: 'section', text: { type: 'mrkdwn', text: 'Here is the chart.' } },
      { type: 'image', image_url: 'https://example.com/chart.png', alt_text: 'Chart' },
    ]);
  });

  it('includes multiple image blocks', () => {
    const blocks = buildSlackReplyBlocks({
      text: 'Charts.',
      images: ['https://example.com/a.png', 'https://example.com/b.png'],
    });
    expect(blocks).toHaveLength(3);
    expect(blocks[1]).toEqual({ type: 'image', image_url: 'https://example.com/a.png', alt_text: 'Chart' });
    expect(blocks[2]).toEqual({ type: 'image', image_url: 'https://example.com/b.png', alt_text: 'Chart' });
  });

  it('includes a "View in MinusX" button when viewUrl is provided', () => {
    const blocks = buildSlackReplyBlocks({
      text: 'Results are ready.',
      viewUrl: 'https://app.minusx.ai/f/42',
    });
    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toEqual({
      type: 'actions',
      elements: [{
        type: 'button',
        text: { type: 'plain_text', text: 'View in MinusX', emoji: true },
        url: 'https://app.minusx.ai/f/42',
        action_id: 'view_in_minusx',
      }],
    });
  });

  it('includes image and button together', () => {
    const blocks = buildSlackReplyBlocks({
      text: 'Done.',
      images: ['https://example.com/chart.png'],
      viewUrl: 'https://app.minusx.ai/f/42',
    });
    expect(blocks).toHaveLength(3);
    expect((blocks[0] as Record<string, unknown>).type).toBe('section');
    expect((blocks[1] as Record<string, unknown>).type).toBe('image');
    expect((blocks[2] as Record<string, unknown>).type).toBe('actions');
  });

  it('skips images and button when not provided', () => {
    const blocks = buildSlackReplyBlocks({ text: 'Simple reply.' });
    expect(blocks).toHaveLength(1);
  });
});

describe('extractQueryChart', () => {
  function executeQueryTask(uniqueId: string, vizSettings?: string | object): ConversationLogEntry {
    return {
      _type: 'task',
      agent: 'ExecuteQuery',
      args: {
        query: 'SELECT * FROM t',
        connectionId: 'db1',
        vizSettings: typeof vizSettings === 'object' ? JSON.stringify(vizSettings) : vizSettings,
      },
      unique_id: uniqueId,
      _run_id: 'run1',
      created_at: new Date().toISOString(),
    } as unknown as ConversationLogEntry;
  }

  function executeQueryResult(taskUniqueId: string, queryResult: object): ConversationLogEntry {
    return {
      _type: 'task_result',
      _task_unique_id: taskUniqueId,
      result: { success: true },
      details: { success: true, queryResult },
      created_at: new Date().toISOString(),
    } as unknown as ConversationLogEntry;
  }

  const sampleQueryResult = {
    columns: ['month', 'revenue'],
    types: ['VARCHAR', 'INTEGER'],
    rows: [{ month: 'Jan', revenue: 100 }, { month: 'Feb', revenue: 200 }],
  };

  it('extracts a bar chart from ExecuteQuery with vizSettings', () => {
    const log = [
      executeQueryTask('eq1', { type: 'bar', xCols: ['month'], yCols: ['revenue'] }),
      executeQueryResult('eq1', sampleQueryResult),
    ];
    const chart = extractQueryChart(log);
    expect(chart).not.toBeNull();
    expect(chart!.vizSettings.type).toBe('bar');
    expect(chart!.queryResult.rows).toHaveLength(2);
  });

  it('extracts line chart', () => {
    const log = [
      executeQueryTask('eq1', { type: 'line', xCols: ['month'], yCols: ['revenue'] }),
      executeQueryResult('eq1', sampleQueryResult),
    ];
    expect(extractQueryChart(log)!.vizSettings.type).toBe('line');
  });

  it('returns null for table vizSettings', () => {
    const log = [
      executeQueryTask('eq1', { type: 'table' }),
      executeQueryResult('eq1', sampleQueryResult),
    ];
    expect(extractQueryChart(log)).toBeNull();
  });

  it('returns null for pivot vizSettings', () => {
    const log = [
      executeQueryTask('eq1', { type: 'pivot' }),
      executeQueryResult('eq1', sampleQueryResult),
    ];
    expect(extractQueryChart(log)).toBeNull();
  });

  it('returns null when no vizSettings provided', () => {
    const log = [
      executeQueryTask('eq1'),
      executeQueryResult('eq1', sampleQueryResult),
    ];
    expect(extractQueryChart(log)).toBeNull();
  });

  it('returns null for empty rows', () => {
    const log = [
      executeQueryTask('eq1', { type: 'bar', xCols: ['month'], yCols: ['revenue'] }),
      executeQueryResult('eq1', { columns: ['month'], types: ['VARCHAR'], rows: [] }),
    ];
    expect(extractQueryChart(log)).toBeNull();
  });

  it('returns the LAST renderable chart when multiple queries exist', () => {
    const log = [
      executeQueryTask('eq1', { type: 'bar', xCols: ['month'], yCols: ['revenue'] }),
      executeQueryResult('eq1', sampleQueryResult),
      executeQueryTask('eq2', { type: 'pie', xCols: ['month'], yCols: ['revenue'] }),
      executeQueryResult('eq2', sampleQueryResult),
    ];
    const chart = extractQueryChart(log);
    expect(chart!.vizSettings.type).toBe('pie');
  });

  it('skips non-renderable and returns the last renderable', () => {
    const log = [
      executeQueryTask('eq1', { type: 'bar', xCols: ['month'], yCols: ['revenue'] }),
      executeQueryResult('eq1', sampleQueryResult),
      executeQueryTask('eq2', { type: 'table' }),
      executeQueryResult('eq2', sampleQueryResult),
    ];
    const chart = extractQueryChart(log);
    expect(chart!.vizSettings.type).toBe('bar');
  });

  it('extractQueryCharts returns max 2 charts in chronological order', () => {
    const log = [
      executeQueryTask('eq1', { type: 'bar', xCols: ['month'], yCols: ['revenue'] }),
      executeQueryResult('eq1', sampleQueryResult),
      executeQueryTask('eq2', { type: 'line', xCols: ['month'], yCols: ['revenue'] }),
      executeQueryResult('eq2', sampleQueryResult),
      executeQueryTask('eq3', { type: 'pie', xCols: ['month'], yCols: ['revenue'] }),
      executeQueryResult('eq3', sampleQueryResult),
    ];
    const charts = extractQueryCharts(log);
    expect(charts).toHaveLength(2);
    expect(charts[0].vizSettings.type).toBe('line');
    expect(charts[1].vizSettings.type).toBe('pie');
  });

  it('extractQueryCharts skips non-renderable types', () => {
    const log = [
      executeQueryTask('eq1', { type: 'bar', xCols: ['month'], yCols: ['revenue'] }),
      executeQueryResult('eq1', sampleQueryResult),
      executeQueryTask('eq2', { type: 'table' }),
      executeQueryResult('eq2', sampleQueryResult),
      executeQueryTask('eq3', { type: 'line', xCols: ['month'], yCols: ['revenue'] }),
      executeQueryResult('eq3', sampleQueryResult),
    ];
    const charts = extractQueryCharts(log);
    expect(charts).toHaveLength(2);
    expect(charts[0].vizSettings.type).toBe('bar');
    expect(charts[1].vizSettings.type).toBe('line');
  });

  it('returns null when no ExecuteQuery in log', () => {
    const log = [
      taskEntry('Hello'),
      taskResultWithContent('Hi there!'),
    ];
    expect(extractQueryChart(log)).toBeNull();
  });

  it('handles vizSettings as a JSON string', () => {
    const log = [
      executeQueryTask('eq1', '{"type":"scatter","xCols":["x"],"yCols":["y"]}'),
      executeQueryResult('eq1', sampleQueryResult),
    ];
    expect(extractQueryChart(log)!.vizSettings.type).toBe('scatter');
  });
});
