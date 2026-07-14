// setup-cli entries — run inside the app image via `docker run --rm <image>
// npx tsx --conditions react-server scripts/setup-cli/<entry>.ts` by setup.sh.
// Each entry reads JSON on stdin and prints a JSON result; these tests drive
// the exported run* functions directly.
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { runValidateLlm } from '../validate-llm';
import { runValidateConnection } from '../validate-connection';
import { runListModels } from '../list-models';

describe('runValidateLlm', () => {
  it('rejects malformed input with exitCode 2', async () => {
    const { result, exitCode } = await runValidateLlm({ nope: true });
    expect(exitCode).toBe(2);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/provider/i);
  });

  it('returns ok:false with exitCode 1 for a model unknown to the registry', async () => {
    const { result, exitCode } = await runValidateLlm({
      provider: { name: 'oa', provider: 'openai', apiKey: 'k' },
      model: 'gpt-definitely-not-real',
    });
    expect(exitCode).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not in the model registry/);
  });
});

describe('runValidateConnection', () => {
  it('rejects malformed input with exitCode 2', async () => {
    const { result, exitCode } = await runValidateConnection({ config: {} });
    expect(exitCode).toBe(2);
    expect(result.success).toBe(false);
  });

  it('rejects an unsupported connection type with exitCode 2', async () => {
    const { result, exitCode } = await runValidateConnection({ type: 'oracle', config: {} });
    expect(exitCode).toBe(2);
    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/type/i);
  });

  it('tests a real connection end-to-end (duckdb) and reports success', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mx-setup-cli-'));
    const filePath = join(dir, 'probe.duckdb');
    // testConnection opens existing files (it does not create) — make a real one.
    const instance = await DuckDBInstance.create(filePath);
    instance.closeSync();
    const { result, exitCode } = await runValidateConnection({
      name: 'cli_test',
      type: 'duckdb',
      config: { file_path: filePath },
    });
    expect(result.success).toBe(true);
    expect(exitCode).toBe(0);
  });

  it('reports a failing connection as success:false with exitCode 1', async () => {
    const { result, exitCode } = await runValidateConnection({
      name: 'bad_pg',
      type: 'postgresql',
      // A closed local port refuses instantly — deterministic fast failure.
      config: { host: '127.0.0.1', port: 59999, database: 'x', username: 'x', password: 'x' },
    });
    expect(result.success).toBe(false);
    expect(exitCode).toBe(1);
  }, 30_000);
});

describe('runListModels', () => {
  it('lists merged models for one provider', async () => {
    const { result, exitCode } = await runListModels('openai');
    expect(exitCode).toBe(0);
    const openai = (result as { providers: Record<string, { id: string }[]> }).providers.openai;
    expect(openai.map(m => m.id)).toContain('gpt-4o');
  });

  it('lists all registry providers when none specified', async () => {
    const { result } = await runListModels(undefined);
    const providers = (result as { providers: Record<string, unknown[]> }).providers;
    expect(Object.keys(providers)).toEqual(expect.arrayContaining(['anthropic', 'openai', 'google', 'amazon-bedrock']));
  });
});
