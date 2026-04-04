import { fixFilesWithBrokenPaths } from '../migrations';
import { CompanyData, ExportedDocument } from '../import-export';

function doc(id: number, path: string, type = 'question'): ExportedDocument {
  return {
    id,
    name: path.split('/').filter(Boolean).pop()!,
    path,
    type: type as ExportedDocument['type'],
    content: {},
    references: [],
    version: 1,
    last_edit_id: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    company_id: 1,
  };
}

function company(...docs: ExportedDocument[]): CompanyData {
  return {
    id: 1,
    name: 'test',
    display_name: 'Test',
    subdomain: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    users: [],
    documents: docs,
  };
}

function paths(c: CompanyData): string[] {
  return c.documents.map(d => d.path);
}

describe('fixFilesWithBrokenPaths', () => {
  // ── Basic no-op cases ─────────────────────────────────────────────────────

  it('leaves files alone when their parent folder exists', () => {
    const c = company(
      doc(1, '/org', 'folder'),
      doc(2, '/org/report'),
    );
    fixFilesWithBrokenPaths(c);
    expect(paths(c)).toContain('/org/report');
  });

  it('leaves /org, /tutorial, /internals root folders alone', () => {
    const c = company(
      doc(1, '/org', 'folder'),
      doc(2, '/tutorial', 'folder'),
      doc(3, '/internals', 'folder'),
    );
    fixFilesWithBrokenPaths(c);
    expect(paths(c)).toEqual(expect.arrayContaining(['/org', '/tutorial', '/internals']));
  });

  // ── Root-level (parts.length === 1) ──────────────────────────────────────

  it('moves a non-folder at root level with an invalid name to /org', () => {
    const c = company(
      doc(1, '/org', 'folder'),
      doc(2, '/orphan-question'),         // not a valid mode root
    );
    fixFilesWithBrokenPaths(c);
    expect(c.documents.find(d => d.id === 2)!.path).toBe('/org/orphan-question');
  });

  it('moves a folder at root level with an invalid name to /org, cascading children', () => {
    const c = company(
      doc(1, '/org', 'folder'),
      doc(2, '/ghost', 'folder'),          // invalid root folder
      doc(3, '/ghost/child-question'),
      doc(4, '/ghost/sub', 'folder'),
      doc(5, '/ghost/sub/deep-question'),
    );
    fixFilesWithBrokenPaths(c);
    expect(c.documents.find(d => d.id === 2)!.path).toBe('/org/ghost');
    expect(c.documents.find(d => d.id === 3)!.path).toBe('/org/ghost/child-question');
    expect(c.documents.find(d => d.id === 4)!.path).toBe('/org/ghost/sub');
    expect(c.documents.find(d => d.id === 5)!.path).toBe('/org/ghost/sub/deep-question');
  });

  // ── Broken intermediate parent ────────────────────────────────────────────

  it('moves file to nearest valid ancestor when immediate parent is missing', () => {
    const c = company(
      doc(1, '/org', 'folder'),
      doc(2, '/org/missing/report'),
    );
    fixFilesWithBrokenPaths(c);
    expect(c.documents[1].path).toBe('/org/report');
  });

  it('picks the deepest valid ancestor, not the shallowest', () => {
    const c = company(
      doc(1, '/org', 'folder'),
      doc(2, '/org/a', 'folder'),
      doc(3, '/org/a/b/report'),           // /org/a/b missing; nearest valid is /org/a
    );
    fixFilesWithBrokenPaths(c);
    expect(c.documents[2].path).toBe('/org/a/report');
  });

  it('handles multiple levels of missing ancestors', () => {
    const c = company(
      doc(1, '/org', 'folder'),
      doc(2, '/org/a/b/c/report'),         // /org/a, /org/a/b, /org/a/b/c all missing
    );
    fixFilesWithBrokenPaths(c);
    expect(c.documents[1].path).toBe('/org/report');
  });

  // ── Folder with broken parent ─────────────────────────────────────────────

  it('moves a folder with a broken parent and cascades all its children', () => {
    const c = company(
      doc(1, '/org', 'folder'),
      doc(2, '/org/missing/subfolder', 'folder'),  // /org/missing doesn't exist
      doc(3, '/org/missing/subfolder/query'),
    );
    fixFilesWithBrokenPaths(c);
    expect(c.documents.find(d => d.id === 2)!.path).toBe('/org/subfolder');
    expect(c.documents.find(d => d.id === 3)!.path).toBe('/org/subfolder/query');
  });

  it('files already under a valid folder are not moved even if that folder had a broken parent', () => {
    // /org/missing is missing, but after fixing /org/subfolder its child /query should stay put
    const c = company(
      doc(1, '/org', 'folder'),
      doc(2, '/org/missing/subfolder', 'folder'),
      doc(3, '/org/missing/subfolder/query'),
      doc(4, '/org/missing/subfolder/nested', 'folder'),
      doc(5, '/org/missing/subfolder/nested/deep'),
    );
    fixFilesWithBrokenPaths(c);
    const byId = (id: number) => c.documents.find(d => d.id === id)!.path;
    expect(byId(2)).toBe('/org/subfolder');
    expect(byId(3)).toBe('/org/subfolder/query');
    expect(byId(4)).toBe('/org/subfolder/nested');
    expect(byId(5)).toBe('/org/subfolder/nested/deep');
  });

  // ── Slot conflicts ────────────────────────────────────────────────────────

  it('tries a higher ancestor when the nearest valid slot is already occupied', () => {
    const c = company(
      doc(1, '/org', 'folder'),
      doc(2, '/org/a', 'folder'),
      doc(3, '/org/a/report'),             // occupies /org/a/report
      doc(4, '/org/a/b/report'),           // nearest free slot is /org/report
    );
    fixFilesWithBrokenPaths(c);
    expect(c.documents.find(d => d.id === 3)!.path).toBe('/org/a/report'); // untouched
    expect(c.documents.find(d => d.id === 4)!.path).toBe('/org/report');
  });

  // ── /org fallback ─────────────────────────────────────────────────────────

  it('falls back to /org when no valid ancestor exists anywhere in the path', () => {
    const c = company(
      doc(1, '/org', 'folder'),
      doc(2, '/tutorial/missing/report'),  // /tutorial doesn't exist as a folder
    );
    fixFilesWithBrokenPaths(c);
    expect(c.documents.find(d => d.id === 2)!.path).toBe('/org/report');
  });

  it('appends numeric suffix to resolve name collision in /org fallback', () => {
    const c = company(
      doc(1, '/org', 'folder'),
      doc(2, '/org/report'),               // occupies /org/report
      doc(3, '/tutorial/x/report'),        // falls back to /org — collision → suffix
    );
    fixFilesWithBrokenPaths(c);
    expect(c.documents.find(d => d.id === 2)!.path).toBe('/org/report');
    expect(c.documents.find(d => d.id === 3)!.path).toBe('/org/report_2');
  });

  it('leaves file unchanged when /org does not exist and no valid ancestor', () => {
    const c = company(
      doc(1, '/tutorial', 'folder'),       // only /tutorial exists
      doc(2, '/corp/a/b/report'),          // /corp not in path; /org missing
    );
    fixFilesWithBrokenPaths(c);
    expect(c.documents.find(d => d.id === 2)!.path).toBe('/corp/a/b/report');
  });

  // ── Multi-file edge cases ─────────────────────────────────────────────────

  it('handles multiple broken files without cross-contaminating destinations', () => {
    const c = company(
      doc(1, '/org', 'folder'),
      doc(2, '/org/missing/file1'),
      doc(3, '/org/missing/file2'),
    );
    fixFilesWithBrokenPaths(c);
    expect(c.documents.find(d => d.id === 2)!.path).toBe('/org/file1');
    expect(c.documents.find(d => d.id === 3)!.path).toBe('/org/file2');
  });

  it('two broken files with the same name: second goes to next available ancestor', () => {
    const c = company(
      doc(1, '/org', 'folder'),
      doc(2, '/org/a', 'folder'),
      doc(3, '/org/a/x/report'),           // moves to /org/a/report (nearest free)
      doc(4, '/org/a/y/report'),           // /org/a/report now taken → climbs to /org/report
    );
    fixFilesWithBrokenPaths(c);
    expect(c.documents.find(d => d.id === 3)!.path).toBe('/org/a/report');
    expect(c.documents.find(d => d.id === 4)!.path).toBe('/org/report');
  });
});
