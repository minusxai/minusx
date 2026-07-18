/**
 * POST /api/viz/validate — the server entry to the viz validator (the vendored VL
 * schema never ships to the browser; tool handlers call this route inline on
 * EditFile/CreateFile viz changes).
 */
import { NextRequest } from 'next/server';
import { POST } from '../route';

const post = (body: unknown) =>
  POST(
    new NextRequest('http://localhost/api/viz/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({}) } as never,
  );

const VALID_VIZ = {
  version: 2,
  source: {
    kind: 'vega-lite',
    grammar: 'vega-lite@6',
    spec: {
      mark: { type: 'bar' },
      encoding: {
        x: { field: 'region', type: 'nominal' },
        y: { field: 'revenue', type: 'quantitative' },
      },
    },
  },
};

describe('POST /api/viz/validate', () => {
  it('accepts a valid envelope with matching columns', async () => {
    const res = await post({
      viz: VALID_VIZ,
      columns: [{ name: 'region', kind: 'nominal' }, { name: 'revenue', kind: 'quantitative' }],
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.ok).toBe(true);
  });

  it('reports field errors against the provided columns', async () => {
    const res = await post({
      viz: VALID_VIZ,
      columns: [{ name: 'region', kind: 'nominal' }],
    });
    const json = await res.json();
    expect(json.data.ok).toBe(false);
    expect(json.data.issues[0].code).toBe('E_FIELD_NOT_FOUND');
    expect(json.data.issues[0].message).toContain('region');
  });

  it('skips field checks when columns are omitted', async () => {
    const res = await post({ viz: VALID_VIZ });
    const json = await res.json();
    expect(json.data.ok).toBe(true);
  });

  it('rejects a malformed envelope', async () => {
    const res = await post({ viz: { version: 1 } });
    const json = await res.json();
    expect(json.data.ok).toBe(false);
    expect(json.data.issues[0].code).toBe('E_ENVELOPE');
  });
});
