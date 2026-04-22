// ─── lib-unit.test.ts ───
// Merged: conversations-client, oauth, context-utils-yaml, api-responses-network,
//         permissions, content-validators, xml-parser, file-search

jest.mock('next/cache', () => ({
  revalidateTag: jest.fn(),
  unstable_cache: jest.fn((fn: unknown) => fn),
}));
jest.mock('@/lib/messaging/internal-notifier', () => ({
  notifyInternal: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/config', () => ({
  NEXTAUTH_SECRET: 'test-secret-for-unit-tests',
  MX_API_BASE_URL: 'http://mx-api.test',
  MX_API_KEY: 'test-key',
  MX_NETWORK_LOG_EXCLUDE: '',
  BASE_DUCKDB_DATA_PATH: '/tmp',
}));
jest.mock('next/headers', () => ({ headers: jest.fn() }));

import { extractDebugMessages, parseLogToMessages } from '../conversations-utils';
import type { ConversationLogEntry } from '../types';

import { createHash, randomBytes } from 'crypto';
import { OAuthCodeDB, OAuthTokenDB } from '@/lib/oauth/db';

import { serializeDatabases, parseDatabasesYaml } from '@/lib/context/context-utils';
import type { DatabaseContext } from '@/lib/types';

import { headers as mockHeadersFn } from 'next/headers';
import { successResponse, errorResponse, handleApiError } from '@/lib/api/api-responses';
import { ErrorCodes } from '@/lib/api/api-types';

import { canAccessFile, checkFileAccess } from '@/lib/data/helpers/permissions';
import type { DbFile } from '@/lib/types';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

import { validateFileState } from '@/lib/validation/content-validators';
import workspaceTemplate from '@/lib/database/workspace-template.json';
import type { FileType } from '@/lib/types';

import { parseThinkingAnswer, combineContent } from '@/lib/utils/xml-parser';

import { searchFiles } from '@/lib/search/file-search';
import type { QuestionContent, DocumentContent, ConnectionContent } from '@/lib/types';

// ── api-responses-network setup ──

const mockHeaders = mockHeadersFn as jest.MockedFunction<typeof mockHeadersFn>;
const mockFetch = jest.fn().mockResolvedValue({ ok: true });
global.fetch = mockFetch;

type ReadonlyHeaders = Awaited<ReturnType<typeof import('next/headers')['headers']>>;

function makeApiHeaders(values: {
  requestId?: string | null;
  userId?: string | null;
  mode?: string | null;
  requestPath?: string | null;
}): ReadonlyHeaders {
  return {
    get: (key: string) => {
      switch (key) {
        case 'x-request-id':   return values.requestId ?? null;
        case 'x-user-id':      return values.userId ?? null;
        case 'x-mode':         return values.mode ?? null;
        case 'x-request-path': return values.requestPath ?? null;
        default:               return null;
      }
    },
  } as unknown as ReadonlyHeaders;
}

beforeEach(() => {
  mockFetch.mockClear();
});

// ─── conversations-client.test.ts ───

