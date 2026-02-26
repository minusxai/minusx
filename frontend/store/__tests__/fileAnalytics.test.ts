/**
 * Integration test for File Analytics - DuckDB event tracking
 *
 * Tests the analytics layer end-to-end:
 *   trackFileEvent() → DuckDB write → SELECT verification
 *
 * No Python backend or Redux needed — analytics are pure Node.js DuckDB writes.
 *
 * Run: npm test -- store/__tests__/fileAnalytics.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// NOTE: process.env.ANALYTICS_DB_DIR is read at *call time* (not import time),
// so setting it in beforeAll() before any getAnalyticsDb() call works correctly.
import { trackFileEvent } from '@/lib/analytics/file-analytics.server';
import { getAnalyticsDb, runQuery } from '@/lib/analytics/file-analytics.db';

const TEST_DIR = path.join(os.tmpdir(), `minusx-analytics-test-${process.pid}`);

// Use large IDs to avoid clashing with any real company data
const COMPANY_A = 91001;
const COMPANY_B = 91002;

describe('File Analytics - DuckDB event tracking', () => {
  beforeAll(() => {
    process.env.ANALYTICS_DB_DIR = TEST_DIR;
  });

  afterAll(() => {
    delete process.env.ANALYTICS_DB_DIR;
    // rmSync unlinks the directory entry even if DuckDB still has the file open;
    // on macOS/Linux this is safe — the file descriptor outlives the path.
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  // ---------------------------------------------------------------------------
  // Schema initialization
  // ---------------------------------------------------------------------------

  describe('schema initialization', () => {
    it('creates the DuckDB file and file_events table on first access', async () => {
      const db = await getAnalyticsDb(COMPANY_A);
      expect(db).toBeDefined();

      const dbPath = path.join(TEST_DIR, `${COMPANY_A}.duckdb`);
      expect(fs.existsSync(dbPath)).toBe(true);

      const rows = await runQuery<{ count: bigint }>(
        db,
        'SELECT COUNT(*) AS count FROM file_events',
        []
      );
      expect(Number(rows[0].count)).toBe(0);
    });

    it('returns the same Database instance on repeated calls (pool hit)', async () => {
      const db1 = await getAnalyticsDb(COMPANY_A);
      const db2 = await getAnalyticsDb(COMPANY_A);
      expect(db1).toBe(db2);
    });

    it('is idempotent: CREATE TABLE IF NOT EXISTS does not error on re-init', async () => {
      // getAnalyticsDb is called again — should not throw even though table exists
      await expect(getAnalyticsDb(COMPANY_A)).resolves.toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Event types — all five types round-trip correctly
  // ---------------------------------------------------------------------------

  describe('event types', () => {
    it('tracks a "created" event with all fields populated', async () => {
      await trackFileEvent({
        eventType: 'created',
        fileId: 10,
        fileType: 'question',
        filePath: '/org/revenue',
        fileName: 'Revenue Query',
        userId: 7,
        userEmail: 'alice@example.com',
        userRole: 'admin',
        companyId: COMPANY_A,
      });

      const db = await getAnalyticsDb(COMPANY_A);
      const rows = await runQuery<Record<string, unknown>>(
        db,
        "SELECT * FROM file_events WHERE event_type = 'created' AND file_id = 10",
        []
      );

      expect(rows).toHaveLength(1);
      const r = rows[0];
      expect(r.event_type).toBe('created');
      expect(r.file_id).toBe(10);
      expect(r.file_type).toBe('question');
      expect(r.file_path).toBe('/org/revenue');
      expect(r.file_name).toBe('Revenue Query');
      expect(r.user_id).toBe(7);
      expect(r.user_email).toBe('alice@example.com');
      expect(r.user_role).toBe('admin');
      expect(r.referenced_by_file_id).toBeNull();
      expect(r.referenced_by_file_type).toBeNull();
      expect(r.timestamp).toBeDefined();
    });

    it('tracks an "updated" event', async () => {
      await trackFileEvent({
        eventType: 'updated',
        fileId: 10,
        fileType: 'question',
        filePath: '/org/revenue',
        fileName: 'Revenue Query (v2)',
        userId: 7,
        userEmail: 'alice@example.com',
        userRole: 'admin',
        companyId: COMPANY_A,
      });

      const db = await getAnalyticsDb(COMPANY_A);
      const rows = await runQuery<Record<string, unknown>>(
        db,
        "SELECT * FROM file_events WHERE event_type = 'updated' AND file_id = 10",
        []
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].file_name).toBe('Revenue Query (v2)');
    });

    it('tracks a "read_direct" event', async () => {
      await trackFileEvent({
        eventType: 'read_direct',
        fileId: 20,
        fileType: 'dashboard',
        filePath: '/org/sales-dash',
        fileName: 'Sales Dashboard',
        userId: 7,
        userEmail: 'alice@example.com',
        userRole: 'admin',
        companyId: COMPANY_A,
      });

      const db = await getAnalyticsDb(COMPANY_A);
      const rows = await runQuery<Record<string, unknown>>(
        db,
        "SELECT * FROM file_events WHERE event_type = 'read_direct' AND file_id = 20",
        []
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].file_type).toBe('dashboard');
    });

    it('tracks a "read_as_reference" event with parent file info', async () => {
      await trackFileEvent({
        eventType: 'read_as_reference',
        fileId: 10,
        fileType: 'question',
        filePath: '/org/revenue',
        fileName: 'Revenue Query',
        userId: 7,
        userEmail: 'alice@example.com',
        userRole: 'admin',
        companyId: COMPANY_A,
        referencedByFileId: 20,
        referencedByFileType: 'dashboard',
      });

      const db = await getAnalyticsDb(COMPANY_A);
      const rows = await runQuery<Record<string, unknown>>(
        db,
        "SELECT * FROM file_events WHERE event_type = 'read_as_reference' AND file_id = 10",
        []
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].referenced_by_file_id).toBe(20);
      expect(rows[0].referenced_by_file_type).toBe('dashboard');
    });

    it('tracks a "deleted" event', async () => {
      await trackFileEvent({
        eventType: 'deleted',
        fileId: 10,
        fileType: 'question',
        filePath: '/org/revenue',
        fileName: 'Revenue Query',
        userId: 7,
        userEmail: 'alice@example.com',
        userRole: 'admin',
        companyId: COMPANY_A,
      });

      const db = await getAnalyticsDb(COMPANY_A);
      // file 10 has accumulated: created → updated → read_as_reference → deleted
      const rows = await runQuery<{ event_type: string }>(
        db,
        "SELECT event_type FROM file_events WHERE file_id = 10 ORDER BY id",
        []
      );
      const types = rows.map(r => r.event_type);
      expect(types).toContain('created');
      expect(types).toContain('updated');
      expect(types).toContain('read_as_reference');
      expect(types).toContain('deleted');
    });
  });

  // ---------------------------------------------------------------------------
  // Optional fields — NULL handling
  // ---------------------------------------------------------------------------

  describe('optional fields', () => {
    it('stores NULL for all optional fields when omitted', async () => {
      await trackFileEvent({
        eventType: 'created',
        fileId: 30,
        companyId: COMPANY_A,
        // No fileType, filePath, fileName, userId, userEmail, userRole, referenced*
      });

      const db = await getAnalyticsDb(COMPANY_A);
      const rows = await runQuery<Record<string, unknown>>(
        db,
        'SELECT * FROM file_events WHERE file_id = 30',
        []
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].file_type).toBeNull();
      expect(rows[0].file_path).toBeNull();
      expect(rows[0].file_name).toBeNull();
      expect(rows[0].user_id).toBeNull();
      expect(rows[0].user_email).toBeNull();
      expect(rows[0].user_role).toBeNull();
      expect(rows[0].referenced_by_file_id).toBeNull();
      expect(rows[0].referenced_by_file_type).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Per-company isolation
  // ---------------------------------------------------------------------------

  describe('per-company isolation', () => {
    it('writes to a separate DuckDB file for each company', async () => {
      await trackFileEvent({
        eventType: 'created',
        fileId: 100,
        fileType: 'folder',
        companyId: COMPANY_B,
      });

      const pathA = path.join(TEST_DIR, `${COMPANY_A}.duckdb`);
      const pathB = path.join(TEST_DIR, `${COMPANY_B}.duckdb`);
      expect(fs.existsSync(pathA)).toBe(true);
      expect(fs.existsSync(pathB)).toBe(true);
      expect(pathA).not.toBe(pathB);
    });

    it("Company B's events are not visible in Company A's DB", async () => {
      const dbA = await getAnalyticsDb(COMPANY_A);
      const rows = await runQuery<{ file_id: number }>(
        dbA,
        'SELECT file_id FROM file_events WHERE file_id = 100',
        []
      );
      // file_id 100 was inserted into COMPANY_B, not COMPANY_A
      expect(rows).toHaveLength(0);
    });

    it("Company B's DB has exactly the one event inserted for it", async () => {
      const dbB = await getAnalyticsDb(COMPANY_B);
      const rows = await runQuery<{ count: bigint }>(
        dbB,
        'SELECT COUNT(*) AS count FROM file_events',
        []
      );
      expect(Number(rows[0].count)).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Aggregate queries — validate OLAP use cases from the plan
  // ---------------------------------------------------------------------------

  describe('aggregate queries', () => {
    it('supports GROUP BY user_email for top-editors ranking', async () => {
      // alice already has several events; add more for a second user
      await trackFileEvent({ eventType: 'updated', fileId: 40, userEmail: 'bob@example.com', companyId: COMPANY_A });
      await trackFileEvent({ eventType: 'updated', fileId: 41, userEmail: 'alice@example.com', companyId: COMPANY_A });
      await trackFileEvent({ eventType: 'updated', fileId: 42, userEmail: 'alice@example.com', companyId: COMPANY_A });

      const db = await getAnalyticsDb(COMPANY_A);
      const rows = await runQuery<{ user_email: string; edit_count: bigint }>(
        db,
        "SELECT user_email, COUNT(*) AS edit_count FROM file_events WHERE event_type = 'updated' AND user_email IS NOT NULL GROUP BY user_email ORDER BY edit_count DESC",
        []
      );

      const alice = rows.find(r => r.user_email === 'alice@example.com');
      const bob = rows.find(r => r.user_email === 'bob@example.com');
      expect(alice).toBeDefined();
      expect(bob).toBeDefined();
      expect(Number(alice!.edit_count)).toBeGreaterThan(Number(bob!.edit_count));
    });

    it('supports DATE_TRUNC for time-series sparklines', async () => {
      const db = await getAnalyticsDb(COMPANY_A);
      const rows = await runQuery<{ day: unknown; events: bigint }>(
        db,
        "SELECT DATE_TRUNC('day', timestamp) AS day, COUNT(*) AS events FROM file_events GROUP BY day ORDER BY day",
        []
      );
      // All events in this test run happened today — should be one bucket
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].events)).toBeGreaterThan(0);
    });

    it('supports COUNT DISTINCT user_email for unique viewers', async () => {
      const db = await getAnalyticsDb(COMPANY_A);
      const rows = await runQuery<{ unique_viewers: bigint }>(
        db,
        "SELECT COUNT(DISTINCT user_email) AS unique_viewers FROM file_events WHERE event_type = 'read_direct'",
        []
      );
      expect(Number(rows[0].unique_viewers)).toBeGreaterThanOrEqual(1);
    });
  });
});
