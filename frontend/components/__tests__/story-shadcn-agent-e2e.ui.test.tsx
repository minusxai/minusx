/**
 * Story Design V2 §11 Phase 1 — closing E2E via faux LLM.
 *
 * The agent AUTHORS a new shadcn story through the real chat stack (Redux → listener
 * middleware → v3 conversation routes → in-process orchestrator → faux LLM → frontend
 * tool handlers → real markup codec), PUBLISHES it (batch-save → server-side Tailwind
 * compile of `compiledCss`), the persisted story RENDERS INTERACTIVELY (real Radix Tabs
 * in the story iframe), and RELOADS IDENTICALLY (server row === Redux, and a second
 * fileToMarkup → markupToContent pass is byte-stable).
 */
import type { MockInstance } from 'vitest';

// ─── Hoisted mocks (same shape as agent-e2e.ui.test.tsx) ─────────────────────
const { mockRouterPush } = vi.hoisted(() => ({ mockRouterPush: vi.fn() }));
vi.mock('@/lib/navigation/use-navigation', () => ({
  useRouter: () => ({
    push: mockRouterPush,
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/explore',
  useSearchParams: () => new URLSearchParams(),
  getRouter: vi.fn(() => null),
}));

vi.mock('@/lib/utils/attachment-extract', () => ({
  extractTextFromDocument: vi.fn().mockResolvedValue(''),
  SUPPORTED_DOC_EXTENSIONS: [],
}));

// ─── Imports ─────────────────────────────────────────────────────────────────
import React, { useEffect, useRef } from 'react';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { NextRequest } from 'next/server';

import * as storeModule from '@/store/store';
import type { RootState } from '@/store/store';
import {
  createConversation, sendMessage, selectConversation, setUserInputResult,
} from '@/store/chatSlice';
import { setUnrestrictedMode } from '@/store/uiSlice';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { publishAll } from '@/lib/file-state/file-state';
import { selectMergedContent } from '@/store/filesSlice';
import { fileToMarkup, markupToContent } from '@/lib/data/story/file-markup';
import type { CompiledCssStoryContent } from '@/lib/data/story/story-css';
import AgentHtml from '@/components/views/shared/AgentHtml';

import { renderWithProviders } from '@/test/helpers/render-with-providers';
import { waitForConversationFinished } from '@/test/helpers/redux-wait';
import { fauxAssistantMessage, fauxToolCall } from '@/orchestrator/llm/testing';
import { fauxRegistration as webFaux } from '@/agents/web-analyst/web-analyst';
import { setupTestDb } from '@/test/harness/test-db';
import { getTestDbPath } from '@/store/__tests__/test-utils';

import { GET as filesGetHandler, POST as filesPostHandler } from '@/app/api/files/route';
import { GET as fileGetByIdHandler } from '@/app/api/files/[id]/route';
import { POST as batchSaveHandler } from '@/app/api/files/batch-save/route';
import { POST as batchFilesHandler } from '@/app/api/files/batch/route';
import { POST as templateHandler } from '@/app/api/files/template/route';
import { GET as connectionsGetHandler } from '@/app/api/connections/route';
import { GET as configsGetHandler } from '@/app/api/configs/route';
import { POST as conversationsPostHandler, GET as conversationsListHandler } from '@/app/api/conversations/route';
import { GET as conversationGetHandler } from '@/app/api/conversations/[id]/route';
import { POST as conversationTurnsHandler } from '@/app/api/conversations/[id]/turns/route';

const realFetch = global.fetch;

// ─── The story the agent authors ─────────────────────────────────────────────
// shadcn JSX: a Card plus interactive Radix Tabs (two triggers + panels, aria-labels
// on everything the test touches). `bg-card` is a shadcn TOKEN utility — its presence
// in compiledCss proves the jsx-format Tailwind compile ran with the token preamble.
const CARD_JSX =
  '<div className="p-6 bg-card" aria-label="q3-story-root">' +
  '<Card aria-label="q3-card"><CardHeader><CardTitle>Q3</CardTitle></CardHeader>' +
  '<CardContent>Revenue grew 12% quarter over quarter.</CardContent></Card>' +
  '</div>';

const TABS_JSX =
  '<Tabs defaultValue="a"><TabsList>' +
  '<TabsTrigger value="a" aria-label="q3-tab-a">Summary</TabsTrigger>' +
  '<TabsTrigger value="b" aria-label="q3-tab-b">Detail</TabsTrigger>' +
  '</TabsList>' +
  '<TabsContent value="a" aria-label="q3-panel-a">summary-panel</TabsContent>' +
  '<TabsContent value="b" aria-label="q3-panel-b">detail-panel</TabsContent>' +
  '</Tabs>';

const CREATE_MARKUP = `<description>Q3 revenue walkthrough</description>\n<story>${CARD_JSX}</story>`;

// ─── Auto-answer the PublishAll user-input (same as agent-e2e) ───────────────
function AutoPublishUserInput() {
  const dispatch = useAppDispatch();
  const allConversations = useAppSelector((state: RootState) => state.chat.conversations);
  const handledIds = useRef(new Set<string>());

  useEffect(() => {
    for (const conv of Object.values(allConversations)) {
      for (const pendingTool of conv.pending_tool_calls ?? []) {
        const pendingInput = pendingTool.userInputs?.find(ui => ui.result === undefined);
        if (!pendingInput || handledIds.current.has(pendingInput.id)) continue;
        if (pendingInput.props?.type === 'publish') {
          handledIds.current.add(pendingInput.id);
          const convId = conv.conversationID;
          const toolCallId = pendingTool.toolCall.id;
          const inputId = pendingInput.id;
          publishAll()
            .then(() => {
              dispatch(setUserInputResult({
                conversationID: convId,
                tool_call_id: toolCallId,
                userInputId: inputId,
                result: { published: true },
              }));
            })
            .catch((err: unknown) => {
              console.error('[AutoPublishUserInput] publishAll failed:', err);
              dispatch(setUserInputResult({
                conversationID: convId,
                tool_call_id: toolCallId,
                userInputId: inputId,
                result: { cancelled: true, remaining: 0 },
              }));
            });
        }
      }
    }
  });
  return null;
}

// ─── Real in-process API fetch (route handlers, no HTTP) ─────────────────────
function makeRealApiFetch() {
  const BASE = 'http://localhost:3000';

  const call = async (
    handler: (req: NextRequest, ctx?: unknown) => Promise<Response>,
    url: string,
    init?: RequestInit,
    context?: unknown,
  ): Promise<Response> => {
    const req = new NextRequest(url, {
      method: init?.method ?? 'GET',
      body: (init?.body as string) ?? null,
      headers: (init?.headers as HeadersInit) ?? undefined,
    });
    const resp = context ? await handler(req, context) : await handler(req);
    const data = await resp.json();
    return { ok: resp.status < 400, status: resp.status, json: async () => data } as Response;
  };

  return vi.fn(async (url: string | Request | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = url.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const fullUrl = urlStr.startsWith('http') ? urlStr : `${BASE}${urlStr}`;

    // Chat v3 routes — the listener's IS_TEST path POSTs the turn then polls GET /:id.
    if (method === 'POST' && /\/api\/conversations\/-?\d+\/turns/.test(urlStr)) {
      const id = urlStr.match(/\/api\/conversations\/(-?\d+)\/turns/)![1];
      return call(conversationTurnsHandler as never, fullUrl, init, { params: Promise.resolve({ id }) });
    }
    if (method === 'GET' && /\/api\/conversations\/-?\d+(\?|$)/.test(urlStr)) {
      const id = urlStr.match(/\/api\/conversations\/(-?\d+)/)![1];
      return call(conversationGetHandler as never, fullUrl, init, { params: Promise.resolve({ id }) });
    }
    if (method === 'POST' && /\/api\/conversations(\?|$)/.test(urlStr)) {
      return call(conversationsPostHandler as never, `${BASE}/api/conversations`, init);
    }
    if (method === 'GET' && /\/api\/conversations(\?|$)/.test(urlStr)) {
      return call(conversationsListHandler as never, `${BASE}/api/conversations`, init);
    }
    if (method === 'POST' && urlStr.includes('/api/files/batch-save')) {
      return call(batchSaveHandler as never, `${BASE}/api/files/batch-save`, init);
    }
    if (method === 'POST' && urlStr.includes('/api/files/batch')) {
      return call(batchFilesHandler as never, `${BASE}/api/files/batch`, init);
    }
    if (method === 'POST' && urlStr.includes('/api/files/template')) {
      return call(templateHandler as never, `${BASE}/api/files/template`, init);
    }
    if (method === 'POST' && urlStr.match(/\/api\/files\/?(\?|$)/)) {
      return call(filesPostHandler as never, fullUrl, init);
    }
    if (method === 'GET') {
      const byId = urlStr.match(/\/api\/files\/(\d+)/);
      if (byId) {
        return call(fileGetByIdHandler as never, fullUrl, init, { params: Promise.resolve({ id: byId[1] }) });
      }
    }
    if (method === 'GET' && urlStr.includes('/api/files')) {
      return call(filesGetHandler as never, fullUrl, init);
    }
    if (method === 'GET' && urlStr.includes('/api/connections') && !urlStr.includes('/schema')) {
      return call(connectionsGetHandler as never, `${BASE}/api/connections`, init);
    }
    if (method === 'GET' && urlStr.includes('/api/configs')) {
      return call(configsGetHandler as never, `${BASE}/api/configs`, init);
    }
    if (urlStr.includes('/health')) {
      return { ok: true, status: 200, json: async () => ({ status: 'healthy' }) } as Response;
    }
    if (method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ data: null }) } as Response;
    }
    throw new Error(`[Story shadcn E2E] Unmocked fetch: ${method} ${urlStr}`);
  });
}