describe('extractDebugMessages', () => {
  it('returns empty array for empty log', () => {
    expect(extractDebugMessages([])).toEqual([]);
  });

  it('returns empty array when no task_debug entries present', () => {
    const log: ConversationLogEntry[] = [
      {
        _type: 'task',
        unique_id: 'task-1',
        _run_id: 'run-1',
        _parent_unique_id: null,
        agent: 'AnalystAgent',
        args: { goal: 'hello' },
        created_at: '2024-01-01T00:00:00Z',
      }
    ];
    expect(extractDebugMessages(log)).toEqual([]);
  });

  it('extracts a single task_debug entry as a debug message', () => {
    const log: ConversationLogEntry[] = [
      {
        _type: 'task_debug',
        _task_unique_id: 'task-1',
        duration: 1.5,
        llmDebug: [{ model: 'claude-sonnet-4', duration: 1.2, total_tokens: 100, prompt_tokens: 80, completion_tokens: 20, cost: 0.001 }],
        created_at: '2024-01-01T00:00:00Z',
      }
    ];

    const result = extractDebugMessages(log);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      role: 'debug',
      task_unique_id: 'task-1',
      duration: 1.5,
      llmDebug: [expect.objectContaining({ model: 'claude-sonnet-4' })],
      created_at: '2024-01-01T00:00:00Z',
    });
  });

  it('aggregates multiple task_debug entries for the same task (sums duration, concatenates llmDebug)', () => {
    const log: ConversationLogEntry[] = [
      {
        _type: 'task_debug',
        _task_unique_id: 'task-1',
        duration: 1.0,
        llmDebug: [{ model: 'claude-sonnet-4', duration: 0.8, total_tokens: 100, prompt_tokens: 80, completion_tokens: 20, cost: 0.001 }],
        created_at: '2024-01-01T00:00:00Z',
      },
      {
        _type: 'task_debug',
        _task_unique_id: 'task-1',
        duration: 0.5,
        llmDebug: [{ model: 'claude-sonnet-4', duration: 0.4, total_tokens: 50, prompt_tokens: 40, completion_tokens: 10, cost: 0.0005 }],
        created_at: '2024-01-01T00:00:01Z',
      }
    ];

    const result = extractDebugMessages(log);
    expect(result).toHaveLength(1);
    expect(result[0].task_unique_id).toBe('task-1');
    expect(result[0].duration).toBeCloseTo(1.5);
    expect(result[0].llmDebug).toHaveLength(2);
  });

  it('returns one debug message per task in encounter order', () => {
    const log: ConversationLogEntry[] = [
      {
        _type: 'task_debug',
        _task_unique_id: 'task-1',
        duration: 1.0,
        llmDebug: [],
        created_at: '2024-01-01T00:00:00Z',
      },
      {
        _type: 'task_debug',
        _task_unique_id: 'task-2',
        duration: 2.0,
        llmDebug: [],
        created_at: '2024-01-01T00:00:01Z',
      },
    ];

    const result = extractDebugMessages(log);
    expect(result).toHaveLength(2);
    expect(result[0].task_unique_id).toBe('task-1');
    expect(result[1].task_unique_id).toBe('task-2');
  });

  it('preserves extra field from first debug entry for a task', () => {
    const log: ConversationLogEntry[] = [
      {
        _type: 'task_debug',
        _task_unique_id: 'task-1',
        duration: 1.0,
        llmDebug: [],
        extra: { someKey: 'someValue' },
        created_at: '2024-01-01T00:00:00Z',
      }
    ];

    const result = extractDebugMessages(log);
    expect(result[0].extra).toEqual({ someKey: 'someValue' });
  });
});

const makeTask = (id: string, goal: string, at: string): ConversationLogEntry => ({
  _type: 'task',
  unique_id: id,
  _run_id: 'run-1',
  _parent_unique_id: null,
  agent: 'AnalystAgent',
  args: { goal },
  created_at: at,
});

const makeTaskResult = (taskId: string, at: string): ConversationLogEntry => ({
  _type: 'task_result',
  _task_unique_id: taskId,
  result: 'done',
  created_at: at,
});

describe('parseLogToMessages — logIndex on user messages', () => {
  it('sets logIndex to the array index of the task entry in the log', () => {
    const log: ConversationLogEntry[] = [
      makeTask('task-1', 'hello', '2024-01-01T00:00:00Z'),
      makeTaskResult('task-1', '2024-01-01T00:00:01Z'),
    ];

    const messages = parseLogToMessages(log);
    const userMsgs = messages.filter((m: any) => m.role === 'user');
    expect(userMsgs).toHaveLength(1);
    expect(userMsgs[0].logIndex).toBe(0);
    expect(userMsgs[0].content).toBe('hello');
  });

  it('sets correct logIndex for the second user message in a multi-turn conversation', () => {
    const log: ConversationLogEntry[] = [
      makeTask('task-1', 'first message', '2024-01-01T00:00:00Z'),   // index 0
      makeTaskResult('task-1', '2024-01-01T00:00:01Z'),               // index 1
      makeTask('task-2', 'second message', '2024-01-01T00:00:02Z'),  // index 2
      makeTaskResult('task-2', '2024-01-01T00:00:03Z'),               // index 3
    ];

    const messages = parseLogToMessages(log);
    const userMsgs = messages.filter((m: any) => m.role === 'user');
    expect(userMsgs).toHaveLength(2);
    expect(userMsgs[0].logIndex).toBe(0);
    expect(userMsgs[1].logIndex).toBe(2);
  });

  it('does not set logIndex on non-user messages', () => {
    const log: ConversationLogEntry[] = [
      makeTask('task-1', 'hello', '2024-01-01T00:00:00Z'),
      makeTaskResult('task-1', '2024-01-01T00:00:01Z'),
    ];

    const messages = parseLogToMessages(log);
    const toolMsgs = messages.filter((m: any) => m.role === 'tool');
    toolMsgs.forEach((m: any) => {
      expect(m.logIndex).toBeUndefined();
    });
  });
});

// ─── oauth.test.ts ───

const USER_ID = 42;
const REDIRECT_URI = 'http://localhost:3000/oauth/callback';

