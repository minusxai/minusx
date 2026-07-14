import { NextRequest } from 'next/server';
import { getModules } from '@/lib/modules/registry';
import { successResponse, ApiErrors, handleApiError } from '@/lib/http/api-responses';
import { ENABLE_ORG_CREATION } from '@/lib/config';
import {
  validateWorkspaceName,
  validateEmail,
  validatePassword,
  validateFullName,
} from '@/lib/validation/validators';
import { validateLlmConfig } from '@/lib/validation/config-validators';

export async function POST(request: NextRequest) {
  if (!ENABLE_ORG_CREATION) return ApiErrors.forbidden('Organization creation is disabled');

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

    // Optional setup.sh bootstrap payload (LLM config + first connection).
    if (body.llm !== undefined) {
      const llmError = validateLlmConfig(body.llm);
      if (llmError) return ApiErrors.validationError(`Invalid LLM config: ${llmError}`);
    }
    if (body.connection !== undefined
        && (typeof body.connection !== 'object' || !body.connection.name || !body.connection.type || !body.connection.config)) {
      return ApiErrors.validationError('connection requires name, type, and config');
    }

    const result = await getModules().auth.register({
      workspaceName: body.workspaceName,
      adminName: body.adminName,
      adminEmail: body.adminEmail,
      adminPassword: body.adminPassword,
      inviteCode: body.inviteCode,
      llm: body.llm,
      connection: body.connection,
    });

    return successResponse(result);
  } catch (error: any) {
    if (error?.message?.includes('already initialized')) {
      return ApiErrors.conflict(error.message);
    }
    return handleApiError(error);
  }
}
