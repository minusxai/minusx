// Regression for the storyv2 "No story yet after create / Failed to save" bug.
//
// Root cause: POST /api/files/[id]/jsx called successResponse({ data: file }) while
// successResponse ALREADY wraps in { success, data }. That double-wrapped the body to
// { success, data: { data: file } }, so the client received { data: file } where it
// expected the file. setFileJsx then dispatched setFile({ file: { data: file } }) — an
// object with no id/type/jsx — so the jsx update landed on the wrong Redux key, the page
// kept the stale draft ("No story yet"), and the later save hit a version conflict.
//
// These tests pin the route's response SHAPE: body.data must BE the file (carrying type +
// jsx), never a nested { data: file }, and the derived FileState must render the story.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { getTestDbPath, initTestDatabase, cleanupTestDatabase } from './test-utils';
import { createFile } from '@/lib/data/files.server';
import { DocumentDB } from '@/lib/database/documents-db';
import { dbFileToFileState } from '@/lib/api/compress-augmented';
import { POST as setJsxRoute } from '@/app/api/files/[id]/jsx/route';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';

const user: EffectiveUser = {
  userId: 1, email: 't@e.com', name: 'T', role: 'admin', home_folder: '/org', mode: 'org',
};

// A storyv2 body: scoped HTML + a Question embed, SQL/styles safe (no escaping needed).
const storyJsx = [
  '<div class="story">',
  '  <h1>Sales</h1>',
  '  <p>Narrative.</p>',
  '  <Question id={1234} height={440} />',
  '</div>',
].join('\n');

async function callSetJsx(id: number, jsx: string) {
  const req = new NextRequest(`http://localhost:3000/api/files/${id}/jsx`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsx }),
  });
  const res = await setJsxRoute(req, { params: Promise.resolve({ id: String(id) }) });
  return { status: res.status, body: await res.json() };
}

describe('POST /api/files/[id]/jsx — response shape (storyv2)', () => {
  const dbPath = getTestDbPath('storyv2_jsx_route');
  let fileId: number;

  beforeAll(async () => {
    await initTestDatabase(dbPath);
    if (!(await DocumentDB.getByPath('/org'))) {
      await DocumentDB.create('org', '/org', 'folder', { name: 'org' }, [], undefined, false);
    }
    const res = await createFile(
      { name: 'S', path: '/org/s', type: 'storyv2', content: { description: '', colorMode: 'dark' } },
      user,
    );
    fileId = res.data.id;
  });
  afterAll(async () => { await cleanupTestDatabase(dbPath); });

  it('returns the file directly as body.data — NOT a double-wrapped { data: file }', async () => {
    const { status, body } = await callSetJsx(fileId, storyJsx);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    // The file itself — carries the real fields the client/setFile needs.
    expect(body.data.id).toBe(fileId);
    expect(body.data.type).toBe('storyv2');
    expect(body.data.jsx).toBe(storyJsx);
    expect(typeof body.data.version).toBe('number');
    // The exact regression: no nested data envelope.
    expect(body.data.data).toBeUndefined();
  });

  it('the returned file derives a non-empty story (so the page renders, not "No story yet")', async () => {
    const { body } = await callSetJsx(fileId, storyJsx);
    const fs = dbFileToFileState(body.data);
    expect(fs.jsx).toBe(storyJsx);
    expect(fs.id).toBe(fileId);
    const content = fs.content as { story?: string };
    expect(content.story).toBeTruthy();
    expect(content.story).toContain('data-question-id="1234"');
  });

  it('publishes the file (draft=false) and bumps version on each set', async () => {
    const before = await DocumentDB.getById(fileId);
    const { body } = await callSetJsx(fileId, storyJsx + '\n');
    expect(body.data.draft).toBe(false);
    expect(body.data.version).toBeGreaterThan(before!.version);
  });
});
