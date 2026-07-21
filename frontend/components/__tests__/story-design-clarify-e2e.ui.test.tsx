/**
 * Story Design V2 §11 Phase 4 — closing E2E via faux LLM.
 *
 * The full design-clarify loop through the real chat stack (Redux → listener middleware →
 * v3 conversation routes → in-process orchestrator → faux LLM → frontend tool handlers →
 * real markup codec):
 *
 *  1. The agent calls ClarifyFrontend with `type:'design'` (options: []) — the frontend
 *     handler IGNORES model options and populates the six theme cards from the registry
 *     (lib/data/story/story-themes.ts via lib/branding/story-theme-options.ts).
 *  2. The user picks the "Nocturne" card and submits; the tool RESULT delivered back to
 *     the (faux) LLM carries value 'nocturne' AND the registry's personality description
 *     (the agent-context enrichment it writes `<theme>` + harmonizing CSS from).
 *  3. The agent authors the story with `<theme>nocturne</theme>` through the real codec
 *     (CreateFile markup → PublishAll → server-side Tailwind compile); the saved row has
 *     content.theme === 'nocturne' and compiledCss carrying the [data-theme="nocturne"]
 *     token block.
 *  4. Rendering the persisted story via AgentHtml format="jsx" with the content's theme
 *     stamps data-theme="nocturne" on the surface root — the themed render any subsequent
 *     screenshot captures.
 *
 * TDD red-proof (implementation pre-existed, so red was proven by sabotage, then reverted):
 *  - `lib/tools/handlers/clarify.ts`: dropping `description` from the design-preset result
 *    content → step-2 assertion (registry description in the delivered tool result) FAILED.
 *  - `components/views/shared/AgentHtml.tsx`: removing the `data-theme` root stamping →
 *    step-4 assertion (surface root carries data-theme="nocturne") FAILED.
 */
import type { MockInstance } from 'vitest';

// ─── Hoisted mocks (same shape as story-shadcn-agent-e2e.ui.test.tsx) ────────
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
import type { CompiledCssStoryContent } from '@/lib/data/story/story-css';
import { STORY_THEMES } from '@/lib/data/story/story-themes';
import { STORY_SVG_ATTR, STORY_ROOT_ATTR } from '@/lib/story-surface';
import AgentHtml from '@/components/views/shared/AgentHtml';
import UserInputComponent from '@/components/explore/UserInputComponent';

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

// ─── The design pick + the story the agent authors from it ───────────────────
const NOCTURNE = STORY_THEMES.find(t => t.name === 'nocturne')!;
const THEME_LABELS = STORY_THEMES.map(t => t.label); // the six registry cards

const CLARIFY_TC_ID = 'tc_clarify_design';

const STORY_JSX =
  '<div className="p-6 bg-card" aria-label="noct-root">' +
  '<Card aria-label="noct-card"><CardHeader><CardTitle>Nightly KPIs</CardTitle></CardHeader>' +
  '<CardContent>Dark-first briefing.</CardContent></Card>' +
  '</div>';

const CREATE_MARKUP =
  '<description>Nocturne-themed nightly briefing</description>\n' +
  '<theme>nocturne</theme>\n' +
  `<story>${STORY_JSX}</story>`;

// ─── Auto-answer the PublishAll user-input (same as story-shadcn E2E) ────────
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

