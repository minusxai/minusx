import { PostgresAdapter } from '@/lib/database/adapter/postgres-adapter';

/**
 * PostgreSQL Adapter Integration Tests
 *
 * These tests require a running PostgreSQL database.
 * Set POSTGRES_URL environment variable to run these tests:
 *
 * export POSTGRES_URL=postgresql://postgres:password@localhost:5432/atlas
 * npm test -- postgresAdapter
 *
 * Or use Docker:
 * docker run --name atlas-postgres -e POSTGRES_PASSWORD=password \
 *   -e POSTGRES_DB=atlas -p 5432:5432 -d postgres:16
 */

const hasPostgresConfig = process.env.POSTGRES_URL && process.env.POSTGRES_URL !== '';

// Skip tests if PostgreSQL is not configured
const describePostgres = hasPostgresConfig ? describe : describe.skip;

describePostgres('PostgresAdapter', () => {
  let adapter: PostgresAdapter;

  beforeEach(() => {
    adapter = new PostgresAdapter(process.env.POSTGRES_URL);
  });

  afterEach(async () => {
    await adapter.close();
  });

  describe('Basic Connection', () => {
    it('should connect and execute simple query', async () => {
      const result = await adapter.query<{ now: string }>('SELECT NOW() as now');

      expect(result).toBeDefined();
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toHaveProperty('now');
      expect(result.rowCount).toBe(1);
    });

    it('should handle parameterized queries with $1, $2 syntax', async () => {
      const result = await adapter.query<{ sum: number }>(
        'SELECT $1::int + $2::int as sum',
        [5, 10]
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].sum).toBe(15);
    });
  });

  describe('CRUD Operations', () => {
    beforeEach(async () => {
      // Create test table
      await adapter.exec(`
        CREATE TABLE IF NOT EXISTS test_users (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT NOT NULL
        )
      `);

      // Clean up any existing data
      await adapter.exec('TRUNCATE TABLE test_users RESTART IDENTITY');
    });

    afterEach(async () => {
      // Clean up test table
      await adapter.exec('DROP TABLE IF EXISTS test_users');
    });

    it('should insert and select data', async () => {
      // Insert
      const insertResult = await adapter.query(
        'INSERT INTO test_users (name, email) VALUES ($1, $2) RETURNING id',
        ['John Doe', 'john@example.com']
      );

      expect(insertResult.rowCount).toBe(1);
      expect(insertResult.rows[0]).toHaveProperty('id');

      // Select
      const selectResult = await adapter.query<{ name: string; email: string }>(
        'SELECT name, email FROM test_users WHERE name = $1',
        ['John Doe']
      );

      expect(selectResult.rows).toHaveLength(1);
      expect(selectResult.rows[0].name).toBe('John Doe');
      expect(selectResult.rows[0].email).toBe('john@example.com');
    });

    it('should update data', async () => {
      // Insert
      await adapter.query(
        'INSERT INTO test_users (name, email) VALUES ($1, $2)',
        ['Jane Doe', 'jane@example.com']
      );

      // Update
      const updateResult = await adapter.query(
        'UPDATE test_users SET email = $1 WHERE name = $2',
        ['jane.doe@example.com', 'Jane Doe']
      );

      expect(updateResult.rowCount).toBe(1);

      // Verify
      const selectResult = await adapter.query<{ email: string }>(
        'SELECT email FROM test_users WHERE name = $1',
        ['Jane Doe']
      );

      expect(selectResult.rows[0].email).toBe('jane.doe@example.com');
    });

    it('should delete data', async () => {
      // Insert
      await adapter.query(
        'INSERT INTO test_users (name, email) VALUES ($1, $2)',
        ['Bob Smith', 'bob@example.com']
      );

      // Delete
      const deleteResult = await adapter.query(
        'DELETE FROM test_users WHERE name = $1',
        ['Bob Smith']
      );

      expect(deleteResult.rowCount).toBe(1);

      // Verify
      const selectResult = await adapter.query(
        'SELECT * FROM test_users WHERE name = $1',
        ['Bob Smith']
      );

      expect(selectResult.rows).toHaveLength(0);
    });
  });

  describe('Transactions', () => {
    beforeEach(async () => {
      await adapter.exec(`
        CREATE TABLE IF NOT EXISTS test_accounts (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          balance DECIMAL(10,2) NOT NULL
        )
      `);

      await adapter.exec('TRUNCATE TABLE test_accounts RESTART IDENTITY');
    });

    afterEach(async () => {
      await adapter.exec('DROP TABLE IF EXISTS test_accounts');
    });

    it('should commit successful transactions', async () => {
      await adapter.transaction(async (tx) => {
        await tx.query(
          'INSERT INTO test_accounts (name, balance) VALUES ($1, $2)',
          ['Alice', 100]
        );
        await tx.query(
          'INSERT INTO test_accounts (name, balance) VALUES ($1, $2)',
          ['Bob', 200]
        );
      });

      // Verify both inserts committed
      const result = await adapter.query('SELECT COUNT(*) as count FROM test_accounts');
      expect(result.rows[0].count).toBe('2');
    });

    it('should rollback failed transactions', async () => {
      try {
        await adapter.transaction(async (tx) => {
          await tx.query(
            'INSERT INTO test_accounts (name, balance) VALUES ($1, $2)',
            ['Charlie', 300]
          );

          // Simulate error
          throw new Error('Transaction failed');
        });
      } catch (error) {
        expect((error as Error).message).toBe('Transaction failed');
      }

      // Verify rollback - no data should be inserted
      const result = await adapter.query('SELECT COUNT(*) as count FROM test_accounts');
      expect(result.rows[0].count).toBe('0');
    });

    it('should handle database errors with rollback', async () => {
      await expect(
        adapter.transaction(async (tx) => {
          await tx.query(
            'INSERT INTO test_accounts (name, balance) VALUES ($1, $2)',
            ['Dave', 400]
          );

          // Invalid SQL - should trigger rollback
          await tx.query('INVALID SQL STATEMENT');
        })
      ).rejects.toThrow();

      // Verify rollback
      const result = await adapter.query('SELECT COUNT(*) as count FROM test_accounts');
      expect(result.rows[0].count).toBe('0');
    });
  });

  describe('Connection Management', () => {
    it('should handle multiple queries with connection pooling', async () => {
      const queries = Array.from({ length: 10 }, (_, i) =>
        adapter.query<{ num: number }>('SELECT $1::int as num', [i])
      );

      const results = await Promise.all(queries);

      expect(results).toHaveLength(10);
      results.forEach((result, i) => {
        expect(result.rows[0].num).toBe(i);
      });
    });

    it('should close connection pool', async () => {
      await adapter.query('SELECT 1');
      await adapter.close();

      // After close, pool is null and will be recreated on next query (lazy initialization)
      // This is expected behavior - verify new query works (creates new pool)
      const result = await adapter.query('SELECT 1 as num');
      expect(result.rows[0].num).toBe(1);

      // Clean up
      await adapter.close();
    });
  });
});

// Additional test for when PostgreSQL is not configured
describe('PostgresAdapter (no config)', () => {
  it('should use default connection string when not provided', () => {
    const adapter = new PostgresAdapter();
    expect(adapter).toBeDefined();
    // Don't actually connect - just verify constructor works
  });
});
