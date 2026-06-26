// The single projection pass over an assembled Message[]: user messages carrying _appState and
// tool results carrying details.__augmented are rewritten to diffed content through one shared memo;
// everything else passes through. Cross-turn repeats (app state re-sent every turn) collapse.
import { describe, it, expect } from 'vitest';
import { projectMessages, type WithAppState, type AugmentedToolDetails } from '../messages';
import type { AppState } from '@/lib/appState';
import type { CompressedAugmentedFile } from '@/lib/types';
import type { Message, UserMessage, ToolResultMessage, TextContent } from '@/orchestrator/llm';
import type { AugmentedFiles } from '../types';

const caf = (markup: string): CompressedAugmentedFile => ({
  fileState: { id: 1, name: 'q1', path: '/org/q1', type: 'question', isDirty: false, queryResultId: 'h1', markup },
  references: [],
  queryResults: [{ columns: ['a'], types: ['number'], data: '| a |\n| --- |\n| 1 |\n', totalRows: 1, shownRows: 1, truncated: false, id: 'h1' }],
});

const fileAppState = (markup: string): AppState => ({ type: 'file', state: caf(markup) });

function userMsg(text: string, appState?: AppState): Message {
  const m: UserMessage & WithAppState = { role: 'user', content: text, timestamp: 0 };
  if (appState) m._appState = appState;
  return m as Message;
}

describe('projectMessages — app state', () => {
  it('expands a user message _appState into projected blocks before the original content', () => {
    const [out] = projectMessages([userMsg('do the thing', fileAppState('<question id="1"/>'))]);
    expect(out.role).toBe('user');
    const blocks = out.content as TextContent[];
    expect(blocks[0].text).toContain('<AppState>{');
    expect(blocks[0].text).toContain('<file_markup file_id="1" type="question">');
    // original user text preserved, after the app-state blocks
    expect((blocks[blocks.length - 1]).text).toBe('do the thing');
    // the non-wire marker is stripped
    expect((out as WithAppState)._appState).toBeUndefined();
  });

  it('leaves a user message without _appState untouched', () => {
    const plain: Message = { role: 'user', content: 'hi', timestamp: 0 };
    expect(projectMessages([plain])[0]).toBe(plain);
  });

  it('collapses app state across turns: turn 2 (identical) emits no markup, signals unchanged', () => {
    const msgs = [
      userMsg('turn 1', fileAppState('<question id="1"/>')),
      userMsg('turn 2', fileAppState('<question id="1"/>')),
    ];
    const [, t2] = projectMessages(msgs);
    const text = (t2.content as TextContent[])[0].text;
    expect(text).not.toContain('<file_markup');
    expect(text).toContain('"unchanged":true');
  });

  it('ships query SUMMARY but NOT the rows in app state (data fetched via ReadFiles)', () => {
    // caf() has a query result WITH data (markdown rows). App state must drop the rows, keep summary.
    const [out] = projectMessages([userMsg('q', fileAppState('<question id="1"/>'))]);
    const text = (out.content as TextContent[])[0].text;
    expect(text).toContain('"summary"');           // query shape is present
    expect(text).not.toContain('<query_data');     // rows are NOT emitted as a block
    expect(text).not.toContain('| a |');           // the markdown table is absent
    // the query-result entry carries only queryResultId + summary (no row data)
    expect(text).toMatch(/"queryResults":\[\{"queryResultId":"h1","summary":\{[^}]*\}\}\]/);
  });

  it('renders folder/explore app state as inline JSON (no facet projection)', () => {
    const explore: AppState = { type: 'explore', state: null };
    const [out] = projectMessages([userMsg('q', explore)]);
    expect((out.content as TextContent[])[0].text).toContain('<AppState>');
  });
});

describe('projectMessages — tool results', () => {
  it('projects a tool result carrying details.__augmented into file blocks', () => {
    const files: AugmentedFiles = {
      file: {
        id: 2,
        data: { id: 2, name: 'q2', path: '/org/q2', type: 'question', isDirty: false },
        content: { markup: '<question id="2"/>' },
      },
      references: [],
    };
    const details: AugmentedToolDetails = { __augmented: [files], __jsonTag: 'Files' };
    const tr: ToolResultMessage = {
      role: 'toolResult', toolCallId: 'tc1', toolName: 'ReadFiles',
      content: [{ type: 'text', text: 'placeholder' }], details, isError: false, timestamp: 0,
    };
    const [out] = projectMessages([tr]);
    const text = (out.content as TextContent[])[0].text;
    expect(text).toContain('<Files>{');
    expect(text).toContain('<file_markup file_id="2" type="question">');
  });

  it('shares the memo with app state: a file seen in app state is unchanged when it recurs in a tool result', () => {
    const files: AugmentedFiles = {
      file: {
        id: 1,
        data: { id: 1, name: 'q1', path: '/org/q1', type: 'question', isDirty: false, queryResultId: 'h1' },
        content: { markup: '<question id="1"/>' },
      },
      references: [],
    };
    const tr: ToolResultMessage = {
      role: 'toolResult', toolCallId: 'tc1', toolName: 'ReadFiles',
      content: [], details: { __augmented: [files], __jsonTag: 'Files' } satisfies AugmentedToolDetails,
      isError: false, timestamp: 0,
    };
    // app state (turn) introduces file 1 with the same markup; the later tool result re-reads it.
    const [, out] = projectMessages([userMsg('q', fileAppState('<question id="1"/>')), tr]);
    const text = (out.content as TextContent[])[0].text;
    expect(text).not.toContain('<file_markup'); // markup already sent in app state → unchanged
    expect(text).toContain('"unchanged":true');
  });

  it('leaves a tool result without __augmented untouched', () => {
    const tr: Message = {
      role: 'toolResult', toolCallId: 'x', toolName: 'ExecuteQuery',
      content: [{ type: 'text', text: 'rows' }], isError: false, timestamp: 0,
    };
    expect(projectMessages([tr])[0]).toBe(tr);
  });
});
