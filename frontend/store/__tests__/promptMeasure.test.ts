/**
 * Prompt Breakdown Measurement
 *
 * Measures the token cost of every component the AnalystAgent sends to the LLM.
 * Uses the tutorial /tutorial/top-level-metrics dashboard (ID 11, 12 real mxfood
 * questions) with a real app_state derived via selectAppState — same path the app
 * takes in production.
 *
 * Run:
 *   npx jest promptMeasure --verbose --no-coverage 2>&1 | grep -v "at print\|console"
 *
 * No assertions — always passes. Output is the token breakdown table.
 */

// Must be first — Jest hoists mock above imports
jest.mock('@/lib/database/db-config', () => ({
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

import { configureStore } from '@reduxjs/toolkit';
import { withPythonBackend } from '@/test/harness/python-backend';
import { setupTestDb, addMxfoodConnection } from '@/test/harness/test-db';
import { getTestDbPath } from './test-utils';
import { setNavigation } from '@/store/navigationSlice';
import { setFiles } from '@/store/filesSlice';
import { selectAppState } from '@/store/appStateSelector';
import filesReducer from '@/store/filesSlice';
import queryResultsReducer from '@/store/queryResultsSlice';
import navigationReducer from '@/store/navigationSlice';
import authReducer from '@/store/authSlice';
import type { RootState } from '@/store/store';
import mxfoodFixture from '@/test/fixtures/mxfood-connection.json';

jest.mock('@/lib/auth/auth-helpers', () => ({
  getEffectiveUser: jest.fn().mockResolvedValue({
    userId: 1,
    email: 'test@example.com',
    name: 'Test User',
    role: 'admin',
    companyName: 'test-workspace',
    home_folder: '',
    mode: 'tutorial',
  }),
  isAdmin: jest.fn().mockReturnValue(true),
}));

// ---------------------------------------------------------------------------
// Schema from fixture — table names only, same as flattenSchemaForPrompt
// ---------------------------------------------------------------------------

const mxfoodSchema = (mxfoodFixture.schema as any).schemas.map((s: any) => ({
  schema: s.schema as string,
  tables: (s.tables as Array<{ table: string }>).map((t) => t.table),
}));

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

const DASHBOARD_ID = 11; // /tutorial/top-level-metrics

// Local-only measurement utility — requires tutorial DB + Python backend.
// Run with: MEASURE_PROMPT=1 npx jest promptMeasure --no-coverage
(process.env.MEASURE_PROMPT ? describe : describe.skip)('Prompt Breakdown', () => {
  const { getPythonPort } = withPythonBackend();

  setupTestDb(getTestDbPath('prompt_measure'), {
    withTutorialFiles: true,
    customInit: async (dbPath) => {
      await addMxfoodConnection(dbPath);
    },
  });

  it('prints AnalystAgent token breakdown — top-level-metrics dashboard, mxfood schema', async () => {
    // Load dashboard + its questions from the test DB (copy of tutorial DB)
    const { DocumentDB } = await import('@/lib/database/documents-db');
    const dashboardFile = await DocumentDB.getById(DASHBOARD_ID);
    if (!dashboardFile) throw new Error(`Dashboard ${DASHBOARD_ID} not found in test DB`);

    const referencedIds: number[] = (dashboardFile.content as any)?.assets
      ?.filter((a: any) => a.type === 'question')
      ?.map((a: any) => a.id) ?? [];

    const referenceFiles = (
      await Promise.all(referencedIds.map((id) => DocumentDB.getById(id)))
    ).filter(Boolean) as NonNullable<Awaited<ReturnType<typeof DocumentDB.getById>>>[];

    // Build app_state via the real selector — same path as production
    const pageStore = configureStore({
      reducer: {
        files: filesReducer,
        queryResults: queryResultsReducer,
        navigation: navigationReducer,
        auth: authReducer,
      } as any,
    });
    pageStore.dispatch(setFiles({ files: [dashboardFile], references: referenceFiles }));
    pageStore.dispatch(setNavigation({ pathname: `/f/${DASHBOARD_ID}`, searchParams: {} }));
    const { appState } = selectAppState(pageStore.getState() as RootState);
    if (!appState) throw new Error('selectAppState returned null');

    const port = getPythonPort();
    const resp = await fetch(`http://localhost:${port}/api/debug/prompt-breakdown`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent: 'AnalystAgent',
        model: 'claude-sonnet-4-6',
        agent_args: {
          goal: 'show me revenue by month',
          connection_id: 'mxfood',
          schema: mxfoodSchema,
          context: '',
          app_state: appState,
          home_folder: '/org',
          agent_name: 'Atlas',
        },
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Endpoint returned ${resp.status}: ${text}`);
    }

    const data = await resp.json();
    printBreakdown(data);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function fmtLine(label: string, tokens: number, chars: number): string {
  return `  ${label.padEnd(38)} ${String(tokens).padStart(6)} tok  ${String(chars).padStart(8)} ch`;
}

function printBreakdown(data: any) {
  const BAR = '─'.repeat(68);

  console.log('\n');
  console.log('╔══ AnalystAgent Prompt Breakdown ' + '═'.repeat(35) + '╗');
  console.log(`║  agent : ${data.agent}`);
  console.log(`║  model : ${data.model}`);
  console.log('╚' + '═'.repeat(67) + '╝');
  console.log('');

  // System prompt
  console.log('──── SYSTEM PROMPT ' + BAR.slice(19));
  const sp = data.system_prompt as { total_tokens: number; total_chars: number; sections: Record<string, any> };
  for (const [name, info] of Object.entries(sp.sections)) {
    const tag = info.kind === 'variable' ? '[VAR] ' : '[TPL] ';
    console.log(fmtLine(tag + name, info.tokens, info.chars));
  }
  console.log('  ' + BAR.slice(2));
  console.log(fmtLine('SYSTEM TOTAL', sp.total_tokens, sp.total_chars));
  console.log('');

  // Preloaded skills
  const skills = data.preloaded_skills_detail as Array<{ name: string; tokens: number; chars: number }> | null;
  if (skills?.length) {
    console.log('──── PRELOADED SKILLS (within [VAR] preloaded_skills) ' + BAR.slice(53));
    for (const s of skills) {
      console.log(fmtLine('  └─ ' + s.name, s.tokens, s.chars));
    }
    console.log('');
  }

  // User message
  console.log('──── USER MESSAGE ' + BAR.slice(18));
  const um = data.user_message as { total_tokens: number; total_chars: number; sections: Record<string, any> };
  for (const [name, info] of Object.entries(um.sections)) {
    const tag = info.kind === 'variable' ? '[VAR] ' : '[TPL] ';
    console.log(fmtLine(tag + name, info.tokens, info.chars));
  }
  console.log('  ' + BAR.slice(2));
  console.log(fmtLine('USER MSG TOTAL', um.total_tokens, um.total_chars));
  console.log('');

  // Tool schemas
  console.log('──── TOOL SCHEMAS ' + BAR.slice(18));
  const tools = data.tools as { total_tokens: number; total_chars: number; breakdown: Array<any> };
  for (const t of tools.breakdown) {
    console.log(fmtLine(t.name, t.tokens, t.chars));
  }
  console.log('  ' + BAR.slice(2));
  console.log(fmtLine('TOOLS TOTAL', tools.total_tokens, tools.total_chars));
  console.log('');

  // Embedded blobs
  console.log('──── EMBEDDED BLOBS (within tool field descriptions) ' + BAR.slice(53));
  const blobs = data.embedded_blobs as Record<string, { tokens: number; chars: number; note: string }>;
  for (const [name, info] of Object.entries(blobs)) {
    console.log(fmtLine(name, info.tokens, info.chars));
    console.log(`       ↳ ${info.note}`);
  }
  console.log('');

  // Grand total
  console.log('════ GRAND TOTAL ' + '═'.repeat(51));
  console.log(fmtLine('system + user + tools', data.grand_total_tokens, 0));
  console.log('');
}
