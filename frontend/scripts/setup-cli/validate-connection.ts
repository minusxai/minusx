// setup-cli: test a database connection config with the real Node connector —
// the same `testConnection()` behind POST /api/connections/test.
//
//   echo '{"type":"postgresql","config":{"host":"…"}}' \
//     | docker run --rm -i <image> node --import tsx --import ./scripts/setup-cli/node-preload.mjs scripts/setup-cli/validate-connection.ts
//
// stdin: { name?: string, type: string, config: object }
// stdout: TestConnectionResult JSON ({ success, error?, … })
import { validateConnectionType, validateDuckDbFilePath } from '@/lib/data/helpers/connections';
import { getNodeConnector } from '@/lib/connections';
import { readStdinJson, emit, isMain, type CliOutcome } from './io';

export interface CliConnectionResult {
  success: boolean;
  error?: string;
  [key: string]: unknown;
}

export async function runValidateConnection(input: unknown): Promise<CliOutcome<CliConnectionResult>> {
  const body = (input ?? {}) as { name?: string | null; type?: string; config?: Record<string, unknown> };
  if (!body.type || !body.config) {
    return { result: { success: false, error: 'input requires type and config' }, exitCode: 2 };
  }
  try {
    validateConnectionType(body.type);
    validateDuckDbFilePath(body.type, body.config);
  } catch (err) {
    return { result: { success: false, error: err instanceof Error ? err.message : String(err) }, exitCode: 2 };
  }
  const connector = getNodeConnector(body.name || '', body.type, body.config);
  if (!connector) {
    return { result: { success: false, error: `Unsupported connection type '${body.type}'` }, exitCode: 2 };
  }
  const result = { ...(await connector.testConnection(false)) } as CliConnectionResult;
  return { result, exitCode: result.success ? 0 : 1 };
}

if (isMain(import.meta.url)) {
  void emit(readStdinJson().then(runValidateConnection));
}