function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('hex');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

describe('OAuthCodeDB', () => {
  describe('create', () => {
    it('returns a non-empty plaintext code', async () => {
      const { challenge } = pkce();
      const code = await OAuthCodeDB.create(USER_ID, REDIRECT_URI, challenge);
      expect(typeof code).toBe('string');
      expect(code.length).toBeGreaterThan(10);
    });
  });

  describe('consume', () => {
    it('returns user data when code, redirect_uri, and PKCE verifier are correct', async () => {
      const { verifier, challenge } = pkce();
      const code = await OAuthCodeDB.create(USER_ID, REDIRECT_URI, challenge);

      const result = await OAuthCodeDB.consume(code, REDIRECT_URI, verifier);

      expect(result).not.toBeNull();
      expect(result!.userId).toBe(USER_ID);
    });

    it('returns null for an unknown code', async () => {
      const { verifier } = pkce();
      expect(await OAuthCodeDB.consume('not-a-real-code', REDIRECT_URI, verifier)).toBeNull();
    });

    it('returns null when PKCE verifier does not match', async () => {
      const { challenge } = pkce();
      const { verifier: wrongVerifier } = pkce();
      const code = await OAuthCodeDB.create(USER_ID, REDIRECT_URI, challenge);

      expect(await OAuthCodeDB.consume(code, REDIRECT_URI, wrongVerifier)).toBeNull();
    });

    it('returns null when redirect_uri does not match', async () => {
      const { verifier, challenge } = pkce();
      const code = await OAuthCodeDB.create(USER_ID, REDIRECT_URI, challenge);

      expect(await OAuthCodeDB.consume(code, 'http://evil.example.com/callback', verifier)).toBeNull();
    });

    it('returns null on second consume — code is single-use', async () => {
      const { verifier, challenge } = pkce();
      const code = await OAuthCodeDB.create(USER_ID, REDIRECT_URI, challenge);

      const first = await OAuthCodeDB.consume(code, REDIRECT_URI, verifier);
      expect(first).not.toBeNull();

      const second = await OAuthCodeDB.consume(code, REDIRECT_URI, verifier);
      expect(second).toBeNull();
    });

    it('preserves the optional scope value', async () => {
      const { verifier, challenge } = pkce();
      const code = await OAuthCodeDB.create(USER_ID, REDIRECT_URI, challenge, 'S256', 'read:schema');

      const result = await OAuthCodeDB.consume(code, REDIRECT_URI, verifier);
      expect(result!.scope).toBe('read:schema');
    });

    it('returns null scope when none provided', async () => {
      const { verifier, challenge } = pkce();
      const code = await OAuthCodeDB.create(USER_ID, REDIRECT_URI, challenge);

      const result = await OAuthCodeDB.consume(code, REDIRECT_URI, verifier);
      expect(result!.scope).toBeNull();
    });

    it('returns null for an expired code', async () => {
      const { verifier, challenge } = pkce();
      const code = await OAuthCodeDB.create(USER_ID, REDIRECT_URI, challenge);

      const store = (globalThis as Record<string, unknown>).__oauthCodes as Map<string, { expiresAt: number }>;
      const entry = store.get(code)!;
      entry.expiresAt = Date.now() - 1000;

      expect(await OAuthCodeDB.consume(code, REDIRECT_URI, verifier)).toBeNull();
    });
  });

  describe('cleanupExpired', () => {
    it('removes expired entries without error', async () => {
      const { challenge } = pkce();
      const code = await OAuthCodeDB.create(USER_ID, REDIRECT_URI, challenge);

      const store = (globalThis as Record<string, unknown>).__oauthCodes as Map<string, { expiresAt: number }>;
      store.get(code)!.expiresAt = Date.now() - 1000;

      await expect(OAuthCodeDB.cleanupExpired()).resolves.toBeUndefined();

      expect(store.has(code)).toBe(false);
    });
  });
});

