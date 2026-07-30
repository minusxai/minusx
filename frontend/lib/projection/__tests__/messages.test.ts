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

  it('renders a frozen <CurrentTime> immediately after the AppState block', () => {
    const um = userMsg('q', fileAppState('<question id="1"/>')) as Message & WithAppState;
    um._currentTime = '2026-06-26 14:00 UTC';
    const [out] = projectMessages([um]);
    const texts = (out.content as TextContent[]).filter((c) => c.type === 'text').map((c) => c.text);
    const appIdx = texts.findIndex((t) => t.includes('<AppState>'));
    expect(texts[appIdx + 1]).toBe('<CurrentTime>2026-06-26 14:00 UTC</CurrentTime>');
    // marker stripped from the wire message
    expect((out as WithAppState)._currentTime).toBeUndefined();
  });

  it('renders a <Viewport> pointer in the tail, after CurrentTime and before the user text', () => {
    const um = userMsg('q', fileAppState('<question id="1"/>')) as Message & WithAppState;
    um._currentTime = '2026-06-26 14:00 UTC';
    um._viewport = 'The user is viewing section 2 of 5.';
    const [out] = projectMessages([um]);
    const texts = (out.content as TextContent[]).filter((c) => c.type === 'text').map((c) => c.text);
    const timeIdx = texts.findIndex((t) => t.startsWith('<CurrentTime>'));
    // Viewport rides AFTER CurrentTime — it changes every scroll, so it sits latest in the stable
    // prefix (image + AppState + CurrentTime all precede it and stay cached while the user scrolls).
    expect(texts[timeIdx + 1]).toBe('<Viewport>The user is viewing section 2 of 5.</Viewport>');
    expect(texts[texts.length - 1]).toBe('q'); // user text last
    expect((out as WithAppState)._viewport).toBeUndefined(); // marker stripped
  });

  it('renders <Viewport> even when the turn carries no _appState or _currentTime', () => {
    const um: Message & WithAppState = {
      role: 'user', content: 'q', timestamp: 0, _viewport: 'The user is viewing section 1 of 3.',
    };
    const [out] = projectMessages([um]);
    const texts = (out.content as TextContent[]).filter((c) => c.type === 'text').map((c) => c.text);
    expect(texts).toContain('<Viewport>The user is viewing section 1 of 3.</Viewport>');
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

  it('preserves a non-text (chart image) block the handler attached, after the projected file blocks', () => {
    // ReadFiles/ExecuteQuery present a renderable chart as a rendered IMAGE block in `content`.
    // projectMessages rebuilds the textual content from __augmented but must PRESERVE that image
    // (origNonText) so the rendered chart actually reaches the LLM.
    const files: AugmentedFiles = {
      file: {
        id: 7,
        data: { id: 7, name: 'q7', path: '/org/q7', type: 'question', isDirty: false },
        content: { markup: '<question id="7"/>' },
      },
      references: [],
    };
    const tr: ToolResultMessage = {
      role: 'toolResult', toolCallId: 'tc7', toolName: 'ReadFiles',
      content: [
        { type: 'text', text: 'placeholder' },
        { type: 'image', url: 'https://s3/chart7.jpg' },
      ],
      details: { __augmented: [files], __jsonTag: 'Files' } satisfies AugmentedToolDetails,
      isError: false, timestamp: 0,
    };
    const [out] = projectMessages([tr]);
    const images = (out.content as Array<{ type: string }>).filter((c) => c.type === 'image');
    expect(images).toEqual([{ type: 'image', url: 'https://s3/chart7.jpg' }]);
    // and the image comes AFTER the projected text/file blocks
    const lastBlock = out.content[out.content.length - 1] as { type: string };
    expect(lastBlock.type).toBe('image');
  });

  it('leaves a tool result without __augmented untouched', () => {
    const tr: Message = {
      role: 'toolResult', toolCallId: 'x', toolName: 'ExecuteQuery',
      content: [{ type: 'text', text: 'rows' }], isError: false, timestamp: 0,
    };
    expect(projectMessages([tr])[0]).toBe(tr);
  });
});

