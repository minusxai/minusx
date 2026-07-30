/**
 * DuckDB must read the path the store actually wrote to.
 *
 * Uploads go through the object store, which prefixes every key with the namespace.
 * DuckDB does NOT go through the store — it is handed a filesystem path or an `s3://`
 * URL and reads it itself. So the connector has to resolve the logical `s3_key` to its
 * physical form, exactly as the store does on write.
 *
 * Joining the logical key looks correct and reads the wrong directory: the parquet exists,
 * just one level up from where the query looks. It surfaces as DuckDB's
 * "No files found that match the pattern …", which reads like a lost upload rather than a
 * path bug — and it shipped, because every unit test passed and only a real upload-then-query
 * flow touches both halves.
 *
 * The same applies to `allowed_directories`: allow-listing the logical prefix refuses every
 * read once `enable_external_access = false`.
 */
import { resolveObjectKey } from '@/lib/object-store';

const isolation = vi.fn();

vi.mock('@/lib/modules/registry', () => ({
  getModules: () => ({ namespace: { isolation } }),
}));

beforeEach(() => {
  isolation.mockReset();
});

describe('physical key resolution for DuckDB-visible paths', () => {
  it('prefixes the logical key with the namespace', async () => {
    isolation.mockResolvedValue('mx');
    expect(await resolveObjectKey('csvs/tutorial/static/abc.parquet'))
      .toBe('mx/csvs/tutorial/static/abc.parquet');
  });

  it('puts a different namespace in a different directory', async () => {
    // The isolation guarantee for uploaded data: two namespaces must never resolve the
    // same logical key to the same physical path.
    isolation.mockResolvedValue('7');
    const a = await resolveObjectKey('csvs/tutorial/static/abc.parquet');
    isolation.mockResolvedValue('9');
    const b = await resolveObjectKey('csvs/tutorial/static/abc.parquet');

    expect(a).not.toBe(b);
    expect(a.split('/')[0]).toBe('7');
    expect(b.split('/')[0]).toBe('9');
  });

  it('leading segment is the namespace, which is what allowed_directories allow-lists', async () => {
    // The connector takes `.split('/')[0]` of the PHYSICAL key for the allow-list. If it
    // took it from the logical key it would allow-list "csvs" and refuse every read.
    isolation.mockResolvedValue('mx');
    const physical = await resolveObjectKey('csvs/tutorial/static/abc.parquet');
    expect(physical.split('/')[0]).toBe('mx');
    expect(physical.split('/')[0]).not.toBe('csvs');
  });
});
