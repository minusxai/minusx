import { describe, expect, it } from 'vitest';
import { syncParametersWithSQL } from '../sql-params';

describe('syncParametersWithSQL identity', () => {
  it('returns the existing array when the SQL parameter declarations did not change', () => {
    const empty: never[] = [];
    expect(syncParametersWithSQL('SELECT 1', empty)).toBe(empty);

    const configured = [{ name: 'min_score', type: 'number' as const, label: 'Minimum score' }];
    expect(syncParametersWithSQL('SELECT * FROM posts WHERE score >= :min_score', configured)).toBe(configured);
  });
});
