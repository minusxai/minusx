import { NextRequest } from 'next/server';
import { getModules } from '@/lib/modules/registry';
import { successResponse, ApiErrors, handleApiError } from '@/lib/api/api-responses';
import {
  validateWorkspaceName,
  validateEmail,
  validatePassword,
  validateFullName,
} from '@/lib/validation/validators';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const nameVal = validateWorkspaceName(body.workspaceName);
    if (!nameVal.valid) return ApiErrors.validationError(nameVal.error!);

    const adminNameVal = validateFullName(body.adminName);
    if (!adminNameVal.valid) return ApiErrors.validationError(adminNameVal.error!);

    const emailVal = validateEmail(body.adminEmail);
    if (!emailVal.valid) return ApiErrors.validationError(emailVal.error!);

    const passwordVal = validatePassword(body.adminPassword);
    if (!passwordVal.valid) return ApiErrors.validationError(passwordVal.error!);

    const result = await getModules().auth.register({
      workspaceName: body.workspaceName,
      adminName: body.adminName,
      adminEmail: body.adminEmail,
      adminPassword: body.adminPassword,
      inviteCode: body.inviteCode,
    });

    return successResponse(result);
  } catch (error: any) {
    if (error?.message?.includes('already initialized')) {
      return ApiErrors.conflict(error.message);
    }
    return handleApiError(error);
  }
}
