/**
 * Tests for serializeDatabases / parseDatabasesYaml round-trip
 *
 * Critical invariant: whitelist:'*' must survive the full
 * serialize → YAML → parse cycle without being corrupted to [].
 *
 * Run: npm test -- context-utils-yaml
 */

import { serializeDatabases, parseDatabasesYaml } from '../context-utils';
import type { DatabaseContext } from '@/lib/types';

// ---------------------------------------------------------------------------
// serializeDatabases
// ---------------------------------------------------------------------------

describe('serializeDatabases', () => {
  it("serializes '*' as `databases: '*'`", () => {
    const yaml = serializeDatabases('*');
    expect(yaml).toContain("databases: '*'");
  });

  it('serializes empty array as `databases: []`', () => {
    const yaml = serializeDatabases([]);
    expect(yaml).toContain('databases: []');
  });

  it('serializes undefined as `databases: []`', () => {
    const yaml = serializeDatabases(undefined);
    expect(yaml).toContain('databases: []');
  });

  it('serializes a populated array with connection + whitelist entries', () => {
    const databases: DatabaseContext[] = [
      {
        databaseName: 'my_conn',
        whitelist: [
          { name: 'public', type: 'schema' },
          { name: 'users', type: 'table', schema: 'public' },
        ],
      },
    ];
    const yaml = serializeDatabases(databases);
    expect(yaml).toContain('databaseName: my_conn');
    expect(yaml).toContain('name: public');
    expect(yaml).toContain('type: schema');
    expect(yaml).toContain('name: users');
    expect(yaml).toContain('type: table');
  });
});

// ---------------------------------------------------------------------------
// parseDatabasesYaml
// ---------------------------------------------------------------------------

describe('parseDatabasesYaml', () => {
  it("parses `databases: '*'` as the string '*'", () => {
    const result = parseDatabasesYaml("databases: '*'");
    expect(result).toBe('*');
  });

  it('parses an empty array correctly', () => {
    const result = parseDatabasesYaml('databases: []');
    expect(result).toEqual([]);
  });

  it('parses a populated databases array', () => {
    const yaml = `
databases:
  - databaseName: my_conn
    whitelist:
      - name: public
        type: schema
`;
    const result = parseDatabasesYaml(yaml);
    expect(result).not.toBe('*');
    expect(Array.isArray(result)).toBe(true);
    const arr = result as DatabaseContext[];
    expect(arr).toHaveLength(1);
    expect(arr[0].databaseName).toBe('my_conn');
    expect(arr[0].whitelist[0]).toMatchObject({ name: 'public', type: 'schema' });
  });

  it('returns [] for missing or null databases key', () => {
    expect(parseDatabasesYaml('')).toEqual([]);
    expect(parseDatabasesYaml('other_key: foo')).toEqual([]);
  });

  it('throws on invalid YAML syntax', () => {
    expect(() => parseDatabasesYaml('databases: [unclosed')).toThrow(/YAML parse error/);
  });
});

// ---------------------------------------------------------------------------
// Round-trip invariant — the critical anti-corruption test
// ---------------------------------------------------------------------------

describe('round-trip: whitelist serialization', () => {
  it("'*' survives serialize → parse without being corrupted to []", () => {
    const yaml = serializeDatabases('*');
    const parsed = parseDatabasesYaml(yaml);
    // Must come back as '*', NOT []
    expect(parsed).toBe('*');
    expect(parsed).not.toEqual([]);
  });

  it('a specific whitelist survives serialize → parse', () => {
    const original: DatabaseContext[] = [
      {
        databaseName: 'analytics',
        whitelist: [
          { name: 'reporting', type: 'schema' },
        ],
      },
    ];
    const yaml = serializeDatabases(original);
    const parsed = parseDatabasesYaml(yaml) as DatabaseContext[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].databaseName).toBe('analytics');
    expect(parsed[0].whitelist[0]).toMatchObject({ name: 'reporting', type: 'schema' });
  });

  it('an empty array survives serialize → parse as []', () => {
    const yaml = serializeDatabases([]);
    const parsed = parseDatabasesYaml(yaml);
    expect(parsed).toEqual([]);
    expect(parsed).not.toBe('*');
  });
});

// ---------------------------------------------------------------------------
// Tab-switch corruption scenario (documents the bug that was fixed)
// ---------------------------------------------------------------------------

describe('tab-switch corruption scenario', () => {
  it('switching from YAML to picker with whitelist:* does NOT corrupt to empty []', () => {
    // Simulate: container sets editorContent.databases = '*'
    // User opens YAML tab → sees `databases: '*'`
    // User switches back to picker tab → parseDatabasesYaml is called
    // Result must be '*', not []

    const yamlShownToUser = serializeDatabases('*');
    expect(yamlShownToUser.trim()).toBe("databases: '*'");  // user sees this

    const parsedOnTabSwitch = parseDatabasesYaml(yamlShownToUser);
    expect(parsedOnTabSwitch).toBe('*');  // must stay '*', not []
    // If this were [] it would overwrite whitelist:'*' with whitelist:[] = expose nothing
  });

  it('switching from picker to YAML with a specific whitelist shows correct YAML', () => {
    const databases: DatabaseContext[] = [
      { databaseName: 'static', whitelist: [{ name: 'mxfood', type: 'schema' }] },
    ];
    const yaml = serializeDatabases(databases);
    expect(yaml).toContain('databaseName: static');
    expect(yaml).toContain('name: mxfood');
    expect(yaml).not.toContain("'*'");
  });
});
