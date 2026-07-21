// POST /api/story-css — preview compile for STAGED story content. A design-system story
// staged by an agent EditFile (or mid-WYSIWYG-edit) has no persisted compiledCss yet: the
// client posts the draft story and gets back the same CSS the save path would compute, so
// the draft renders styled BEFORE it is saved. Marker-gated exactly like the save path.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const USER = { userId: 1, email: 'u@example.com', name: 'U', role: 'admin', home_folder: '/org', mode: 'org' };

vi.mock('@/lib/auth/auth-helpers', () => ({ getEffectiveUser: vi.fn() }));

import { POST } from '@/app/api/story-css/route';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { NextRequest } from 'next/server';

const mockAuth = vi.mocked(getEffectiveUser);

function post(body: unknown) {
  const req = new NextRequest('http://localhost/api/story-css', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return POST(req, { params: Promise.resolve({}) } as never);
}

beforeEach(() => {
  mockAuth.mockReset().mockResolvedValue(USER as unknown as Awaited<ReturnType<typeof getEffectiveUser>>);
});

describe('POST /api/story-css', () => {
  it('compiles the utilities of a marked story draft', async () => {
    const res = await post({ story: '<div data-design="tw" class="grid bg-rose-50">x</div>' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.css).toContain('.bg-rose-50');
  });

  it('returns null css for an unmarked (legacy) story', async () => {
    const res = await post({ story: '<div class="story-sc">x</div>' });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.css).toBeNull();
  });

  it('rejects a missing/non-string story', async () => {
    const res = await post({});
    expect(res.status).toBe(400);
  });
});

// jsx-format drafts (Story_Design_V2 §3): no data-design marker exists in shadcn JSX source,
// so the client sends format:'jsx' and the route force-compiles — otherwise drafts render
// unstyled until save.
describe('format:"jsx" force compile', () => {
  it('compiles a markerless jsx draft when format is jsx', async () => {
    const res = await post({ story: '<Card className="bg-amber-100">x</Card>', format: 'jsx' });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.data.css).toContain('.bg-amber-100');
  });

  it('still returns null css for a markerless legacy draft without format', async () => {
    const res = await post({ story: '<div class="bg-amber-100">x</div>' });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.data.css).toBeNull();
  });
});