async function createRealConversation(): Promise<number> {
  const res = await fetch('http://localhost:3000/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const data = await res.json();
  if (!data?.id) throw new Error(`createRealConversation failed: ${JSON.stringify(data)}`);
  return data.id as number;
}

// ─── The E2E ─────────────────────────────────────────────────────────────────

describe('Story Design V2 — agent authors a shadcn story E2E (faux LLM)', () => {
  setupTestDb(getTestDbPath('story_shadcn_agent_e2e'));

  let testStore: ReturnType<typeof storeModule.makeStore>;
  let getStoreSpy: MockInstance;

  beforeEach(() => {
    testStore = storeModule.makeStore();
    getStoreSpy = vi.spyOn(storeModule, 'getStore').mockReturnValue(testStore);
    global.fetch = makeRealApiFetch();
  });

  afterEach(() => {
    global.fetch = realFetch;
    getStoreSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('authors via CreateFile+EditFile, publishes with compiledCss, renders interactively, reloads identically', async () => {
    // Turn script: CreateFile(markup) → EditFile(append Tabs) → PublishAll → reply.
    // The EditFile step is a faux FACTORY: the draft's real id only exists after
    // CreateFile ran, so the args are built at LLM-call time from the live store.
    webFaux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall('CreateFile', {
          file_type: 'story',
          name: 'Q3 Revenue Story',
          path: '/org',
          markup: CREATE_MARKUP,
        }, { id: 'tc_create_story' })],
        { stopReason: 'toolUse' },
      ),
      () => {
        const story = Object.values(testStore.getState().files.files).find(f => f.type === 'story');
        if (!story) throw new Error('EditFile faux step: no story draft in the store yet');
        return fauxAssistantMessage(
          [fauxToolCall('EditFile', {
            fileId: story.id,
            review: false,
            changes: [{ oldMatch: '</Card>', newMatch: `</Card>${TABS_JSX}` }],
          }, { id: 'tc_edit_story' })],
          { stopReason: 'toolUse' },
        );
      },
      fauxAssistantMessage(
        [fauxToolCall('PublishAll', {}, { id: 'tc_publish_story' })],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('Done — the Q3 Revenue Story is published.', { stopReason: 'stop' }),
    ]);

    // Stories cannot be created in the background outside unrestricted mode.
    testStore.dispatch(setUnrestrictedMode(true));

    renderWithProviders(<AutoPublishUserInput />, { store: testStore });

    const CONV_ID = await createRealConversation();
    testStore.dispatch(createConversation({
      conversationID: CONV_ID,
      agent: 'AnalystAgent',
      agent_args: { goal: 'Author a Q3 revenue story' },
      version: 3,
    }));
    testStore.dispatch(sendMessage({
      conversationID: CONV_ID,
      message: 'Create a story called Q3 Revenue Story with a summary card and detail tabs, then publish it',
    }));

    const realConvId = await waitForConversationFinished(
      () => testStore.getState() as RootState,
      CONV_ID,
    );
    expect(selectConversation(testStore.getState() as RootState, realConvId)?.error).toBeUndefined();

    // ── The saved content came through the REAL markup codec ────────────────
    const storyFile = Object.values(testStore.getState().files.files).find(f => f.type === 'story');
    expect(storyFile).toBeDefined();
    const storyId = storyFile!.id;
    expect(storyId).toBeGreaterThan(0);

    // Expected story source: the SAME codec applied to the same markup the agent sent
    // (CreateFile markup, then the EditFile replacement) — so "verbatim, normalized".
    const createdParse = markupToContent('story', CREATE_MARKUP);
    expect(createdParse.ok, !createdParse.ok ? createdParse.error : '').toBe(true);
    if (!createdParse.ok) return;
    const editedMarkup = fileToMarkup('story', createdParse.content).replace('</Card>', `</Card>${TABS_JSX}`);
    const editedParse = markupToContent('story', editedMarkup, createdParse.content);
    expect(editedParse.ok, !editedParse.ok ? editedParse.error : '').toBe(true);
    if (!editedParse.ok) return;
    const expectedStory = editedParse.content.story as string;
    expect(expectedStory).toContain('<Card aria-label="q3-card">');
    expect(expectedStory).toContain('<Tabs defaultValue="a">');

    // ── Publish persisted it: reload the DB row through the real files API ──
    const reloadRes = await fetch(`http://localhost:3000/api/files/${storyId}`);
    expect(reloadRes.ok).toBe(true);
    const reloaded = await reloadRes.json();
    const saved = (reloaded.data ?? reloaded).content as CompiledCssStoryContent & { format?: string };

    expect(saved.format).toBe('jsx');
    expect(saved.story).toBe(expectedStory);
    expect(saved.description).toBe('Q3 revenue walkthrough');

    // Server-side Tailwind compile ran with the shadcn token preamble.
    expect(saved.compiledCss).toBeTruthy();
    expect(saved.compiledCss).toContain('.bg-card');

    // Redux (post-publish merged content) matches the server row — reload identity.
    const merged = selectMergedContent(testStore.getState(), storyId) as { story?: string; format?: string };
    expect(merged.format).toBe('jsx');
    expect(merged.story).toBe(saved.story);

    // ── The persisted story renders INTERACTIVELY (real Radix Tabs) ─────────
    render(<AgentHtml html={saved.story!} format="jsx" width={800} colorMode="light" />);
    const doc = (screen.getByLabelText('Story document') as HTMLIFrameElement).contentDocument!;
    await waitFor(() => expect(within(doc.body).getByLabelText('q3-card')).toBeTruthy());
    expect(within(doc.body).getByLabelText('q3-card').textContent).toContain('Q3');

    const tabA = within(doc.body).getByLabelText('q3-tab-a');
    const tabB = within(doc.body).getByLabelText('q3-tab-b');
    expect(tabA.getAttribute('data-state')).toBe('active');
    expect(within(doc.body).getByLabelText('q3-panel-a').textContent).toBe('summary-panel');
    expect(within(doc.body).getByLabelText('q3-panel-b').hasAttribute('hidden')).toBe(true);

    fireEvent.mouseDown(tabB, { button: 0 });
    fireEvent.click(tabB);
    await waitFor(() => expect(within(doc.body).getByLabelText('q3-panel-b').textContent).toBe('detail-panel'));
    expect(within(doc.body).getByLabelText('q3-panel-b').hasAttribute('hidden')).toBe(false);
    expect(within(doc.body).getByLabelText('q3-panel-a').hasAttribute('hidden')).toBe(true);

    // ── Second-pass byte stability: the edit surface reloads identically ────
    const markup2 = fileToMarkup('story', saved);
    const back2 = markupToContent('story', markup2, saved);
    expect(back2.ok, !back2.ok ? back2.error : '').toBe(true);
    if (back2.ok) {
      expect(back2.content.format).toBe('jsx');
      expect(back2.content.story).toBe(saved.story);
      expect(back2.content.description).toBe(saved.description);
    }
  }, 90000);
});
