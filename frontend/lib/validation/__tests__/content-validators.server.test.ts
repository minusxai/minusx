// validateFileStateServer runs a LIVE connection test for connection files. The stored config holds
// @SECRETS/… refs (raw credentials live in the server-only secrets table), so the refs must be
// resolved to real values BEFORE the connector tests them — otherwise a connector that parses a
// credential field (BigQuery does JSON.parse(service_account_json)) chokes on the literal
// "@SECRETS/…" string: "Unexpected token '@', "@SECRETS/c"... is not valid JSON".
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { getTestDbPath, initTestDatabase, cleanupTestDatabase } from '@/store/__tests__/test-utils';
import { extractConnectionSecrets } from '@/lib/secrets/connection-secrets.server';

// Capture the config the connector is actually handed, and mimic BigQuery's credential parsing.
const captured = vi.hoisted(() => ({ config: null as Record<string, any> | null }));
vi.mock('@/lib/connections', () => ({
  getNodeConnector: (_name: string, _type: string, config: Record<string, any>) => {
    captured.config = config;
    return {
      async testConnection() {
        try {
          JSON.parse(config.service_account_json); // BigQuery connector does exactly this
          return { success: true, message: 'ok' };
        } catch (e: any) {
          return { success: false, message: e.message };
        }
      },
    };
  },
}));

import { validateFileStateServer } from '../content-validators.server';

describe('validateFileStateServer — resolves connection secrets before the live test', () => {
  const dbPath = getTestDbPath('content_validators_server');
  beforeAll(async () => { await initTestDatabase(dbPath); });
  afterAll(async () => { await cleanupTestDatabase(dbPath); });

  it('resolves @SECRETS refs so a credential-parsing connector tests the REAL value', async () => {
    const raw = '{"client_email":"svc@x.iam","private_key":"-----KEY-----"}';
    const config = await extractConnectionSecrets('bq_demo', { project_id: 'p', service_account_json: raw });
    expect(config.service_account_json).toMatch(/^@SECRETS\//); // precondition: persisted as a ref

    const err = await validateFileStateServer({
      type: 'connection',
      name: 'bq_demo',
      content: { type: 'bigquery', config },
    });

    expect(err).toBeNull();                                  // the test must NOT see the raw ref
    expect(captured.config?.service_account_json).toBe(raw); // connector got the resolved JSON
  });
});
