// The setup-cli ships PRECOMPILED into the image (`npm run build:setup-cli`)
// and is executed with plain `node` — never transpiled at run time.
//
// Why this is a hard requirement: the published image is linux/amd64, so on
// Apple Silicon it runs emulated, and tsx's esbuild service dies there
// ("The service was stopped: write EPIPE"). install.sh's LLM/database
// validation then silently degraded to "no response".
//
// This test builds the real bundle and runs it under a bare `node` (no tsx, no
// --import hooks, no loader) — if an entry ever regains a runtime-transpile
// dependency, or the bundle stops resolving, it fails here instead of in a
// user's terminal.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ENTRIES = ['validate-llm', 'validate-connection', 'list-models'];
let outDir: string;

/** The exact esbuild invocation the Dockerfile runs, into a temp outdir. */
function bundleArgs(dest: string): string[] {
  const script = (JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> })
    .scripts['build:setup-cli'];
  expect(script, 'package.json must define build:setup-cli').toBeTruthy();
  return script
    .replace(/^esbuild /, '')
    .replace(/--outdir=\S+/, `--outdir=${dest}`)
    .split(/\s+/);
}

beforeAll(() => {
  // Inside the project: the bundle keeps node_modules EXTERNAL (as in the
  // image, where it sits at /app/setup-cli next to /app/node_modules), so it
  // must be able to resolve them by walking up from its own directory.
  outDir = mkdtempSync(join(process.cwd(), '.setup-cli-bundle-test-'));
  execFileSync('npx', ['esbuild', ...bundleArgs(outDir)], { stdio: 'pipe' });
}, 60_000);

afterAll(() => rmSync(outDir, { recursive: true, force: true }));

describe('setup-cli bundle', () => {
  it('builds one plain-JS entry per CLI', () => {
    for (const entry of ENTRIES) {
      expect(existsSync(join(outDir, `${entry}.js`)), `${entry}.js missing from the bundle`).toBe(true);
    }
  });

  it('runs under a bare node — no tsx, no loader hooks, no server-only throw', () => {
    // Malformed input → exitCode 2 + a JSON result. Reaching that at all proves
    // the module graph (lib/llm → orchestrator → pi-ai, and the server-only
    // alias) loaded under plain node.
    const result = spawnSync(process.execPath, [join(outDir, 'validate-llm.js')], {
      input: '{}',
      encoding: 'utf8',
      // A stray NODE_OPTIONS=--import tsx in the environment would mask the very
      // thing under test.
      env: { ...process.env, NODE_OPTIONS: '' },
    });
    expect(result.stderr).not.toMatch(/Cannot find module|server-only|esbuild|TransformError/);
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false });
  }, 30_000);

  it('validate-connection loads its connectors under bare node', () => {
    const result = spawnSync(process.execPath, [join(outDir, 'validate-connection.js')], {
      input: JSON.stringify({ type: 'nope', config: {} }),
      encoding: 'utf8',
      env: { ...process.env, NODE_OPTIONS: '' },
    });
    expect(result.stderr).not.toMatch(/Cannot find module|server-only|esbuild|TransformError/);
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({ success: false });
  }, 30_000);
});
