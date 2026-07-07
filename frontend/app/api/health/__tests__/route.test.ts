// GET /api/health — public liveness endpoint (the middleware already whitelists /api/health as
// unauthenticated; until now no route existed, so health checks got an HTML 404 app shell).
import { describe, it, expect } from 'vitest';
import { GET } from '@/app/api/health/route';

describe('GET /api/health', () => {
  it('returns JSON liveness info without auth', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(typeof body.uptime_s).toBe('number');
    expect(body.uptime_s).toBeGreaterThanOrEqual(0);
    expect(typeof body.rss_mb).toBe('number');
    expect(body.rss_mb).toBeGreaterThan(0);
  });
});
