/**
 * Files Data Layer Tests
 * Tests file template generation functionality
 *
 * Run: npm test -- files.test.ts
 */

import { FilesAPI } from '@/lib/data/files.server';
import { DocumentDB } from '@/lib/database/documents-db';
import {
  initTestDatabase,
  cleanupTestDatabase,
  getTestDbPath
} from '@/store/__tests__/test-utils';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import type {
  QuestionContent,
  DocumentContent,
  ConnectionContent,
  ContextContent
} from '@/lib/types';
import * as pythonBackend from '@/lib/backend/python-backend.server';

// Database-specific mock
jest.mock('@/lib/database/db-config', () => ({
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

const TEST_DB_PATH = getTestDbPath('files');

// Mock Python backend
const mockGetSchemaFromPython = jest.spyOn(pythonBackend, 'getSchemaFromPython');

// Test user
const testUser: EffectiveUser = {
  userId: 1,
  name: 'Test User',
  email: 'test@example.com',
  role: 'admin',
  mode: 'org',
  home_folder: ''
};

describe('Files Data Layer - getTemplate', () => {
  let duckdbConnectionId: number;

  beforeAll(async () => {
    await initTestDatabase(TEST_DB_PATH);

    // Mock schema introspection
    mockGetSchemaFromPython.mockResolvedValue({
      schemas: [
        {
          name: 'main',
          tables: [
            {
              name: 'users',
              columns: [
                { name: 'id', type: 'INTEGER', nullable: false },
                { name: 'email', type: 'VARCHAR', nullable: false }
              ]
            }
          ]
        }
      ]
    });

    // Create custom_db first so it has an earlier updated_at (ORDER BY updated_at DESC)
    await DocumentDB.create(
      'custom_db',
      '/org/database/custom_db',
      'connection',
      {
        type: 'duckdb',
        config: {
          file_path: 'data/custom_db.duckdb'
        }
      } as ConnectionContent,
      []
    );

    // Create default_db last so it sorts first (most recent updated_at DESC)
    duckdbConnectionId = await DocumentDB.create(
      'default_db',
      '/org/database/default_db',
      'connection',
      {
        type: 'duckdb',
        config: {
          file_path: 'data/default_db.duckdb'
        }
      } as ConnectionContent,
      []
    );
  });

  afterAll(async () => {
    await cleanupTestDatabase(TEST_DB_PATH);
  });

  describe('question template', () => {
    it('should generate question template with default database', async () => {
      const result = await FilesAPI.getTemplate('question', {}, testUser);

      expect(result.fileName).toBe('');
      expect(result.content).toMatchObject({
        description: '',
        query: '',
        vizSettings: { type: 'table' },
        parameters: [],
        connection_name: 'static'
      });
      expect(result.metadata?.availableDatabases).toContain('static');
    });

    it('should generate question template with custom query', async () => {
      const result = await FilesAPI.getTemplate(
        'question',
        { query: 'SELECT * FROM users' },
        testUser
      );

      const content = result.content as QuestionContent;
      expect(content.query).toBe('SELECT * FROM users');
    });

    it('should generate question template with specified database', async () => {
      const result = await FilesAPI.getTemplate(
        'question',
        { databaseName: 'custom_db' },
        testUser
      );

      const content = result.content as QuestionContent;
      expect(content.connection_name).toBe('custom_db');
    });
  });

  describe('dashboard template', () => {
    it('should generate empty dashboard template', async () => {
      const result = await FilesAPI.getTemplate('dashboard', {}, testUser);

      expect(result.fileName).toBe('');
      expect(result.content).toMatchObject({
        description: '',
        assets: [],
        layout: {
          columns: 12,
          items: []
        }
      });
    });
  });

  describe('presentation template', () => {
    it('should generate presentation template with default slide', async () => {
      const result = await FilesAPI.getTemplate('presentation', {}, testUser);

      expect(result.fileName).toBe('');
      const content = result.content as DocumentContent;
      expect(content.description).toBe('');
      expect(content.assets).toEqual([]);
      expect(content.layout).toMatchObject({
        canvasWidth: 1280,
        canvasHeight: 720,
        slides: [{ rectangles: [], arrows: [] }]
      });
    });
  });

  describe('connection template', () => {
    it('should generate connection template', async () => {
      const result = await FilesAPI.getTemplate('connection', {}, testUser);

      expect(result.fileName).toBe('');
      expect(result.content).toMatchObject({
        type: 'bigquery',
        config: {}
      });
    });
  });

  describe('folder template', () => {
    it('should generate folder template', async () => {
      const result = await FilesAPI.getTemplate('folder', {}, testUser);

      expect(result.fileName).toBe('New Folder');
      expect(result.content).toMatchObject({
        description: ''
      });
    });
  });

  describe('context template', () => {
    beforeAll(async () => {
      // Upsert /org/context with test-specific data (template seed already creates it with whitelist:'*')
      const testContextContent: ContextContent = {
        versions: [{
          version: 1,
          whitelist: [{
            name: 'default_db',
            type: 'connection',
            children: [{
              name: 'main',
              type: 'schema',
              children: [{ name: 'users', type: 'table' }]
            }]
          }],
          docs: [{ content: 'Root documentation' }],
          createdAt: new Date().toISOString(),
          createdBy: testUser.userId,
          description: 'Root context'
        }],
        published: { all: 1 },
        fullSchema: [],
        fullDocs: []
      };
      const existing = await DocumentDB.getByPath('/org/context');
      if (existing) {
        await DocumentDB.update(existing.id, 'context', '/org/context', testContextContent, [], 'test-edit');
      } else {
        await DocumentDB.create('context', '/org/context', 'context', testContextContent, []);
      }
    });

    it('should generate root context template with schema from connections', async () => {
      const result = await FilesAPI.getTemplate(
        'context',
        { path: '/org' },
        testUser
      );

      expect(result.fileName).toBe('Knowledge Base');
      const content = result.content as ContextContent;

      expect(content.versions).toHaveLength(1);
      expect(content.versions![0]).toMatchObject({
        version: 1,
        whitelist: '*',
        docs: [],
        description: 'Initial version'
      });
      expect(content.published).toEqual({ all: 1 });

      // Root context should have fullSchema from connections
      expect(content.fullSchema!.length).toBeGreaterThanOrEqual(1);
      expect(content.fullSchema!.some(s => s.databaseName === 'default_db')).toBe(true);
      expect(content.fullDocs).toEqual([]);
    });

    it('should generate child context template with inherited schema', async () => {
      const result = await FilesAPI.getTemplate(
        'context',
        { path: '/org/sales' },
        testUser
      );

      expect(result.fileName).toBe('Knowledge Base');
      const content = result.content as ContextContent;

      expect(content.versions).toHaveLength(1);
      expect(content.versions![0]).toMatchObject({
        version: 1,
        whitelist: '*',
        docs: [],
        description: 'Initial version'
      });

      // Child context should inherit from parent (filtered by parent's whitelist)
      expect(content.fullSchema).toBeDefined();
      expect(content.fullDocs).toEqual([{ content: 'Root documentation' }]);
    });
  });

  describe('error handling', () => {
    it('should throw error for unsupported file type', async () => {
      await expect(
        FilesAPI.getTemplate('config' as any, {}, testUser)
      ).rejects.toThrow('Unsupported template type: config');
    });
  });
});
