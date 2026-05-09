// importBenchmarkConversation — small wrapper around POST
// /api/benchmark/import that returns the fileId for navigation. Lives in
// lib/benchmark so the /benchmark page (client component) and any future
// CLI/script importers can share one definition of the shape.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { importBenchmarkConversation } from '@/lib/benchmark/import-conversation';
import type { ConversationLog } from '@/orchestrator/types';

const sampleLog: ConversationLog = [
  {
    type: 'toolCall',
    id: 'r1',
    name: 'BenchmarkAnalystAgent',
    arguments: { userMessage: 'list connections' },
    context: { connections: [] },
    parent_id: null,
  },
] as unknown as ConversationLog;

describe('importBenchmarkConversation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('POSTs the log to /api/benchmark/import and returns the fileId from the response', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ fileId: 42, name: 'list connections' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const fileId = await importBenchmarkConversation(sampleLog);
    expect(fileId).toBe(42);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/benchmark/import');
    expect(init.method).toBe('POST');
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ log: sampleLog });
  });

  it('forwards the optional label so the imported conversation is named meaningfully', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ fileId: 7, name: 'my label' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await importBenchmarkConversation(sampleLog, 'my label');
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ log: sampleLog, label: 'my label' });
  });

  it('throws when the import endpoint returns a non-2xx status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'bad' }), { status: 500 })));
    await expect(importBenchmarkConversation(sampleLog)).rejects.toThrow();
  });
});
