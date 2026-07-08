/**
 * Story design-system CSS — write-path integration.
 *
 * `compiledCss` must stay consistent with the story markup through EVERY door a story write
 * can come through (agent EditFile, WYSIWYG browser save, raw API) — all of which funnel into
 * FilesAPI.createFile / FilesAPI.saveFile. The server recomputes it on each write; a stale or
 * forged client copy is never persisted.
 */
import { FilesAPI } from '@/lib/data/files.server';
import { DocumentDB } from '@/lib/database/documents-db';
import { initTestDatabase, cleanupTestDatabase, getTestDbPath } from '@/store/__tests__/test-utils';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type { CompiledCssStoryContent } from '../story-css';

const TEST_DB_PATH = getTestDbPath('story_css_save');
const user: EffectiveUser = { userId: 1, name: 'A', email: 'a@x.com', role: 'admin', mode: 'org', home_folder: '' };

const twStory = (cls: string) =>
  `<div class="mx-story" data-design="tw"><p class="${cls}">hello</p></div>`;

describe('FilesAPI write paths recompute compiledCss for stories', () => {
  beforeAll(async () => { await initTestDatabase(TEST_DB_PATH); });
  afterAll(async () => { await cleanupTestDatabase(TEST_DB_PATH); });

  it('createFile compiles CSS for a marked story', async () => {
    const created = await FilesAPI.createFile({
      name: 'tw_story', path: '/org/tw_story', type: 'story',
      content: { description: null, story: twStory('bg-amber-100'), parameterValues: null },
      references: [],
    }, user);
    const content = created.data.content as CompiledCssStoryContent;
    expect(content.compiledCss).toBeTruthy();
    expect(content.compiledCss).toContain('.bg-amber-100');
  });

  it('saveFile recompiles when the markup changes and ignores the client copy', async () => {
    const created = await FilesAPI.createFile({
      name: 'tw_story2', path: '/org/tw_story2', type: 'story',
      content: { description: null, story: twStory('bg-amber-100'), parameterValues: null },
      references: [],
    }, user);
    const id = created.data.id;

    // Simulates the WYSIWYG path: client sends edited story + its STALE compiledCss copy.
    await FilesAPI.saveFile(id, 'tw_story2', '/org/tw_story2', {
      description: null,
      story: twStory('bg-cyan-200'),
      parameterValues: null,
      compiledCss: '.stale-client-copy{}',
    } as unknown as Record<string, unknown>, [], user);

    const persisted = await DocumentDB.getById(id);
    const content = persisted!.content as CompiledCssStoryContent;
    expect(content.compiledCss).toContain('.bg-cyan-200');
    expect(content.compiledCss).not.toContain('.bg-amber-100');
    expect(content.compiledCss).not.toContain('stale-client-copy');
  });

  it('legacy stories persist compiledCss: null on create and save', async () => {
    const legacy = '<style>.s{color:red}</style><div class="s">legacy</div>';
    const created = await FilesAPI.createFile({
      name: 'legacy_story', path: '/org/legacy_story', type: 'story',
      content: { description: null, story: legacy, parameterValues: null },
      references: [],
    }, user);
    expect((created.data.content as CompiledCssStoryContent).compiledCss).toBeNull();

    await FilesAPI.saveFile(created.data.id, 'legacy_story', '/org/legacy_story', {
      description: null, story: legacy + '<!-- edited -->', parameterValues: null,
    } as unknown as Record<string, unknown>, [], user);
    const persisted = await DocumentDB.getById(created.data.id);
    expect((persisted!.content as CompiledCssStoryContent).compiledCss).toBeNull();
  });
});
