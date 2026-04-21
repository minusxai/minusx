/**
 * Validation module for database import/export
 * Provides reusable validation functions for init data integrity
 */

import { InitData, ExportedDocument } from './import-export';
import { User } from './user-db';
import { validateFileState } from '@/lib/validation/content-validators';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate that all file references exist and are of correct type
 */
export function validateFileReferences(documents: ExportedDocument[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const docMap = new Map<number, string>();
  for (const doc of documents) {
    docMap.set(doc.id, doc.type);
  }

  for (const doc of documents) {
    const { id, type, content, path } = doc;

    if (content === null) continue;

    if (type === 'dashboard' && 'assets' in content && content.assets) {
      for (const asset of content.assets) {
        if (asset.type === 'question') {
          const refId = asset.id;
          if (!refId) {
            errors.push(`Dashboard '${path}' (ID: ${id}) has question reference without ID`);
            continue;
          }
          if (!docMap.has(refId)) {
            errors.push(`Dashboard '${path}' (ID: ${id}) references non-existent question ID: ${refId}`);
            continue;
          }
          const refType = docMap.get(refId);
          if (refType !== 'question') {
            errors.push(`Dashboard '${path}' (ID: ${id}) references ID ${refId} as question, but it's type '${refType}'`);
          }
        }
      }
    }

    if (type === 'presentation' && 'layout' in content && content.layout?.slides) {
      for (let slideIdx = 0; slideIdx < content.layout.slides.length; slideIdx++) {
        const slide = content.layout.slides[slideIdx];
        if (slide.rectangles) {
          for (const rect of slide.rectangles) {
            const assetId = rect.assetId;
            if (!('assets' in content) || !content.assets || !content.assets.find((a) => a.id === assetId)) {
              warnings.push(`Presentation '${path}' (ID: ${id}) slide ${slideIdx} references non-existent asset: ${assetId}`);
            }
          }
        }
      }
    }

    if (type === 'notebook' && 'assets' in content && content.assets) {
      for (const asset of content.assets) {
        if (asset.type === 'question') {
          const refId = asset.id;
          if (!refId) {
            warnings.push(`Notebook '${path}' (ID: ${id}) has question reference without ID`);
            continue;
          }
          if (!docMap.has(refId)) {
            warnings.push(`Notebook '${path}' (ID: ${id}) references non-existent question ID: ${refId}`);
            continue;
          }
          const refType = docMap.get(refId);
          if (refType !== 'question') {
            warnings.push(`Notebook '${path}' (ID: ${id}) references ID ${refId} as question, but it's type '${refType}'`);
          }
        }
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate that at least one admin user exists
 */
export function validateAdminExists(users: User[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const hasAdmin = users.some(u => u.role === 'admin');
  if (!hasAdmin) {
    errors.push('No admin users found');
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate that all file content is valid
 */
export function validateFileContent(documents: ExportedDocument[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const doc of documents) {
    const { id, type, path, content } = doc;

    if (!content || typeof content !== 'object') {
      errors.push(`${type} '${path}' (ID: ${id}) has invalid content (not an object)`);
      continue;
    }

    const err = validateFileState(doc);
    if (err) errors.push(`${type} '${path}' (ID: ${id}): ${err}`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate basic data structure
 */
export function validateDataStructure(initData: InitData): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const users = initData.users ?? [];
  const documents = initData.documents ?? [];

  if (!Array.isArray(users)) {
    errors.push('Missing or invalid "users" array');
    return { valid: false, errors, warnings };
  }

  if (!Array.isArray(documents)) {
    errors.push('Missing or invalid "documents" array');
    return { valid: false, errors, warnings };
  }

  // Check for duplicate user IDs
  const userIds = new Set<number>();
  for (const user of users) {
    if (userIds.has(user.id)) {
      errors.push(`Duplicate user ID: ${user.id}`);
    }
    userIds.add(user.id);
  }

  // Check for duplicate document IDs
  const docIds = new Set<number>();
  for (const doc of documents) {
    if (docIds.has(doc.id)) {
      errors.push(`Duplicate document ID: ${doc.id}`);
    }
    docIds.add(doc.id);
  }

  // Check for duplicate document paths
  const paths = new Set<string>();
  for (const doc of documents) {
    if (paths.has(doc.path)) {
      errors.push(`Duplicate document path '${doc.path}'`);
    }
    paths.add(doc.path);
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Orchestrate all validation checks.
 * Accepts flat InitData or legacy companies format (flattened transparently).
 */
export function validateInitData(rawData: any): ValidationResult {
  const allErrors: string[] = [];
  const allWarnings: string[] = [];

  if (!rawData.version) {
    allWarnings.push('No version field found, assuming version 0');
  }

  // Normalise legacy companies format to flat
  const initData: InitData = normaliseLegacyFormat(rawData);

  const structureResult = validateDataStructure(initData);
  allErrors.push(...structureResult.errors);
  allWarnings.push(...structureResult.warnings);

  if (structureResult.valid) {
    const docs = initData.documents ?? [];
    const users = initData.users ?? [];

    const contentResult = validateFileContent(docs);
    allErrors.push(...contentResult.errors);
    allWarnings.push(...contentResult.warnings);

    const fileRefResult = validateFileReferences(docs);
    allErrors.push(...fileRefResult.errors);
    allWarnings.push(...fileRefResult.warnings);

    const adminResult = validateAdminExists(users);
    allErrors.push(...adminResult.errors);
    allWarnings.push(...adminResult.warnings);
  }

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings,
  };
}

/**
 * Convert legacy nested format to flat InitData.
 * If already flat, returns as-is.
 */
function normaliseLegacyFormat(data: any): InitData {
  const nested = data.orgs ?? data.companies;
  if (Array.isArray(nested)) {
    const users: User[] = [];
    const documents: ExportedDocument[] = [];
    for (const org of nested) {
      if (Array.isArray(org.users)) users.push(...org.users);
      if (Array.isArray(org.documents)) documents.push(...org.documents);
    }
    return { version: data.version ?? 0, users, documents };
  }
  return data as InitData;
}
