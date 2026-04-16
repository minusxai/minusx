import { NextRequest } from 'next/server';
import { CompanyDB } from '@/lib/database/company-db';
import { createNewCompany } from '@/lib/database/import-export';
import { CREATE_COMPANY_SECRET, ALLOW_MULTIPLE_COMPANIES } from '@/lib/config';
import { successResponse, ApiErrors, handleApiError } from '@/lib/api/api-responses';
import {
  validateCompanyName,
  validateEmail,
  validatePassword,
  validateFullName,
} from '@/lib/validation/validators';
import { copySeedMxfoodForCompany } from '@/lib/object-store';

interface RegisterRequest {
  companyName: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
  inviteCode?: string;
}

// Table names that exist in the mxfood seed — must match seeds/mxfood/{table}.parquet
const MXFOOD_TABLES = [
  'ad_campaigns', 'ad_spend', 'attribution', 'deliveries', 'drivers',
  'events', 'marketing_channels', 'order_items', 'orders', 'product_categories',
  'product_subcategories', 'products', 'promo_codes', 'promo_usage', 'restaurants',
  'subscription_plans', 'support_tickets', 'user_subscriptions', 'users', 'zones',
];

/**
 * POST /api/companies/register
 * Public endpoint for self-service organisation creation
 */
export async function POST(request: NextRequest) {
  try {
    const body: RegisterRequest = await request.json();

    // Validate all inputs
    const companyNameValidation = validateCompanyName(body.companyName);
    if (!companyNameValidation.valid) {
      return ApiErrors.validationError(companyNameValidation.error!);
    }

    const adminNameValidation = validateFullName(body.adminName);
    if (!adminNameValidation.valid) {
      return ApiErrors.validationError(adminNameValidation.error!);
    }

    const emailValidation = validateEmail(body.adminEmail);
    if (!emailValidation.valid) {
      return ApiErrors.validationError(emailValidation.error!);
    }

    const passwordValidation = validatePassword(body.adminPassword);
    if (!passwordValidation.valid) {
      return ApiErrors.validationError(passwordValidation.error!);
    }

    // Validate invite code if CREATE_COMPANY_SECRET is set
    const companySecret = CREATE_COMPANY_SECRET;
    if (companySecret) {
      if (!body.inviteCode || body.inviteCode !== companySecret) {
        return ApiErrors.forbidden('Invalid or missing invite code');
      }
    }

    // Check if multiple companies are allowed (default: false)
    const allowMultipleCompanies = ALLOW_MULTIPLE_COMPANIES;
    if (!allowMultipleCompanies) {
      const companyCount = await CompanyDB.count();
      if (companyCount > 0) {
        return ApiErrors.forbidden('Multiple companies are not allowed on this instance');
      }
    }

    // Check if company name already exists
    const companyName = body.companyName.trim();
    if (await CompanyDB.nameExists(companyName)) {
      return ApiErrors.conflict('Company name already exists');
    }

    // Generate subdomain from company name
    const subdomain = companyName.toLowerCase().replace(/[^a-z0-9-]/g, '-');

    // Validate subdomain is not empty after sanitization
    if (!subdomain || subdomain.length === 0) {
      return ApiErrors.badRequest('Company name must contain at least one alphanumeric character');
    }

    // Block reserved subdomain prefixes
    if (subdomain.startsWith('mx-')) {
      return ApiErrors.badRequest('Subdomain prefix "mx-" is reserved');
    }

    // Check if subdomain is already taken
    const existingSubdomain = await CompanyDB.getBySubdomain(subdomain);
    if (existingSubdomain) {
      return ApiErrors.conflict('Company subdomain already exists. Please choose a different company name.');
    }

    // Create company with all default resources (ATOMIC)
    try {
      const result = await createNewCompany(
        companyName,
        body.adminName.trim(),
        body.adminEmail.trim(),
        body.adminPassword,
        subdomain
      );

      // Copy mxfood seed Parquet files to the tutorial-mode S3 prefix — best-effort, non-blocking.
      // Seed files must have been uploaded via `cd backend && uv run python scripts/seed_mxfood_to_s3.py`
      // Only tutorial mode is seeded; org/internals start with an empty "static" connection.
      copySeedMxfoodForCompany(result.companyId, 'tutorial', MXFOOD_TABLES).then((copied) => {
        console.log(`[COMPANY_REGISTER] Copied ${copied.length}/${MXFOOD_TABLES.length} mxfood seed tables for company ${result.companyId}`);
      }).catch((err) =>
        console.warn('[COMPANY_REGISTER] mxfood S3 copy failed (non-fatal):', err)
      );

      console.log(`[COMPANY_REGISTER] Created company ${companyName} with ${9} default files`);

      return successResponse(
        {
          companyId: result.companyId,
          companyName,
          subdomain,
          userId: result.userId,
          adminEmail: result.adminEmail,
        },
        201
      );
    } catch (error) {
      console.error('[COMPANY_REGISTER] Failed to create company:', error);

      // Check if it's a duplicate email error
      if (
        error instanceof Error &&
        error.message.toLowerCase().includes('unique')
      ) {
        return ApiErrors.conflict('An account with this email already exists in this company');
      }

      return ApiErrors.internalError('Failed to create company. Please try again.');
    }
  } catch (error) {
    return handleApiError(error);
  }
}
