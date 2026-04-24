/**
 * E2E test for LLM message encoding correctness
 *
 * Verifies that tool result content is NOT double-encoded when injected into
 * multi-turn LLM message history. Double-encoding occurs when a tool result
 * (already a JSON string) is json.dumps()'d again, producing a string wrapped
 * in quotes with backslash-escaped inner quotes or newlines.
 *
 * The LLM mock server intercepts HTTP POST requests from the Python backend
 * before LiteLLM, giving us full observability of the exact messages payload.
 *
 * Architecture:
 * 1. LLM Mock Server (dynamic port) - Captures Python LLM calls, validates messages
 * 2. Python Test Server (dynamic port) - Real orchestrator with mocked LLM
 * 3. Next.js API Handler (mocked) - Routes to Python test server
 * 4. Redux Test - Dispatches actions, waits for FINISHED state
 */

import { configureStore } from '@reduxjs/toolkit';
import {
  createConversation,
  sendMessage,
  selectConversation
} from '../chatSlice';

import type { RootState } from '../store';
import { POST as chatPostHandler } from '@/app/api/chat/route';
import { POST as filesBatchPostHandler } from '@/app/api/files/batch/route';
import { waitFor, getTestDbPath } from './test-utils';
import { withPythonBackend } from '@/test/harness/python-backend';
import { setupMockFetch, commonInterceptors } from '@/test/harness/mock-fetch';
import { setupTestDb } from '@/test/harness/test-db';
import { selectAppState } from '@/store/appStateSelector';
import { setNavigation } from '@/store/navigationSlice';
import { setFiles } from '@/store/filesSlice';
import filesReducer from '@/store/filesSlice';
import queryResultsReducer from '@/store/queryResultsSlice';
import navigationReducer from '@/store/navigationSlice';
import authReducer from '@/store/authSlice';

// Tutorial files live under /tutorial/ — mode must match for permission checks
jest.mock('@/lib/auth/auth-helpers', () => ({
  getEffectiveUser: jest.fn().mockResolvedValue({
    userId: 1,
    email: 'test@example.com',
    name: 'Test User',
    role: 'admin',
    companyName: 'test-workspace',
    home_folder: '',
    mode: 'tutorial'
  }),
  isAdmin: jest.fn().mockReturnValue(true)
}));