// ─── Mount the REAL clarify UI for the pending ClarifyFrontend tool call ─────
// Watches Redux for the paused ClarifyFrontend (the handler's UserInputException
// populated `userInputs` with the app-supplied theme options) and mounts the real
// UserInputComponent against the live conversation/tool-call ids — the same
// pending-tool-call state the in-app chat mounts it with.
function PendingClarifyMount() {
  const allConversations = useAppSelector((state: RootState) => state.chat.conversations);
  for (const conv of Object.values(allConversations)) {
    for (const pendingTool of conv.pending_tool_calls ?? []) {
      if (pendingTool.toolCall.function.name !== 'ClarifyFrontend') continue;
      const pendingInput = pendingTool.userInputs?.find(ui => ui.result === undefined);
      if (!pendingInput) continue;
      return (
        <UserInputComponent
          key={pendingInput.id}
          conversationID={conv.conversationID}
          tool_call_id={pendingTool.toolCall.id}
          userInput={pendingInput}
          toolName="ClarifyFrontend"
        />
      );
    }
  }
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
    throw new Error(`[Story design clarify E2E] Unmocked fetch: ${method} ${urlStr}`);
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

describe('Story Design V2 — design Clarify → card pick → <theme> → themed render E2E (faux LLM)', () => {
  setupTestDb(getTestDbPath('story_design_clarify_e2e'));

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

  it('design Clarify → user picks Nocturne → result enriched from registry → <theme>nocturne</theme> saved → themed render', async () => {
    // Messages the faux LLM sees on the call AFTER the clarify pick — this is the
    // exact context delivered back to the model, including the clarify tool result.
    let postClarifyMessages: Array<{
      role: string;
      toolCallId?: string;
      toolName?: string;
      content?: unknown;
    }> = [];

    // Turn script: ClarifyFrontend(type:'design', options: []) → [user picks a card]
    // → CreateFile(<theme>nocturne</theme> markup) → PublishAll → reply.
    webFaux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall('ClarifyFrontend', {
          question: 'Which design should this story use?',
          options: [], // ignored for the design preset — the app supplies the registry cards
          type: 'design',
        }, { id: CLARIFY_TC_ID })],
        { stopReason: 'toolUse' },
      ),
      (context) => {
        postClarifyMessages = context.messages as never;
        return fauxAssistantMessage(
          [fauxToolCall('CreateFile', {
            file_type: 'story',
            name: 'Nightly Briefing',
            path: '/org',
            markup: CREATE_MARKUP,
          }, { id: 'tc_create_story' })],
          { stopReason: 'toolUse' },
        );
      },
      fauxAssistantMessage(
        [fauxToolCall('PublishAll', {}, { id: 'tc_publish_story' })],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('Done — the Nightly Briefing story is published in Nocturne.', { stopReason: 'stop' }),
    ]);

    // Stories cannot be created in the background outside unrestricted mode.
    testStore.dispatch(setUnrestrictedMode(true));

    renderWithProviders(
      <>
        <AutoPublishUserInput />
        <PendingClarifyMount />
      </>,
      { store: testStore },
    );

    const CONV_ID = await createRealConversation();
    testStore.dispatch(createConversation({
      conversationID: CONV_ID,
      agent: 'AnalystAgent',
      agent_args: { goal: 'Author a themed nightly briefing story' },
      version: 3,
    }));
    testStore.dispatch(sendMessage({
      conversationID: CONV_ID,
      message: 'Create a nightly briefing story — ask me which design to use first',
    }));

    // ── 1. The frontend handler populated the SIX registry theme cards ──────
    await screen.findByLabelText('Nocturne', {}, { timeout: 20000 });
    for (const label of THEME_LABELS) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    // Image-card branch (not compact rows): the registry previews render.
    expect(screen.getByLabelText('Nocturne preview')).toBeInTheDocument();

    // ── User picks the Nocturne card and submits ────────────────────────────
    fireEvent.click(screen.getByLabelText('Nocturne'));
    fireEvent.click(screen.getByLabelText('Submit clarification'));

    const realConvId = await waitForConversationFinished(
      () => testStore.getState() as RootState,
      CONV_ID,
    );
    expect(selectConversation(testStore.getState() as RootState, realConvId)?.error).toBeUndefined();

    // ── 2. The tool RESULT delivered back to the LLM: value + registry text ─
    const clarifyResult = postClarifyMessages.find(
      m => m.role === 'toolResult' && m.toolCallId === CLARIFY_TC_ID,
    );
    expect(clarifyResult).toBeDefined();
    expect(clarifyResult!.toolName).toBe('ClarifyFrontend');
    const resultText = JSON.stringify(clarifyResult!.content);
    expect(resultText).toContain('nocturne');                 // the theme value the agent writes into <theme>
    expect(resultText).toContain(NOCTURNE.description);       // the registry personality enrichment
    expect(NOCTURNE.description.length).toBeGreaterThan(0);   // the enrichment assertion is non-vacuous

    // ── 3. The published story: content.theme + [data-theme] compiledCss ────
    const storyFile = Object.values(testStore.getState().files.files).find(f => f.type === 'story');
    expect(storyFile).toBeDefined();
    const storyId = storyFile!.id;
    expect(storyId).toBeGreaterThan(0);

    const reloadRes = await fetch(`http://localhost:3000/api/files/${storyId}`);
    expect(reloadRes.ok).toBe(true);
    const reloaded = await reloadRes.json();
    const saved = (reloaded.data ?? reloaded).content as CompiledCssStoryContent & {
      format?: string; theme?: string | null;
    };

    expect(saved.format).toBe('jsx');
    expect(saved.theme).toBe('nocturne');                     // <theme>nocturne</theme> through the real codec
    expect(saved.story).toContain('aria-label="noct-card"');
    expect(saved.compiledCss).toBeTruthy();
    expect(saved.compiledCss).toContain('[data-theme="nocturne"]'); // the token block that themes the render

    // ── 4. Themed render: the surface root carries data-theme="nocturne" ────
    render(
      <AgentHtml
        html={saved.story!}
        format="jsx"
        width={800}
        colorMode="light"
        theme={saved.theme}
        compiledCss={saved.compiledCss}
      />,
    );
    const doc = (screen.getByLabelText('Story document') as HTMLIFrameElement).contentDocument!;
    await waitFor(() => expect(within(doc.body).getByLabelText('noct-card')).toBeTruthy());

    const surfaceRoot = doc.querySelector(`svg[${STORY_SVG_ATTR}] [${STORY_ROOT_ATTR}]`) as HTMLElement;
    expect(surfaceRoot).toBeTruthy();
    expect(surfaceRoot.getAttribute('data-theme')).toBe('nocturne');
  }, 90000);
});
