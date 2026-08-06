/**
 * The styles loader serves CUSTOM CSS only. The logo rules are derived from
 * `OrgConfig.branding` and injected by the layout as a separate layer BEFORE
 * the custom CSS — so a styles document that is byte-identical to the seeded
 * default (`DEFAULT_STYLES`) is "no customization", not an intentional
 * override, and must not shadow the config-derived logo. Anything an admin
 * actually wrote differs from the seed and keeps winning via cascade order.
 */
import { initTestDatabase, cleanupTestDatabase, getTestDbPath } from '@/store/__tests__/test-utils';
import { DocumentDB } from '@/lib/database/documents-db';
import { getStylesForMode } from '@/lib/data/configs.server';
import { DEFAULT_STYLES } from '@/lib/branding/whitelabel';

const dbPath = getTestDbPath('org_styles_custom_only');
const STYLES_PATH = '/org/configs/styles';

async function setStylesDoc(css: string) {
  const existing = await DocumentDB.getByPath(STYLES_PATH);
  if (existing) {
    await DocumentDB.update(existing.id, 'styles', STYLES_PATH, { styles: css }, [], `set-${css.length}-${css.slice(0, 24)}`);
  } else {
    await DocumentDB.create('styles', STYLES_PATH, 'styles', { styles: css }, [], undefined, false);
  }
}

describe('getStylesForMode — custom styles only', () => {
  beforeAll(async () => {
    await initTestDatabase(dbPath);
  }, 120000);

  afterAll(async () => {
    await cleanupTestDatabase(dbPath);
  }, 60000);

  it('a styles document identical to the seeded default is NOT a customization', async () => {
    await setStylesDoc(DEFAULT_STYLES);
    expect(await getStylesForMode()).toBe('');
  });

  it('a hand-written styles document is served verbatim', async () => {
    const custom = `[aria-label="Workspace logo"] { background-image: url('/my-own.svg'); }`;
    await setStylesDoc(custom);
    expect(await getStylesForMode()).toBe(custom);
  });

  it('a missing styles document yields no custom CSS (the derived layer covers the logo)', async () => {
    const doc = await DocumentDB.getByPath(STYLES_PATH);
    if (doc) await DocumentDB.deleteByIds([doc.id]);
    expect(await getStylesForMode()).toBe('');
  });
});
