// storyRenderer is WORKSPACE-level infrastructure (like the `llm` config): it must resolve from the
// ORG config regardless of the viewing mode. Stories are viewed per-mode (a tutorial story SSRs in
// tutorial mode), but the rendering engine is a single workspace choice set once in Settings. Without
// the org overlay, a canvas setting saved in org Settings silently fails to apply to tutorial stories
// (they read the tutorial config, which still says dom) — the exact "it's not using canvas" bug.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestDbPath, initTestDatabase, cleanupTestDatabase } from '@/store/__tests__/test-utils';
import { saveRawConfig, getConfigsForMode } from '@/lib/data/configs.server';

const dbPath = getTestDbPath('configs_server_story_renderer');
beforeAll(async () => { await initTestDatabase(dbPath); });
afterAll(async () => { await cleanupTestDatabase(dbPath); });

describe('getConfigsForMode — storyRenderer is org-pinned (workspace-level)', () => {
  it('a non-org mode resolves storyRenderer from the ORG config, not its own', async () => {
    await saveRawConfig('org', { storyRenderer: 'canvas' });
    await saveRawConfig('tutorial', { storyRenderer: 'dom' });

    const tutorial = await getConfigsForMode('tutorial');
    expect(tutorial.config.storyRenderer).toBe('canvas'); // org wins, tutorial's own 'dom' ignored
  });

  it('org is AUTHORITATIVE — org=dom overrides a tutorial config that says canvas', async () => {
    // Proves replace-semantics, not fill-if-absent: even when the tutorial doc has an explicit value,
    // org's value wins. Otherwise a stale tutorial seed could shadow the workspace setting.
    await saveRawConfig('org', { storyRenderer: 'dom' });
    await saveRawConfig('tutorial', { storyRenderer: 'canvas' });

    const tutorial = await getConfigsForMode('tutorial');
    expect(tutorial.config.storyRenderer).toBe('dom');
  });

  it('org mode returns its own storyRenderer (no self-overlay / recursion)', async () => {
    await saveRawConfig('org', { storyRenderer: 'svg' });

    const org = await getConfigsForMode('org');
    expect(org.config.storyRenderer).toBe('svg');
  });

  it('honors the legacy useCanvasRenderer boolean on the ORG config for non-org modes', async () => {
    // A pre-union workspace stored `useCanvasRenderer: true`; the overlay must resolve it to 'canvas'
    // (via resolveStoryRenderer) so legacy workspaces keep working across modes.
    await saveRawConfig('org', { useCanvasRenderer: true });
    await saveRawConfig('tutorial', { storyRenderer: 'dom' });

    const tutorial = await getConfigsForMode('tutorial');
    expect(tutorial.config.storyRenderer).toBe('canvas');
  });

  it('defaults to dom for a non-org mode when the ORG config sets no renderer', async () => {
    await saveRawConfig('org', {});
    await saveRawConfig('tutorial', { storyRenderer: 'canvas' }); // must NOT leak through

    const tutorial = await getConfigsForMode('tutorial');
    expect(tutorial.config.storyRenderer).toBe('dom');
  });
});