describe('OAuthTokenDB', () => {
  describe('create', () => {
    it('returns an access token with correct shape', async () => {
      const pair = await OAuthTokenDB.create(USER_ID);

      expect(typeof pair.accessToken).toBe('string');
      expect(pair.accessToken.length).toBeGreaterThan(10);
      expect(pair.tokenType).toBe('Bearer');
      expect(pair.expiresIn).toBe(3600);
    });

    it('issues unique tokens on each call', async () => {
      const a = await OAuthTokenDB.create(USER_ID);
      const b = await OAuthTokenDB.create(USER_ID);

      expect(a.accessToken).not.toBe(b.accessToken);
    });
  });

  describe('validateAccessToken', () => {
    it('returns user data for a fresh valid token', async () => {
      const { accessToken } = await OAuthTokenDB.create(USER_ID);

      const result = await OAuthTokenDB.validateAccessToken(accessToken);

      expect(result).not.toBeNull();
      expect(result!.userId).toBe(USER_ID);
    });

    it('returns null for a garbage string', async () => {
      expect(await OAuthTokenDB.validateAccessToken('not-a-jwt')).toBeNull();
    });

    it('returns null for a token signed with a different secret', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const jwt = require('jsonwebtoken') as typeof import('jsonwebtoken');
      const forged = jwt.sign({ userId: USER_ID, scope: null }, 'wrong-secret', { expiresIn: 3600 });

      expect(await OAuthTokenDB.validateAccessToken(forged)).toBeNull();
    });

    it('returns null for an expired token', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const jwt = require('jsonwebtoken') as typeof import('jsonwebtoken');
      const expired = jwt.sign(
        { userId: USER_ID, scope: null },
        'test-secret-for-unit-tests',
        { expiresIn: -1 },
      );

      expect(await OAuthTokenDB.validateAccessToken(expired)).toBeNull();
    });

    it('preserves the optional scope in the returned data', async () => {
      const { accessToken } = await OAuthTokenDB.create(USER_ID, 'read:schema');

      const result = await OAuthTokenDB.validateAccessToken(accessToken);
      expect(result!.scope).toBe('read:schema');
    });

    it('returns null scope when none was set', async () => {
      const { accessToken } = await OAuthTokenDB.create(USER_ID);

      const result = await OAuthTokenDB.validateAccessToken(accessToken);
      expect(result!.scope).toBeNull();
    });
  });
});

// ─── context-utils-yaml.test.ts ───

describe('serializeDatabases', () => {
  it("serializes '*' as `databases: '*'`", () => {
    const yaml = serializeDatabases('*');
    expect(yaml).toContain("databases: '*'");
  });

  it('serializes empty array as `databases: []`', () => {
    const yaml = serializeDatabases([]);
    expect(yaml).toContain('databases: []');
  });

  it('serializes undefined as `databases: []`', () => {
    const yaml = serializeDatabases(undefined);
    expect(yaml).toContain('databases: []');
  });

  it('serializes a populated array with connection + whitelist entries', () => {
    const databases: DatabaseContext[] = [
      {
        databaseName: 'my_conn',
        whitelist: [
          { name: 'public', type: 'schema' },
          { name: 'users', type: 'table', schema: 'public' },
        ],
      },
    ];
    const yaml = serializeDatabases(databases);
    expect(yaml).toContain('databaseName: my_conn');
    expect(yaml).toContain('name: public');
    expect(yaml).toContain('type: schema');
    expect(yaml).toContain('name: users');
    expect(yaml).toContain('type: table');
  });
});

describe('parseDatabasesYaml', () => {
  it("parses `databases: '*'` as the string '*'", () => {
    const result = parseDatabasesYaml("databases: '*'");
    expect(result).toBe('*');
  });

  it('parses an empty array correctly', () => {
    const result = parseDatabasesYaml('databases: []');
    expect(result).toEqual([]);
  });

  it('parses a populated databases array', () => {
    const yaml = `
databases:
  - databaseName: my_conn
    whitelist:
      - name: public
        type: schema
`;
    const result = parseDatabasesYaml(yaml);
    expect(result).not.toBe('*');
    expect(Array.isArray(result)).toBe(true);
    const arr = result as DatabaseContext[];
    expect(arr).toHaveLength(1);
    expect(arr[0].databaseName).toBe('my_conn');
    expect(arr[0].whitelist[0]).toMatchObject({ name: 'public', type: 'schema' });
  });

  it('returns [] for missing or null databases key', () => {
    expect(parseDatabasesYaml('')).toEqual([]);
    expect(parseDatabasesYaml('other_key: foo')).toEqual([]);
  });

  it('throws on invalid YAML syntax', () => {
    expect(() => parseDatabasesYaml('databases: [unclosed')).toThrow(/YAML parse error/);
  });
});

