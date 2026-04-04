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
  it('leaves files alone when their parent folder exists', () => {
    const c = company(
      doc(1, '/org', 'folder'),
      doc(2, '/org/report'),
    );
    fixFilesWithBrokenPaths(c);
    expect(paths(c)).toEqual(['/org', '/org/report']);
  });

  it('moves file to nearest valid ancestor when immediate parent is missing', () => {
    // /org/missing doesn't exist as a folder; /org does
    const c = company(
      doc(1, '/org', 'folder'),
      doc(2, '/org/missing/report'),
    );
    fixFilesWithBrokenPaths(c);
    expect(c.documents[1].path).toBe('/org/report');
  });

  it('picks the deepest valid ancestor, not the shallowest', () => {
    // /org/a exists, /org/a/b does not — should land in /org/a, not /org
    const c = company(
      doc(1, '/org', 'folder'),
      doc(2, '/org/a', 'folder'),
      doc(3, '/org/a/b/report'),
    );
    fixFilesWithBrokenPaths(c);
    expect(c.documents[2].path).toBe('/org/a/report');
  });

  it('handles multiple levels of missing ancestors', () => {
    // /org/a, /org/a/b, /org/a/b/c all missing — deepest valid is /org
    const c = company(
      doc(1, '/org', 'folder'),
      doc(2, '/org/a/b/c/report'),
    );
    fixFilesWithBrokenPaths(c);
    expect(c.documents[1].path).toBe('/org/report');
  });

  it('skips folder-type documents', () => {
    // A folder with a broken parent should be left alone
    const c = company(
      doc(1, '/org', 'folder'),
      doc(2, '/org/missing/subfolder', 'folder'),
    );
    fixFilesWithBrokenPaths(c);
    expect(c.documents[1].path).toBe('/org/missing/subfolder');
  });

  it('tries a higher ancestor when the nearest valid slot is already occupied', () => {
    // /org/a/report already exists → nearest valid (/org/a) is occupied →
    // fall back to /org/report
    const c = company(
      doc(1, '/org', 'folder'),
      doc(2, '/org/a', 'folder'),
      doc(3, '/org/a/report'),       // occupies /org/a/report
      doc(4, '/org/a/b/report'),     // nearest free slot must be /org/report
    );
    fixFilesWithBrokenPaths(c);
    expect(c.documents[2].path).toBe('/org/a/report'); // doc 3 untouched
    expect(c.documents[3].path).toBe('/org/report');
  });

  it('falls back to /org when no valid ancestor exists anywhere in the path', () => {
    // /tutorial doesn't exist as a folder, but /org does
    const c = company(
      doc(1, '/org', 'folder'),
      doc(2, '/tutorial/missing/report'),
    );
    fixFilesWithBrokenPaths(c);
    expect(c.documents[1].path).toBe('/org/report');
  });

  it('appends numeric suffix to resolve name collision in /org fallback', () => {
    // /org/report is already taken; second file landing in /org should become /org/report_2
    const c = company(
      doc(1, '/org', 'folder'),
      doc(2, '/org/report'),             // occupies /org/report
      doc(3, '/tutorial/x/report'),      // falls back to /org, collision → suffix
    );
    fixFilesWithBrokenPaths(c);
    expect(c.documents[1].path).toBe('/org/report');   // untouched
    expect(c.documents[2].path).toBe('/org/report_2');
  });

  it('leaves file unchanged when /org does not exist and no valid ancestor', () => {
    // Only /tutorial exists; file is under /corp which has no valid folder at all
    const c = company(
      doc(1, '/tutorial', 'folder'),
      doc(2, '/corp/a/b/report'),
    );
    fixFilesWithBrokenPaths(c);
    expect(c.documents[1].path).toBe('/corp/a/b/report');
  });

  it('handles multiple broken files without cross-contaminating their destinations', () => {
    const c = company(
      doc(1, '/org', 'folder'),
      doc(2, '/org/missing/file1'),
      doc(3, '/org/missing/file2'),
    );
    fixFilesWithBrokenPaths(c);
    expect(c.documents[1].path).toBe('/org/file1');
    expect(c.documents[2].path).toBe('/org/file2');
  });

  it('two broken files with the same name: second goes to next available ancestor', () => {
    // Both want /org/a/report but /org/a/report is taken after the first move.
    // Second should climb to /org/report.
    const c = company(
      doc(1, '/org', 'folder'),
      doc(2, '/org/a', 'folder'),
      doc(3, '/org/a/x/report'),   // moves to /org/a/report (nearest free)
      doc(4, '/org/a/y/report'),   // /org/a/report now taken → climbs to /org/report
    );
    fixFilesWithBrokenPaths(c);
    expect(c.documents[2].path).toBe('/org/a/report');
    expect(c.documents[3].path).toBe('/org/report');
  });
});
