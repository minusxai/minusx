import { searchFiles } from '../file-search';
import {
  DbFile,
  FileType,
  QuestionContent,
  DocumentContent,
  ConnectionContent
} from '@/lib/types';

// Helper to create mock question files
function createMockQuestion(
  id: number,
  name: string,
  path: string,
  content: QuestionContent
): DbFile {
  return {
    id,
    name,
    path,
    type: 'question',
    references: [],  // Phase 6: Questions have no references
    content,
    company_id: 1,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z'
  };
}

// Helper to create mock dashboard files
function createMockDashboard(
  id: number,
  name: string,
  path: string,
  content: DocumentContent
): DbFile {
  return {
    id,
    name,
    path,
    type: 'dashboard',
    references: [],  // Phase 6: References extracted from content.assets
    content,
    company_id: 1,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z'
  };
}

// Helper to create mock connection files
function createMockConnection(
  id: number,
  name: string,
  path: string,
  content: ConnectionContent
): DbFile {
  return {
    id,
    name,
    path,
    type: 'connection',
    references: [],  // Phase 6: Connections have no references
    content,
    company_id: 1,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z'
  };
}

describe('searchFiles - Integration Tests', () => {
  it('should rank files by relevance with field weighting and return snippets', () => {
    // Create a realistic set of files with varying degrees of match
    const files = [
      createMockQuestion(1, 'User Address Report', '/reports/user-address', {
        query: 'SELECT * FROM users',
        description: 'Shows user data',
        vizSettings: { type: 'table' },
        parameters: [],
        database_name: 'default'
      }),
      createMockQuestion(2, 'Sales Report', '/reports/sales', {
        query: 'SELECT user_id, address, email FROM UserAddress ua JOIN users u ON ua.user_id = u.id',
        description: 'Revenue by user address',
        vizSettings: { type: 'table' },
        parameters: [],
        database_name: 'default'
      }),
      createMockQuestion(3, 'Address Book', '/reports/address', {
        query: 'SELECT * FROM locations',
        description: 'Location addresses',
        vizSettings: { type: 'table' },
        parameters: [],
        database_name: 'default'
      }),
      createMockDashboard(4, 'Revenue Dashboard', '/dashboards/revenue', {
        description: 'User address analysis and metrics',
        assets: [
          { type: 'text', content: 'Analysis of user address distribution', id: 'text-1' },
          { type: 'question', id: 1 }
        ],
        layout: []
      })
    ];

    const results = searchFiles(files, 'user address');

    // Should return all matching files
    expect(results.length).toBeGreaterThan(0);

    // File 1 should rank highest (exact match in name, weight 3x)
    expect(results[0].id).toBe(1);
    expect(results[0].name).toBe('User Address Report');
    expect(results[0].score).toBeGreaterThan(0);
    expect(results[0].score).toBeLessThanOrEqual(1);

    // Should have match count
    expect(results[0].matchCount).toBeGreaterThan(0);

    // Should include relevant snippets with context
    expect(results[0].relevantResults.length).toBeGreaterThan(0);
    const nameSnippet = results[0].relevantResults.find(r => r.field === 'name');
    expect(nameSnippet).toBeDefined();
    expect(nameSnippet!.snippet).toContain('User Address');

    // File 2 should have SQL query snippet showing WHERE the match occurred
    const file2 = results.find(r => r.id === 2);
    expect(file2).toBeDefined();
    const querySnippet = file2!.relevantResults.find(r => r.field === 'query');
    expect(querySnippet).toBeDefined();
    expect(querySnippet!.snippet).toContain('address');
    expect(querySnippet!.matchType).toBe('partial'); // "address" is substring match

    // Dashboard should be included and searchable
    const dashboard = results.find(r => r.type === 'dashboard');
    expect(dashboard).toBeDefined();
    expect(dashboard!.matchCount).toBeGreaterThan(0);
  });

  it('should handle edge cases: empty query, special characters, and no matches', () => {
    const files = [
      createMockQuestion(1, 'Sales Query', '/queries/sales', {
        query: 'SELECT SUM(amount) FROM orders WHERE status = "completed" AND email LIKE "%@example.com"',
        description: 'Total sales with filters',
        vizSettings: { type: 'bar', xCols: ['date'], yCols: ['amount'] },
        parameters: [],
        database_name: 'default'
      }),
      createMockQuestion(2, 'User Report', '/reports/user', {
        query: 'SELECT * FROM users WHERE name != "test"',
        description: 'User data',
        vizSettings: { type: 'table' },
        parameters: [],
        database_name: 'default'
      })
    ];

    // Test 1: Empty query returns all files with score 0
    const emptyResults = searchFiles(files, '');
    expect(emptyResults).toHaveLength(2);
    expect(emptyResults[0].score).toBe(0);
    expect(emptyResults[0].matchCount).toBe(0);
    expect(emptyResults[0].relevantResults).toEqual([]);

    // Test 2: Special regex characters are handled safely
    const specialCharResults = searchFiles(files, '%@example.com');
    expect(specialCharResults).toHaveLength(1);
    expect(specialCharResults[0].id).toBe(1);
    expect(specialCharResults[0].matchCount).toBeGreaterThan(0);

    // Test 3: Search with parentheses
    const parenResults = searchFiles(files, 'SUM(amount)');
    expect(parenResults).toHaveLength(1);
    expect(parenResults[0].relevantResults[0].snippet).toContain('SUM(amount)');

    // Test 4: No matches returns empty array
    const noMatchResults = searchFiles(files, 'nonexistent_keyword_xyz123');
    expect(noMatchResults).toHaveLength(0);

    // Test 5: Case insensitive search
    const upperResults = searchFiles(files, 'USER');
    const lowerResults = searchFiles(files, 'user');
    expect(upperResults.length).toBe(lowerResults.length);
    if (upperResults.length > 0) {
      expect(upperResults[0].score).toBe(lowerResults[0].score);
    }
  });

  it('should search across multiple file types with proper filtering and snippet limits', () => {
    const files = [
      // Question with revenue in name (highest weight)
      createMockQuestion(1, 'Revenue Analysis', '/reports/revenue', {
        query: 'SELECT * FROM sales',
        description: 'Shows sales data',
        vizSettings: { type: 'line', xCols: ['date'], yCols: ['revenue'] },
        parameters: [],
        database_name: 'default'
      }),
      // Question with revenue in query and description (lower weight)
      createMockQuestion(2, 'Sales Report', '/reports/sales', {
        query: 'SELECT revenue, cost FROM orders',
        description: 'Revenue and cost analysis',
        vizSettings: { type: 'bar', xCols: ['category'], yCols: ['revenue', 'cost'] },
        parameters: [],
        database_name: 'default'
      }),
      // Dashboard with revenue in multiple places
      createMockDashboard(3, 'Revenue Dashboard', '/dashboards/revenue', {
        description: 'Overview of revenue metrics',
        assets: [
          { type: 'text', content: 'Revenue targets and actuals', id: 'text-1' },
          { type: 'text', content: 'Additional revenue notes', id: 'text-2' },
          { type: 'question', id: 1 },
          { type: 'text', content: 'More revenue analysis', id: 'text-3' }
        ],
        layout: [
          { i: 'text-1', x: 0, y: 0, w: 6, h: 2 },
          { i: 'question-1', x: 6, y: 0, w: 6, h: 4 },
          { i: 'text-2', x: 0, y: 2, w: 6, h: 2 }
        ]
      }),
      // Unsupported file type should be skipped
      createMockConnection(4, 'Revenue Connection', '/connections/revenue', {
        type: 'duckdb',
        config: {
          file_path: 'revenue_db.duckdb'
        }
      }),
      // File with many matches (test snippet limiting)
      createMockQuestion(5, 'Revenue Revenue Revenue', '/test', {
        query: 'revenue revenue revenue revenue revenue revenue',
        description: 'revenue revenue revenue revenue',
        vizSettings: { type: 'table' },
        parameters: [],
        database_name: 'default'
      })
    ];

    const results = searchFiles(files, 'revenue');

    // Should only include supported searchable file types (question, dashboard, folder, connection, context)
    const supportedTypes = ['question', 'dashboard', 'folder', 'connection', 'context'];
    expect(results.every(r => supportedTypes.includes(r.type))).toBe(true);

    // Should include both questions and dashboards
    const questionResults = results.filter(r => r.type === 'question');
    const dashboardResults = results.filter(r => r.type === 'dashboard');
    expect(questionResults.length).toBeGreaterThan(0);
    expect(dashboardResults.length).toBeGreaterThan(0);

    // File 5 should rank highest (many matches across all fields)
    // File 5: 3 in name (45pts) + 4 in description (40pts) + 6 in query (30pts) = 115pts
    expect(results[0].name).toBe('Revenue Revenue Revenue');
    expect(results[0].id).toBe(5);
    expect(results[0].matchCount).toBeGreaterThan(10); // 13 total matches

    // File 5 with many matches should have limited snippets
    // Should limit snippets (max 2 per field * 3 fields)
    expect(results[0].relevantResults.length).toBeLessThanOrEqual(6);

    // File 3 should rank second (dashboard with matches in name + description + assets)
    // File 3: 1 in name (15pts) + 1 in description (10pts) + 3 in assets (15pts) = 40pts
    // File 1: 1 in name (15pts) = 15pts
    expect(results[1].name).toBe('Revenue Dashboard');
    expect(results[1].id).toBe(3);

    // Dashboard should have searched text assets
    const dashboard = results.find(r => r.type === 'dashboard');
    expect(dashboard).toBeDefined();
    const assetSnippet = dashboard!.relevantResults.find(r => r.field === 'asset_names');
    if (assetSnippet) {
      expect(assetSnippet.snippet).toContain('revenue');
    }

    // Verify all results have required metadata
    results.forEach(result => {
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('path');
      expect(result).toHaveProperty('type');
      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('matchCount');
      expect(result).toHaveProperty('relevantResults');
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
    });
  });
});
