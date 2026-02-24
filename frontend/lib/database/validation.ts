/**
 * Validation module for database import/export
 * Provides reusable validation functions for init data integrity
 */

import { InitData, ExportedDocument, CompanyData } from './import-export';
import { Company } from './company-db';
import { User } from './user-db';
import { validateFileState } from '@/lib/validation/content-validators';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate that all file references exist and are of correct type
 * Checks dashboard assets, presentations, notebooks, etc.
 */
export function validateFileReferences(documents: ExportedDocument[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Build a map of document IDs to types for quick lookup
  // NOTE: This function is now called per-company, so IDs are unique within the documents array
  const docMap = new Map<number, string>();
  for (const doc of documents) {
    docMap.set(doc.id, doc.type);
  }

  // Check each document for file references
  for (const doc of documents) {
    const { id, type, content, path } = doc;

    // Skip if content is null (metadata-only load)
    if (content === null) {
      continue;
    }

    // Dashboards: validate question references
    if (type === 'dashboard' && 'assets' in content && content.assets) {
      for (const asset of content.assets) {
        // File references have type='question' and id field
        if (asset.type === 'question') {
          const refId = asset.id;

          if (!refId) {
            errors.push(
              `Dashboard '${path}' (ID: ${id}) has question reference without ID`
            );
            continue;
          }

          // Check if referenced document exists
          if (!docMap.has(refId)) {
            errors.push(
              `Dashboard '${path}' (ID: ${id}) references non-existent question ID: ${refId}`
            );
            continue;
          }

          // Check if referenced document is actually a question
          const refType = docMap.get(refId);
          if (refType !== 'question') {
            errors.push(
              `Dashboard '${path}' (ID: ${id}) references ID ${refId} as question, but it's type '${refType}'`
            );
          }
        }
      }
    }

    // Presentations: validate rectangle assetId references
    if (type === 'presentation' && 'layout' in content && content.layout?.slides) {
      for (let slideIdx = 0; slideIdx < content.layout.slides.length; slideIdx++) {
        const slide = content.layout.slides[slideIdx];

        if (slide.rectangles) {
          for (const rect of slide.rectangles) {
            const assetId = rect.assetId;

            // Check if asset exists in content.assets
            if (!('assets' in content) || !content.assets || !content.assets.find((a) => a.id === assetId)) {
              warnings.push(
                `Presentation '${path}' (ID: ${id}) slide ${slideIdx} references non-existent asset: ${assetId}`
              );
            }
          }
        }
      }
    }

    // Notebooks: validate assets if they have file references (future)
    if (type === 'notebook' && 'assets' in content && content.assets) {
      for (const asset of content.assets) {
        if (asset.type === 'question') {
          const refId = asset.id;

          if (!refId) {
            warnings.push(
              `Notebook '${path}' (ID: ${id}) has question reference without ID`
            );
            continue;
          }

          if (!docMap.has(refId)) {
            warnings.push(
              `Notebook '${path}' (ID: ${id}) references non-existent question ID: ${refId}`
            );
            continue;
          }

          const refType = docMap.get(refId);
          if (refType !== 'question') {
            warnings.push(
              `Notebook '${path}' (ID: ${id}) references ID ${refId} as question, but it's type '${refType}'`
            );
          }
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Validate that each company has at least one admin user
 */
export function validateCompanyAdmins(users: User[], companies: Company[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Build map of company_id -> admin count
  const adminCounts = new Map<number, number>();

  for (const company of companies) {
    adminCounts.set(company.id, 0);
  }

  for (const user of users) {
    if (user.role === 'admin') {
      const count = adminCounts.get(user.company_id) || 0;
      adminCounts.set(user.company_id, count + 1);
    }
  }

  // Check each company has at least one admin
  for (const company of companies) {
    const adminCount = adminCounts.get(company.id) || 0;

    if (adminCount === 0) {
      errors.push(
        `Company '${company.name}' (ID: ${company.id}) has no admin users`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Validate that each company has at least one connection
 */
export function validateCompanyConnections(documents: ExportedDocument[], companies: Company[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Build map of company_id -> connection count
  const connectionCounts = new Map<number, number>();

  for (const company of companies) {
    connectionCounts.set(company.id, 0);
  }

  for (const doc of documents) {
    if (doc.type === 'connection') {
      const count = connectionCounts.get(doc.company_id) || 0;
      connectionCounts.set(doc.company_id, count + 1);
    }
  }

  // Check each company has at least one connection
  for (const company of companies) {
    const connectionCount = connectionCounts.get(company.id) || 0;

    if (connectionCount === 0) {
      errors.push(
        `Company '${company.name}' (ID: ${company.id}) has no database connections`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Validate that all file content is valid
 * Note: content.name is no longer required (removed in v8 - metadata decoupling)
 */
export function validateFileContent(documents: ExportedDocument[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const doc of documents) {
    const { id, type, path, content } = doc;

    // Content must be an object
    if (!content || typeof content !== 'object') {
      errors.push(`${type} '${path}' (ID: ${id}) has invalid content (not an object)`);
      continue;
    }

    // Schema validation for known file types
    const err = validateFileState(doc);
    if (err) errors.push(`${type} '${path}' (ID: ${id}): ${err}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Validate basic data structure and requirements
 */
export function validateDataStructure(initData: InitData): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate nested structure
  if (!Array.isArray(initData.companies)) {
    errors.push('Missing or invalid "companies" array');
    return { valid: false, errors, warnings };
  }

    // Check for duplicate company IDs
    const companyIds = new Set<number>();
    const allUsers: User[] = [];
    const allDocuments: ExportedDocument[] = [];

    for (const companyData of initData.companies as CompanyData[]) {

      if (companyIds.has(companyData.id)) {
        errors.push(`Duplicate company ID: ${companyData.id}`);
      }
      companyIds.add(companyData.id);

      // Validate company structure
      if (!companyData.name) {
        errors.push(`Company ${companyData.id} missing name`);
      }

      if (!Array.isArray(companyData.users)) {
        errors.push(`Company ${companyData.id} users must be an array`);
      } else {
        allUsers.push(...companyData.users);
      }

      if (!Array.isArray(companyData.documents)) {
        errors.push(`Company ${companyData.id} documents must be an array`);
      } else {
        allDocuments.push(...companyData.documents);
      }

      // Check for duplicate user IDs within company
      const userIds = new Set<number>();
      for (const user of companyData.users || []) {
        if (userIds.has(user.id)) {
          errors.push(`Duplicate user ID: ${user.id} in company ${companyData.id}`);
        }
        userIds.add(user.id);
      }

      // Check for duplicate document IDs within company
      const docIds = new Set<number>();
      for (const doc of companyData.documents || []) {
        if (docIds.has(doc.id)) {
          errors.push(`Duplicate document ID: ${doc.id} in company ${companyData.id}`);
        }
        docIds.add(doc.id);
      }

      // Check for duplicate document paths within company
      const paths = new Set<string>();
      for (const doc of companyData.documents || []) {
        if (paths.has(doc.path)) {
          errors.push(`Duplicate document path '${doc.path}' in company ${companyData.id}`);
        }
        paths.add(doc.path);
      }
    }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Orchestrate all validation checks
 * Collects ALL errors before failing (per user preference)
 */
export function validateInitData(initData: InitData): ValidationResult {
  const allErrors: string[] = [];
  const allWarnings: string[] = [];

  // Validate version (add warning if missing)
  if (!initData.version) {
    allWarnings.push('No version field found, assuming version 0');
  }

  // Run all validations (collect all errors)
  const structureResult = validateDataStructure(initData);
  allErrors.push(...structureResult.errors);
  allWarnings.push(...structureResult.warnings);

  // Only run dependent validations if structure is valid
  if (structureResult.valid) {
    // Extract flat arrays from nested structure for validators
    const companies: Company[] = [];
    const users: User[] = [];
    const documents: ExportedDocument[] = [];

    for (const companyData of initData.companies as CompanyData[]) {
      companies.push({
        id: companyData.id,
        name: companyData.name,
        display_name: companyData.display_name,
        subdomain: companyData.subdomain,
        created_at: companyData.created_at,
        updated_at: companyData.updated_at
      });

      users.push(...companyData.users);
      documents.push(...companyData.documents);
    }

    const contentResult = validateFileContent(documents);
    allErrors.push(...contentResult.errors);
    allWarnings.push(...contentResult.warnings);

    // Validate file references per-company instead of flattening (Phase 6 fix)
    for (const companyData of initData.companies as CompanyData[]) {
      const fileRefResult = validateFileReferences(companyData.documents);
      allErrors.push(...fileRefResult.errors);
      allWarnings.push(...fileRefResult.warnings);
    }

    const adminResult = validateCompanyAdmins(users, companies);
    allErrors.push(...adminResult.errors);
    allWarnings.push(...adminResult.warnings);

    const connectionResult = validateCompanyConnections(documents, companies);
    allErrors.push(...connectionResult.errors);
    allWarnings.push(...connectionResult.warnings);
  }

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings
  };
}