// EditFile attaches a full-view screenshot to EVERY edit's tool result, and origNonText used to
// preserve every one of them forever — N edits of one file meant N screenshots in the prompt for
// the rest of the conversation. Only the LATEST screenshot per file is still true of the file;
// older ones are superseded by definition, so the pass drops them and leaves a stub saying why.
describe('projectMessages — superseded EditFile screenshots', () => {
  const augmentedFor = (id: number): AugmentedFiles => ({
    file: {
      id,
      data: { id, name: `f${id}`, path: `/org/f${id}`, type: 'story', isDirty: false },
      content: { markup: `<story id="${id}"/>` },
    },
    references: [],
  });

  const editResult = (fileId: number, tag: string): ToolResultMessage => ({
    role: 'toolResult', toolCallId: tag, toolName: 'EditFile',
    content: [
      { type: 'text', text: '{"success":true}' },
      { type: 'image', url: `https://s3/${tag}.jpg` },
    ],
    details: {
      __augmented: [augmentedFor(fileId)],
      __jsonTag: 'Files',
      __status: { success: true },
      __screenshotOf: fileId,
    } satisfies AugmentedToolDetails,
    isError: false, timestamp: 0,
  });

  const imagesOf = (m: Message) =>
    (Array.isArray(m.content) ? m.content : []).filter((c) => c.type !== 'text');
  const textOf = (m: Message) =>
    (Array.isArray(m.content) ? m.content : []).filter((c): c is TextContent => c.type === 'text').map((c) => c.text).join('\n');

  it('keeps only the LATEST screenshot per file and stubs the earlier ones', () => {
    const msgs = [editResult(1, 'e1'), editResult(1, 'e2'), editResult(2, 'other'), editResult(1, 'e3')];
    const [a, b, other, c] = projectMessages(msgs);
    expect(imagesOf(a)).toEqual([]);
    expect(imagesOf(b)).toEqual([]);
    expect(imagesOf(c)).toEqual([{ type: 'image', url: 'https://s3/e3.jpg' }]);
    // a different file's screenshot is untouched (it is that file's latest)
    expect(imagesOf(other)).toEqual([{ type: 'image', url: 'https://s3/other.jpg' }]);
    // the superseded ones say WHY the image is gone
    expect(textOf(a)).toContain('screenshot omitted');
    expect(textOf(b)).toContain('screenshot omitted');
    expect(textOf(c)).not.toContain('screenshot omitted');
  });

  it('leaves a single EditFile screenshot alone (nothing supersedes it)', () => {
    const [only] = projectMessages([editResult(5, 'solo')]);
    expect(imagesOf(only)).toEqual([{ type: 'image', url: 'https://s3/solo.jpg' }]);
    expect(textOf(only)).not.toContain('screenshot omitted');
  });

  it('does not stub a result that never carried a screenshot (deterministic fallback)', () => {
    const noShot: ToolResultMessage = {
      role: 'toolResult', toolCallId: 'd1', toolName: 'EditFile',
      content: [{ type: 'text', text: '{"success":true}' }],
      details: { __augmented: [augmentedFor(9)], __jsonTag: 'Files', __status: { success: true } } satisfies AugmentedToolDetails,
      isError: false, timestamp: 0,
    };
    const [a, b] = projectMessages([noShot, editResult(9, 'later')]);
    expect(textOf(a)).not.toContain('screenshot omitted');
    expect(imagesOf(b)).toHaveLength(1);
  });

  // The handler emits `{type:'image_url', image_url:{url}}`, NOT the `{type:'image'}` shape the
  // other tests use — pruning must key off "not text", the same predicate the pass filters on.
  it('strips the handler\'s real image_url block shape too', () => {
    const withImageUrl = (fileId: number, tag: string): ToolResultMessage => ({
      ...editResult(fileId, tag),
      content: [
        { type: 'text', text: '{"success":true}' },
        { type: 'image_url', image_url: { url: `https://s3/${tag}.jpg` } } as unknown as TextContent,
      ],
    });
    const [older, newer] = projectMessages([withImageUrl(8, 'u1'), withImageUrl(8, 'u2')]);
    expect(imagesOf(older)).toEqual([]);
    expect(textOf(older)).toContain('screenshot omitted');
    expect(imagesOf(newer)).toHaveLength(1);
  });

  it('is PURE — the input messages, their content arrays and details are unmutated', () => {
    const msgs = [editResult(3, 'p1'), editResult(3, 'p2')];
    const snapshot = JSON.stringify(msgs);
    projectMessages(msgs);
    expect(JSON.stringify(msgs)).toBe(snapshot);
  });
});
