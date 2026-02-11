/**
 * API client for document management
 * Communicates with Next.js API routes for CRUD operations
 */
import { DbFile } from '../types';

const API_BASE = '';  // Same origin, Next.js API routes

export default class DocumentAPI {
  /**
   * List all documents, optionally filtered by type
   */
  static async listAll(typeFilter?: string): Promise<DbFile[]> {
    const url = typeFilter
      ? `${API_BASE}/api/documents?type=${typeFilter}`
      : `${API_BASE}/api/documents`;

    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch documents');
    const data = await res.json();
    // Support both new format {success, data: {documents}} and legacy {documents}
    return data.data?.documents || data.documents || data.data || data;
  }

  /**
   * Get a document by its ID (UUID)
   */
  static async getById(id: string): Promise<DbFile> {
    const res = await fetch(`${API_BASE}/api/documents/${id}`);
    if (!res.ok) throw new Error('Document not found');
    const data = await res.json();
    return data.data || data; // Support both new and legacy format
  }

  /**
   * Create a new document
   */
  static async create(data: {
    name: string;
    path: string;
    type: string;
    content: any;
  }): Promise<{ id: string; path: string }> {
    const res = await fetch(`${API_BASE}/api/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Failed to create document');
    const json = await res.json();
    return json.data || json; // Support both new and legacy format
  }

  /**
   * Update a document's name and content
   */
  static async update(id: string, data: {
    name: string;
    content: any;
  }): Promise<{ success: boolean }> {
    const res = await fetch(`${API_BASE}/api/documents/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Failed to update document');
    const json = await res.json();
    // If it has success field, return as-is; otherwise wrap it
    return json.success !== undefined ? json : { success: true };
  }

  /**
   * Delete a document by ID
   */
  static async delete(id: string): Promise<{ success: boolean }> {
    const res = await fetch(`${API_BASE}/api/documents/${id}`, {
      method: 'DELETE'
    });
    if (!res.ok) throw new Error('Failed to delete document');
    const json = await res.json();
    // If it has success field, return as-is; otherwise wrap it
    return json.success !== undefined ? json : { success: true };
  }
}
