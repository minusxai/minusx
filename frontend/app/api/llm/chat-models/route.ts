import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/http/with-auth';
import { successResponse, handleApiError } from '@/lib/http/api-responses';
import { getRawConfig } from '@/lib/data/configs.server';
import { DEFAULT_MODE } from '@/lib/mode/mode-types';
import { buildChatGradeCatalog } from '@/lib/llm/chat-grade-catalog';
import type { LlmConfig } from '@/lib/llm/llm-config-types';

/** Grade catalog for every authenticated chat user — grades only, never models. */
export const GET = withAuth(async (_request: NextRequest) => {
  try {
    const raw = await getRawConfig(DEFAULT_MODE);
    return successResponse(buildChatGradeCatalog(raw.llm as LlmConfig | undefined));
  } catch (error) {
    return handleApiError(error);
  }
});