describe('round-trip: whitelist serialization', () => {
  it("'*' survives serialize → parse without being corrupted to []", () => {
    const yaml = serializeDatabases('*');
    const parsed = parseDatabasesYaml(yaml);
    expect(parsed).toBe('*');
    expect(parsed).not.toEqual([]);
  });

  it('a specific whitelist survives serialize → parse', () => {
    const original: DatabaseContext[] = [
      {
        databaseName: 'analytics',
        whitelist: [
          { name: 'reporting', type: 'schema' },
        ],
      },
    ];
    const yaml = serializeDatabases(original);
    const parsed = parseDatabasesYaml(yaml) as DatabaseContext[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].databaseName).toBe('analytics');
    expect(parsed[0].whitelist[0]).toMatchObject({ name: 'reporting', type: 'schema' });
  });

  it('an empty array survives serialize → parse as []', () => {
    const yaml = serializeDatabases([]);
    const parsed = parseDatabasesYaml(yaml);
    expect(parsed).toEqual([]);
    expect(parsed).not.toBe('*');
  });
});

describe('tab-switch corruption scenario', () => {
  it('switching from YAML to picker with whitelist:* does NOT corrupt to empty []', () => {
    const yamlShownToUser = serializeDatabases('*');
    expect(yamlShownToUser.trim()).toBe("databases: '*'");

    const parsedOnTabSwitch = parseDatabasesYaml(yamlShownToUser);
    expect(parsedOnTabSwitch).toBe('*');
  });

  it('switching from picker to YAML with a specific whitelist shows correct YAML', () => {
    const databases: DatabaseContext[] = [
      { databaseName: 'static', whitelist: [{ name: 'mxfood', type: 'schema' }] },
    ];
    const yaml = serializeDatabases(databases);
    expect(yaml).toContain('databaseName: static');
    expect(yaml).toContain('name: mxfood');
    expect(yaml).not.toContain("'*'");
  });
});

// ─── api-responses-network.test.ts ───

