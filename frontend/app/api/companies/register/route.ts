import { NextRequest } from 'next/server';
import { CompanyDB } from '@/lib/database/company-db';
import { createNewCompany } from '@/lib/database/import-export';
import { successResponse, ApiErrors, handleApiError } from '@/lib/api/api-responses';
import {
  validateCompanyName,
  validateEmail,
  validatePassword,
  validateFullName,
} from '@/lib/validation/validators';

interface RegisterRequest {
  companyName: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
  inviteCode?: string;
}

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
    const companySecret = process.env.CREATE_COMPANY_SECRET;
    if (companySecret) {
      if (!body.inviteCode || body.inviteCode !== companySecret) {
        return ApiErrors.forbidden('Invalid or missing invite code');
      }
    }

    // Check if multiple companies are allowed (default: false)
    const allowMultipleCompanies = process.env.ALLOW_MULTIPLE_COMPANIES === 'true';
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
