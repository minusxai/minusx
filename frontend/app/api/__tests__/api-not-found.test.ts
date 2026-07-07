// Unknown /api/* paths must return a JSON 404 — not fall through to the app-router HTML
// not-found page (which renders the full app shell and reads as a broken "logged-in screen"
// to API consumers like health checks and integrations).
import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/[...not_found]/route';

describe('API catch-all — JSON 404 for unknown /api paths', () => {
  it('GET returns a JSON 404 with the path named', async () => {
    const res = await GET(new NextRequest('http://localhost:3000/api/does/not/exist'));
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toContain('/api/does/not/exist');
  });

  it('POST returns the same JSON 404 shape', async () => {
    const res = await POST(new NextRequest('http://localhost:3000/api/nope', { method: 'POST' }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });
});