describe('successResponse', () => {
  it('includes request_id in response JSON', async () => {
    mockHeaders.mockResolvedValue(makeApiHeaders({ requestId: 'req-1' }));

    const res = await successResponse({ id: 42 });
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data).toEqual({ id: 42 });
    expect(body.request_id).toBe('req-1');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('omits request_id when header absent', async () => {
    mockHeaders.mockResolvedValue(makeApiHeaders({ requestId: null }));

    const res = await successResponse({ ok: true });
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.request_id).toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('still returns data when headers() throws', async () => {
    mockHeaders.mockRejectedValue(new Error('no request context'));

    const res = await successResponse({ value: 'hello' });
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data).toEqual({ value: 'hello' });
  });
});

describe('errorResponse', () => {
  it('includes request_id in response JSON and POSTs is_error=true to /network/response', async () => {
    mockHeaders.mockResolvedValue(makeApiHeaders({
      requestId: 'req-e2e-2',
      userId: '99',
      mode: 'tutorial',
      requestPath: '/api/query',
    }));

    const res = await errorResponse(ErrorCodes.NOT_FOUND, 'File not found', 404);
    const clientBody = await res.json();

    expect(clientBody.success).toBe(false);
    expect(clientBody.error.code).toBe('NOT_FOUND');
    expect(clientBody.request_id).toBe('req-e2e-2');

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const networkBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(networkBody.request_id).toBe('req-e2e-2');
    expect(networkBody.status_code).toBe(404);
    expect(networkBody.is_error).toBe(true);
    expect(networkBody.response_body.error.code).toBe('NOT_FOUND');
    expect(networkBody.user_id).toBe('99');
    expect(networkBody.mode).toBe('tutorial');
  });

  it('omits request_id when header absent and does not call fetch', async () => {
    mockHeaders.mockResolvedValue(makeApiHeaders({ requestId: null }));

    const res = await errorResponse(ErrorCodes.FORBIDDEN, 'Forbidden', 403);
    const body = await res.json();

    expect(body.success).toBe(false);
    expect(body.request_id).toBeUndefined();

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('handleApiError', () => {
  it('includes request_id in response JSON and POSTs to /network/response', async () => {
    mockHeaders.mockResolvedValue(makeApiHeaders({
      requestId: 'req-e2e-3',
      userId: '42',
      mode: 'org',
    }));

    const res = await handleApiError(new Error('something broke'));
    const clientBody = await res.json();

    expect(clientBody.success).toBe(false);
    expect(clientBody.request_id).toBe('req-e2e-3');

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const networkBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(networkBody.request_id).toBe('req-e2e-3');
    expect(networkBody.is_error).toBe(true);
    expect(networkBody.status_code).toBe(500);
    expect(networkBody.user_id).toBe('42');
  });

  it('still returns valid error response when headers() throws', async () => {
    mockHeaders.mockRejectedValue(new Error('no context'));

    const res = await handleApiError(new Error('oops'));
    const body = await res.json();

    expect(body.success).toBe(false);
    expect(body.error).toBeDefined();
  });
});

// ─── permissions.test.ts ───

function makeFile(path: string, type: DbFile['type'] = 'conversation'): DbFile {
  return {
    id: 1,
    name: 'test',
    path,
    type,
    references: [],
    version: 1,
    last_edit_id: null,
    content: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  };
}

function makeUser(overrides: Partial<EffectiveUser> = {}): EffectiveUser {
  return {
    userId: 42,
    email: 'editor@company.com',
    name: 'Editor',
    role: 'editor',
    home_folder: '',
    mode: 'org',
    ...overrides,
  };
}

const OWN_USER_ID = '42';
const OTHER_USER_ID = '99';

describe('canAccessFile — system folder access', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  describe('non-admin with root home_folder (home_folder="")', () => {
    const editor = makeUser({ role: 'editor' });
    const viewer = makeUser({ role: 'viewer' });

    it('denies access to /org/logs folder', () => {
      const file = makeFile('/org/logs', 'folder');
      expect(canAccessFile(file, editor)).toBe(false);
      expect(canAccessFile(file, viewer)).toBe(false);
    });

    it('denies access to /org/logs/conversations folder', () => {
      const file = makeFile('/org/logs/conversations', 'folder');
      expect(canAccessFile(file, editor)).toBe(false);
      expect(canAccessFile(file, viewer)).toBe(false);
    });

    it("denies access to another user's conversation", () => {
      const file = makeFile(`/org/logs/conversations/${OTHER_USER_ID}/conv-1`);
      expect(canAccessFile(file, editor)).toBe(false);
      expect(canAccessFile(file, viewer)).toBe(false);
    });

    it('grants access to own conversation', () => {
      const file = makeFile(`/org/logs/conversations/${OWN_USER_ID}/conv-1`);
      expect(canAccessFile(file, editor)).toBe(true);
      expect(canAccessFile(file, viewer)).toBe(true);
    });

    it('grants access to a connection in /org/database (system path whitelist)', () => {
      const file = makeFile('/org/database/conn-1', 'connection');
      expect(canAccessFile(file, editor)).toBe(true);
    });
  });

  describe('non-admin with a specific home_folder', () => {
    const editor = makeUser({ role: 'editor', home_folder: 'sales' });

    it('denies access to /org/logs folder (blocked by both home folder and system folder checks)', () => {
      const file = makeFile('/org/logs', 'folder');
      expect(canAccessFile(file, editor)).toBe(false);
    });

    it('still grants access to own conversation', () => {
      const file = makeFile(`/org/logs/conversations/${OWN_USER_ID}/conv-1`);
      expect(canAccessFile(file, editor)).toBe(true);
    });

    it("still denies access to another user's conversation", () => {
      const file = makeFile(`/org/logs/conversations/${OTHER_USER_ID}/conv-1`);
      expect(canAccessFile(file, editor)).toBe(false);
    });
  });

  describe('admin access is unaffected', () => {
    const admin = makeUser({ role: 'admin' });

    it('grants access to /org/logs folder', () => {
      const file = makeFile('/org/logs', 'folder');
      expect(canAccessFile(file, admin)).toBe(true);
    });

    it('grants access to /org/logs/conversations folder', () => {
      const file = makeFile('/org/logs/conversations', 'folder');
      expect(canAccessFile(file, admin)).toBe(true);
    });

    it("grants access to any user's conversation", () => {
      const file = makeFile(`/org/logs/conversations/${OTHER_USER_ID}/conv-1`);
      expect(canAccessFile(file, admin)).toBe(true);
    });
  });
});

describe('checkFileAccess — system folder access', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  describe('non-admin with root home_folder (home_folder="")', () => {
    const editor = makeUser({ role: 'editor' });

    it('denies access to /org/logs folder', () => {
      const file = makeFile('/org/logs', 'folder');
      expect(checkFileAccess(file, editor)).toBe(false);
    });

    it("denies access to another user's conversation", () => {
      const file = makeFile(`/org/logs/conversations/${OTHER_USER_ID}/conv-1`);
      expect(checkFileAccess(file, editor)).toBe(false);
    });

    it('grants access to own conversation', () => {
      const file = makeFile(`/org/logs/conversations/${OWN_USER_ID}/conv-1`);
      expect(checkFileAccess(file, editor)).toBe(true);
    });
  });

  describe('admin access is unaffected', () => {
    const admin = makeUser({ role: 'admin' });

    it('grants access to /org/logs folder', () => {
      const file = makeFile('/org/logs', 'folder');
      expect(checkFileAccess(file, admin)).toBe(true);
    });

    it("grants access to another user's conversation", () => {
      const file = makeFile(`/org/logs/conversations/${OTHER_USER_ID}/conv-1`);
      expect(checkFileAccess(file, admin)).toBe(true);
    });
  });
});

// ─── content-validators.test.ts ───

const VALIDATED_TYPES = new Set<FileType>(['question', 'dashboard']);

describe('workspace-template.json - validateFileState', () => {
  const validatableDocs = workspaceTemplate.documents.filter(doc =>
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

// ─── xml-parser.test.ts ───

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

      expect(parsed).not.toBeNull();
      expect(parsed!.thinking).toEqual(['Unclosed tag without ending']);
    });

    it('should gracefully handle mismatched tags as incomplete', () => {
      const content = '<thinking>Some text</answer>';
      const parsed = parseThinkingAnswer(content, false);

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

// ─── file-search.test.ts ───

function createMockQuestion(
  id: number,
  name: string,
  path: string,
  content: QuestionContent
): DbFile {
  return {
    id,
    name,
    path,
    type: 'question',
    references: [],
    content,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    version: 1,
    last_edit_id: null,
  };
}

function createMockDashboard(
  id: number,
  name: string,
  path: string,
  content: DocumentContent
): DbFile {
  return {
    id,
    name,
    path,
    type: 'dashboard',
    references: [],
    content,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    version: 1,
    last_edit_id: null,
  };
}

function createMockConnection(
  id: number,
  name: string,
  path: string,
  content: ConnectionContent
): DbFile {
  return {
    id,
    name,
    path,
    type: 'connection',
    references: [],
    content,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    version: 1,
    last_edit_id: null,
  };
}

describe('searchFiles - Integration Tests', () => {
  it('should rank files by relevance with field weighting and return snippets', () => {
    const files = [
      createMockQuestion(1, 'User Address Report', '/reports/user-address', {
        query: 'SELECT * FROM users',
        description: 'Shows user data',
        vizSettings: { type: 'table' },
        parameters: [],
        connection_name: 'default'
      }),
      createMockQuestion(2, 'Sales Report', '/reports/sales', {
        query: 'SELECT user_id, address, email FROM UserAddress ua JOIN users u ON ua.user_id = u.id',
        description: 'Revenue by user address',
        vizSettings: { type: 'table' },
        parameters: [],
        connection_name: 'default'
      }),
      createMockQuestion(3, 'Address Book', '/reports/address', {
        query: 'SELECT * FROM locations',
        description: 'Location addresses',
        vizSettings: { type: 'table' },
        parameters: [],
        connection_name: 'default'
      }),
      createMockDashboard(4, 'Revenue Dashboard', '/dashboards/revenue', {
        description: 'User address analysis and metrics',
        assets: [
          { type: 'text', content: 'Analysis of user address distribution', id: 'text-1' },
          { type: 'question', id: 1 }
        ],
        layout: []
      })
    ];

    const results = searchFiles(files, 'user address');

    expect(results.length).toBeGreaterThan(0);

    expect(results[0].id).toBe(1);
    expect(results[0].name).toBe('User Address Report');
    expect(results[0].score).toBeGreaterThan(0);
    expect(results[0].score).toBeLessThanOrEqual(1);

    expect(results[0].matchCount).toBeGreaterThan(0);

    expect(results[0].relevantResults.length).toBeGreaterThan(0);
    const nameSnippet = results[0].relevantResults.find(r => r.field === 'name');
    expect(nameSnippet).toBeDefined();
    expect(nameSnippet!.snippet).toContain('User Address');

    const file2 = results.find(r => r.id === 2);
    expect(file2).toBeDefined();
    const querySnippet = file2!.relevantResults.find(r => r.field === 'query');
    expect(querySnippet).toBeDefined();
    expect(querySnippet!.snippet).toContain('address');
    expect(querySnippet!.matchType).toBe('partial');

    const dashboard = results.find(r => r.type === 'dashboard');
    expect(dashboard).toBeDefined();
    expect(dashboard!.matchCount).toBeGreaterThan(0);
  });

  it('should handle edge cases: empty query, special characters, and no matches', () => {
    const files = [
      createMockQuestion(1, 'Sales Query', '/queries/sales', {
        query: 'SELECT SUM(amount) FROM orders WHERE status = "completed" AND email LIKE "%@example.com"',
        description: 'Total sales with filters',
        vizSettings: { type: 'bar', xCols: ['date'], yCols: ['amount'] },
        parameters: [],
        connection_name: 'default'
      }),
      createMockQuestion(2, 'User Report', '/reports/user', {
        query: 'SELECT * FROM users WHERE name != "test"',
        description: 'User data',
        vizSettings: { type: 'table' },
        parameters: [],
        connection_name: 'default'
      })
    ];

    const emptyResults = searchFiles(files, '');
    expect(emptyResults).toHaveLength(2);
    expect(emptyResults[0].score).toBe(0);
    expect(emptyResults[0].matchCount).toBe(0);
    expect(emptyResults[0].relevantResults).toEqual([]);

    const specialCharResults = searchFiles(files, '%@example.com');
    expect(specialCharResults).toHaveLength(1);
    expect(specialCharResults[0].id).toBe(1);
    expect(specialCharResults[0].matchCount).toBeGreaterThan(0);

    const parenResults = searchFiles(files, 'SUM(amount)');
    expect(parenResults).toHaveLength(1);
    expect(parenResults[0].relevantResults[0].snippet).toContain('SUM(amount)');

    const noMatchResults = searchFiles(files, 'nonexistent_keyword_xyz123');
    expect(noMatchResults).toHaveLength(0);

    const upperResults = searchFiles(files, 'USER');
    const lowerResults = searchFiles(files, 'user');
    expect(upperResults.length).toBe(lowerResults.length);
    if (upperResults.length > 0) {
      expect(upperResults[0].score).toBe(lowerResults[0].score);
    }
  });

  it('should search across multiple file types with proper filtering and snippet limits', () => {
    const files = [
      createMockQuestion(1, 'Revenue Analysis', '/reports/revenue', {
        query: 'SELECT * FROM sales',
        description: 'Shows sales data',
        vizSettings: { type: 'line', xCols: ['date'], yCols: ['revenue'] },
        parameters: [],
        connection_name: 'default'
      }),
      createMockQuestion(2, 'Sales Report', '/reports/sales', {
        query: 'SELECT revenue, cost FROM orders',
        description: 'Revenue and cost analysis',
        vizSettings: { type: 'bar', xCols: ['category'], yCols: ['revenue', 'cost'] },
        parameters: [],
        connection_name: 'default'
      }),
      createMockDashboard(3, 'Revenue Dashboard', '/dashboards/revenue', {
        description: 'Overview of revenue metrics',
        assets: [
          { type: 'text', content: 'Revenue targets and actuals', id: 'text-1' },
          { type: 'text', content: 'Additional revenue notes', id: 'text-2' },
          { type: 'question', id: 1 },
          { type: 'text', content: 'More revenue analysis', id: 'text-3' }
        ],
        layout: [
          { i: 'text-1', x: 0, y: 0, w: 6, h: 2 },
          { i: 'question-1', x: 6, y: 0, w: 6, h: 4 },
          { i: 'text-2', x: 0, y: 2, w: 6, h: 2 }
        ]
      }),
      createMockConnection(4, 'Revenue Connection', '/connections/revenue', {
        type: 'duckdb',
        config: {
          file_path: 'revenue_db.duckdb'
        }
      }),
      createMockQuestion(5, 'Revenue Revenue Revenue', '/test', {
        query: 'revenue revenue revenue revenue revenue revenue',
        description: 'revenue revenue revenue revenue',
        vizSettings: { type: 'table' },
        parameters: [],
        connection_name: 'default'
      })
    ];

    const results = searchFiles(files, 'revenue');

    const supportedTypes = ['question', 'dashboard', 'folder', 'connection', 'context'];
    expect(results.every(r => supportedTypes.includes(r.type))).toBe(true);

    const questionResults = results.filter(r => r.type === 'question');
    const dashboardResults = results.filter(r => r.type === 'dashboard');
    expect(questionResults.length).toBeGreaterThan(0);
    expect(dashboardResults.length).toBeGreaterThan(0);

    expect(results[0].name).toBe('Revenue Revenue Revenue');
    expect(results[0].id).toBe(5);
    expect(results[0].matchCount).toBeGreaterThan(10);

    expect(results[0].relevantResults.length).toBeLessThanOrEqual(6);

    expect(results[1].name).toBe('Revenue Dashboard');
    expect(results[1].id).toBe(3);

    const dashboard = results.find(r => r.type === 'dashboard');
    expect(dashboard).toBeDefined();
    const assetSnippet = dashboard!.relevantResults.find(r => r.field === 'asset_names');
    if (assetSnippet) {
      expect(assetSnippet.snippet).toContain('revenue');
    }

    results.forEach(result => {
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('path');
      expect(result).toHaveProperty('type');
      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('matchCount');
      expect(result).toHaveProperty('relevantResults');
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
    });
  });
});