// Database-specific mock (test name must match)
jest.mock('@/lib/database/db-config', () => ({
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

// Use IDs well above the template range (template creates IDs up to ~1012) to avoid conflicts.
const FIXTURE_QUESTION_ID = 5001;
const TUTORIAL_DASHBOARD_ID = 5002; // /tutorial/user-engagement-dashboard

const FIXTURE_QUESTION_CONTENT = {
  query: 'SELECT * FROM sales',
  connection_name: 'default_db',
  vizSettings: { type: 'table' }
};

const FIXTURE_DASHBOARD_CONTENT = {
  assets: [{ type: 'question', id: FIXTURE_QUESTION_ID }],
  layout: []
};

describe('LLM Message Encoding', () => {
  const { getPythonPort, getLLMMockPort, getLLMMockServer } = withPythonBackend({ withLLMMock: true });
  const { getStore } = setupTestDb(getTestDbPath('atlas_llm_encoding'), {
    withTestConnection: true,
    customInit: async (_dbPath) => {
      const { getModules } = await import('@/lib/modules/registry');
      const db = getModules().db;
      const now = new Date().toISOString();

      // The template creates a file at '/tutorial/user-engagement-dashboard' (id=12).
      // Delete it so we can insert our own version at TUTORIAL_DASHBOARD_ID=1002.
      await db.exec(`DELETE FROM files WHERE path = '/tutorial/user-engagement-dashboard'`, []);

      // Question file referenced by the dashboard
      await db.exec(
        `INSERT INTO files (id, name, path, type, content, file_references, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [FIXTURE_QUESTION_ID, 'Sales Overview', '/tutorial/sales-overview', 'question',
          JSON.stringify(FIXTURE_QUESTION_CONTENT), '[]', now, now]
      );

      // Dashboard file at the tutorial path the test expects
      await db.exec(
        `INSERT INTO files (id, name, path, type, content, file_references, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [TUTORIAL_DASHBOARD_ID, 'User Engagement Dashboard', '/tutorial/user-engagement-dashboard', 'dashboard',
          JSON.stringify(FIXTURE_DASHBOARD_CONTENT), `[${FIXTURE_QUESTION_ID}]`, now, now]
      );
    }
  });
  const mockFetch = setupMockFetch({
    getPythonPort,
    getLLMMockPort,
    interceptors: [
      {
        includesUrl: ['localhost:3000/api/chat'],
        startsWithUrl: ['/api/chat'],
        handler: chatPostHandler
      },
      {
        includesUrl: ['localhost:3000/api/files/batch'],
        startsWithUrl: ['/api/files/batch'],
        handler: filesBatchPostHandler
      }
    ],
    additionalInterceptors: [
      commonInterceptors.mockQuerySales,
      commonInterceptors.mockSchemaSales
    ]
  });

  beforeEach(async () => {
    const mockServer = getLLMMockServer!();
    await mockServer.reset();
    mockFetch.mockClear();
  });

  it('should not double-encode tool results in LLM messages', async () => {
    const store = getStore();
    const mockServer = getLLMMockServer!();
    const conversationID = -300;

    await mockServer.configure([
      // Turn 1: LLM returns a tool call so the orchestrator executes it and
      //         feeds the result back in the next turn.
      {
        response: {
          content: "I'll search the schema first.",
          role: 'assistant',
          tool_calls: [
            {
              id: 'call_001',
              type: 'function',
              function: {
                name: 'SearchDBSchema',
                arguments: JSON.stringify({
                  query: 'sales',
                  connection_id: 'test_connection'
                })
              }
            }
          ],
          finish_reason: 'tool_calls'
        },
        usage: { total_tokens: 100, prompt_tokens: 60, completion_tokens: 40 }
      },
      // Turn 2: Tool result has been injected — assert no double-encoding, then stop.
      {
        validateRequest: (req) => {
          // Inline helper: validateRequest is eval()'d in the mock server process,
          // so it cannot close over outer-scope functions.
          const isDoubleEncoded = (content: string): boolean =>
            content.startsWith('"') &&
            content.endsWith('"') &&
            (content.includes('\\"') || content.includes('\\n'));

          // Check every message in the history
          for (const msg of req.messages) {
            const content = typeof msg.content === 'string' ? msg.content : '';
            if (content) {
              expect(isDoubleEncoded(content)).toBe(false);
            }
          }

          // The tool-role message must be present (proves we are actually in Turn 2)
          const toolMsg = req.messages.find((m: any) => m.role === 'tool');
          expect(toolMsg).toBeDefined();
          expect(toolMsg!.tool_call_id).toBe('call_001');

          console.log('\n=== Turn 2 messages ===');
          req.messages.forEach((m: any, i: number) => {
            const preview =
              typeof m.content === 'string'
                ? m.content.substring(0, 80)
                : '[non-string]';
            console.log(`${i}: role=${m.role} content=${JSON.stringify(preview)}`);
          });
          console.log('=======================\n');

          return true;
        },
        response: {
          content: 'Done.',
          role: 'assistant',
          tool_calls: [],
          finish_reason: 'stop'
        },
        usage: { total_tokens: 80, prompt_tokens: 60, completion_tokens: 20 }
      }
    ]);

    store.dispatch(createConversation({
      conversationID,
      agent: 'AnalystAgent',
      agent_args: {
        goal: 'Show me sales data',
        connection_id: 'test_connection'
      }
    }));

    store.dispatch(sendMessage({ conversationID, message: 'Show me sales data' }));

    let realConversationID = conversationID;
    await waitFor(() => {
      const tempConv = selectConversation(store.getState() as RootState, conversationID);
      if (tempConv?.forkedConversationID) {
        realConversationID = tempConv.forkedConversationID;
      }
      const c = selectConversation(store.getState() as RootState, realConversationID);
      return c?.executionState === 'FINISHED';
    }, 55000);

    const conv = selectConversation(store.getState() as RootState, realConversationID);
    expect(conv!.executionState).toBe('FINISHED');
    expect(conv!.error).toBeUndefined();

    const calls = await mockServer.getCalls();
    expect(calls.length).toBe(2);
  }, 60000);


  it('should not double-encode dashboard app_state or ReadFiles result', async () => {
    const store = getStore();

    const mockServer = getLLMMockServer!();
    const conversationID = -301;

    // Load the tutorial dashboard from the DB (populated via withTutorialFiles) into a
    // local Redux store that has the slices selectAppState needs.  This mirrors the real
    // app: NavigationListener loads the file → selectAppState computes AppState →
    // ChatInterface passes it as app_state in agent_args.
    const { DocumentDB } = await import('@/lib/database/documents-db');
    const dashboardFile = await DocumentDB.getById(TUTORIAL_DASHBOARD_ID);
    expect(dashboardFile).toBeDefined();

    // Load referenced question files too so compressAugmentedFile includes them
    const referencedIds: number[] = (dashboardFile!.content as any)?.assets
      ?.filter((a: any) => a.type === 'question')
      ?.map((a: any) => a.id) ?? [];
    const referenceFiles = (await Promise.all(
      referencedIds.map(id => DocumentDB.getById(id))
    )).filter(Boolean) as NonNullable<Awaited<ReturnType<typeof DocumentDB.getById>>>[];

    const pageStore = configureStore({
      reducer: {
        files:        filesReducer,
        queryResults: queryResultsReducer,
        navigation:   navigationReducer,
        auth:         authReducer,
      } as any
    });

    pageStore.dispatch(setFiles({ files: [dashboardFile!], references: referenceFiles }));
    pageStore.dispatch(setNavigation({ pathname: `/f/${TUTORIAL_DASHBOARD_ID}`, searchParams: {} }));

    // Derive app_state exactly as the app does via the real selector
    const { appState } = selectAppState(pageStore.getState() as RootState);
    expect(appState).not.toBeNull();
    expect(appState!.type).toBe('file');

    await mockServer.configure([
      // Turn 1: inspect the user message (contains app_state), then call ReadFiles
      {
        validateRequest: (req) => {
          const userMsg = req.messages.find((m: any) => m.role === 'user');
          // User message content is now multi-block (array of {type,text} objects)
          const rawContent = userMsg?.content;
          const content = Array.isArray(rawContent)
            ? rawContent.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
            : typeof rawContent === 'string' ? rawContent : '';

          // app_state embedded in the prompt must be readable JSON — not double-encoded
          const isDoubleEncoded = (s: string): boolean =>
            s.startsWith('"') && s.endsWith('"') && (s.includes('\\"') || s.includes('\\n'));
          expect(isDoubleEncoded(content)).toBe(false);
          expect(content).toContain('"type"');
          expect(content).toContain('"file"');
          expect(content).toContain('user-engagement-dashboard');

          console.log('\n=== Turn 1 user msg (first 400 chars) ===');
          console.log(content.substring(0, 400));
          console.log('==========================================\n');

          return true;
        },
        response: {
          content: "Let me read the dashboard file.",
          role: 'assistant',
          tool_calls: [
            {
              id: 'call_read_001',
              type: 'function',
              function: {
                name: 'ReadFiles',
                arguments: JSON.stringify({ fileIds: [TUTORIAL_DASHBOARD_ID] })
              }
            }
          ],
          finish_reason: 'tool_calls'
        },
        usage: { total_tokens: 100, prompt_tokens: 70, completion_tokens: 30 }
      },
      // Turn 2: ReadFiles result is in the tool message — assert it's not double-encoded,
      //         then call EditFile using a string we know exists in the file JSON.
      {
        validateRequest: (req) => {
          const isDoubleEncoded = (s: string): boolean =>
            s.startsWith('"') && s.endsWith('"') && (s.includes('\\"') || s.includes('\\n'));

          // Assert on every message
          for (const msg of req.messages) {
            const content = typeof msg.content === 'string' ? msg.content : '';
            if (content) {
              expect(isDoubleEncoded(content)).toBe(false);
            }
          }

          // The ReadFiles tool message must be present and well-formed
          const toolMsg = req.messages.find((m: any) => m.role === 'tool');
          expect(toolMsg).toBeDefined();
          expect(toolMsg!.tool_call_id).toBe('call_read_001');

          const toolContent = typeof toolMsg!.content === 'string' ? toolMsg!.content : '';
          // ReadFiles returns JSON with a "files" key — verify it's readable (not escaped)
          expect(toolContent).toContain('"files"');
          expect(toolContent).toContain('user-engagement-dashboard');

          console.log('\n=== Turn 2 ReadFiles tool message (first 400 chars) ===');
          console.log(toolContent.substring(0, 400));
          console.log('========================================================\n');

          return true;
        },
        response: {
          content: "Now I'll edit the dashboard name.",
          role: 'assistant',
          tool_calls: [
            {
              id: 'call_edit_001',
              type: 'function',
              function: {
                name: 'EditFile',
                // oldMatch is a compact fragment as the LLM sees it from ReadFiles/AppState
                // (both serialize as compact JSON). "name" and "path" are adjacent in
                // {id,name,path,type,content} so the fragment is guaranteed to appear in fullFileStr.
                arguments: JSON.stringify({
                  fileId: TUTORIAL_DASHBOARD_ID,
                  changes: [{ oldMatch: '"name":"User Engagement Dashboard","path":"/tutorial/user-engagement-dashboard"', newMatch: '"name":"User Engagement Dashboard Edited","path":"/tutorial/user-engagement-dashboard"' }]
                })
              }
            }
          ],
          finish_reason: 'tool_calls'
        },
        usage: { total_tokens: 130, prompt_tokens: 95, completion_tokens: 35 }
      },
      // Turn 3: EditFile result is in the tool message — assert it's not double-encoded.
      {
        validateRequest: (req) => {
          const isDoubleEncoded = (s: string): boolean =>
            s.startsWith('"') && s.endsWith('"') && (s.includes('\\"') || s.includes('\\n'));

          // Assert on every message
          for (const msg of req.messages) {
            const content = typeof msg.content === 'string' ? msg.content : '';
            if (content) {
              expect(isDoubleEncoded(content)).toBe(false);
            }
          }

          // The EditFile tool message must be present and well-formed
          const toolMsg = req.messages.find((m: any) => m.role === 'tool' && m.tool_call_id === 'call_edit_001');
          expect(toolMsg).toBeDefined();

          const toolContent = typeof toolMsg!.content === 'string' ? toolMsg!.content : '';
          // EditFile returns JSON with success + updated fileState
          expect(toolContent).toContain('"success"');
          expect(toolContent).toContain('"fileState"');

          console.log('\n=== Turn 3 EditFile tool message (first 400 chars) ===');
          console.log(toolContent.substring(0, 400));
          console.log('======================================================\n');

          return true;
        },
        response: {
          content: 'Here is a summary of the user-engagement dashboard.',
          role: 'assistant',
          tool_calls: [],
          finish_reason: 'stop'
        },
        usage: { total_tokens: 120, prompt_tokens: 90, completion_tokens: 30 }
      }
    ]);

    store.dispatch(createConversation({
      conversationID,
      agent: 'AnalystAgent',
      agent_args: {
        goal: 'Summarise this dashboard',
        connection_id: 'test_connection',
        app_state: appState   // Real AppState via selectAppState — same as the real app
      }
    }));

    store.dispatch(sendMessage({ conversationID, message: 'Summarise this dashboard' }));

    let realConversationID = conversationID;
    await waitFor(() => {
      const tempConv = selectConversation(store.getState() as RootState, conversationID);
      if (tempConv?.forkedConversationID) {
        realConversationID = tempConv.forkedConversationID;
      }
      const c = selectConversation(store.getState() as RootState, realConversationID);
      return c?.executionState === 'FINISHED';
    }, 55000);

    const conv = selectConversation(store.getState() as RootState, realConversationID);
    expect(conv!.executionState).toBe('FINISHED');
    expect(conv!.error).toBeUndefined();

    const calls = await mockServer.getCalls();
    expect(calls.length).toBe(3);

    // Verify that what Python embedded as app_state in the prompt matches what
    // ReadFiles returned — both should be the same compact JSON string.
    // This catches any Python serialization mismatch (e.g. wrong separators, re-encoding).
    const turn1UserMsg = calls[0].request.messages.find((m: any) => m.role === 'user');
    // User message content is now multi-block — extract all text blocks
    const turn1RawContent = turn1UserMsg!.content;
    const turn1UserText = Array.isArray(turn1RawContent)
      ? (turn1RawContent as any[]).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
      : typeof turn1RawContent === 'string' ? turn1RawContent : '';
    const appStateInPrompt = turn1UserText.match(/<AppState>([\s\S]*?)<\/AppState>/)?.[1];
    expect(appStateInPrompt).toBeDefined();
    // Python compact json.dumps(app_state, separators=(',',':')) must equal JS JSON.stringify(appState)
    expect(appStateInPrompt).toBe(JSON.stringify(appState));

    const turn2ToolMsg = calls[1].request.messages.find((m: any) => m.role === 'tool' && m.tool_call_id === 'call_read_001');
    const readFilesRaw = turn2ToolMsg!.content;
    const readFilesContent = typeof readFilesRaw === 'string' ? readFilesRaw : JSON.stringify(readFilesRaw);
    // Verify ReadFiles returns the correct file structure (not double-encoded).
    // queryResults may differ from appState since ReadFiles may execute queries.
    const parsedReadFiles = JSON.parse(readFilesContent);
    expect(parsedReadFiles.success).toBe(true);
    expect(parsedReadFiles.files).toHaveLength(1);
    // fileState must exactly match app_state (same DB record, no re-encoding)
    expect(parsedReadFiles.files[0].fileState).toEqual((appState as any).state.fileState);
  }, 60000);

  it('ReadFiles maxChars arg truncates query result in tool message', async () => {
    // Verifies that the maxChars arg flows from the LLM tool call through the frontend
    // tool handler → compressAugmentedFile → the tool message Python receives.
    //
    // The mock sales query returns 2 rows with columns [region, total_sales].
    // The markdown header alone is ~38 chars, so maxChars: 50 fits 0 data rows → truncated: true.
    const store = getStore();

    const mockServer = getLLMMockServer!();
    const conversationID = -303;

    await mockServer.configure([
      // Turn 1: call ReadFiles on the fixture question with a tiny maxChars
      {
        response: {
          content: "Let me read the question file.",
          role: 'assistant',
          tool_calls: [
            {
              id: 'call_maxchars_001',
              type: 'function',
              function: {
                name: 'ReadFiles',
                arguments: JSON.stringify({ fileIds: [FIXTURE_QUESTION_ID], maxChars: 50 })
              }
            }
          ],
          finish_reason: 'tool_calls'
        },
        usage: { total_tokens: 60, prompt_tokens: 40, completion_tokens: 20 }
      },
      // Turn 2: inspect the ReadFiles tool message — queryResults should be truncated
      {
        validateRequest: (req) => {
          const toolMsg = req.messages.find(
            (m: any) => m.role === 'tool' && m.tool_call_id === 'call_maxchars_001'
          );
          expect(toolMsg).toBeDefined();

          // Tool content is a JSON string for text-only ReadFiles results
          const rawContent = toolMsg!.content;
          const contentStr = typeof rawContent === 'string'
            ? rawContent
            : (Array.isArray(rawContent)
              ? (rawContent as any[]).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
              : '');

          const parsed = JSON.parse(contentStr);
          expect(parsed.success).toBe(true);
          expect(parsed.files).toHaveLength(1);

          // The question runs its query (runQueries: true default) — mockQuerySales
          // returns 2 rows with columns [region, total_sales].
          // Header + separator = ~38 chars; first data row = ~28 chars → exceeds maxChars: 50.
          // So queryResults MUST be present and truncated.
          const fileResult = parsed.files[0];
          expect(fileResult.queryResults).toBeDefined();
          expect(fileResult.queryResults).toHaveLength(1);
          const qr = fileResult.queryResults[0];
          expect(qr.data.length).toBeLessThanOrEqual(50);
          expect(qr.truncated).toBe(true);
          expect(qr.shownRows).toBe(0);
          expect(qr.totalRows).toBe(2); // mock returns 2 rows

          return true;
        },
        response: {
          content: 'Got it.',
          role: 'assistant',
          tool_calls: [],
          finish_reason: 'stop'
        },
        usage: { total_tokens: 50, prompt_tokens: 40, completion_tokens: 10 }
      }
    ]);

    store.dispatch(createConversation({
      conversationID,
      agent: 'AnalystAgent',
      agent_args: {
        goal: 'Read the question with a small maxChars',
        connection_id: 'test_connection',
      }
    }));

    store.dispatch(sendMessage({ conversationID, message: 'Read the question with a small maxChars' }));

    let realConversationID = conversationID;
    await waitFor(() => {
      const tempConv = selectConversation(store.getState() as RootState, conversationID);
      if (tempConv?.forkedConversationID) {
        realConversationID = tempConv.forkedConversationID;
      }
      const c = selectConversation(store.getState() as RootState, realConversationID);
      return c?.executionState === 'FINISHED';
    }, 55000);

    const conv = selectConversation(store.getState() as RootState, realConversationID);
    expect(conv!.executionState).toBe('FINISHED');
    expect(conv!.error).toBeUndefined();
  }, 60000);
});
