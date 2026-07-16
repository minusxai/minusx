import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/http/with-auth';
import { successResponse, handleApiError } from '@/lib/http/api-responses';
import { getRawConfig } from '@/lib/data/configs.server';
import { DEFAULT_MODE } from '@/lib/mode/mode-types';
import { listProviders } from '@/orchestrator/llm';
import { getModelCatalog, mergedListModels } from '@/lib/llm/model-catalog.server';
import { buildChatModelCatalog } from '@/lib/llm/chat-model-catalog';
import type { LlmConfig } from '@/lib/llm/llm-config-types';

/** Safe allowed-model catalog for every authenticated chat user. */
export const GET = withAuth(async (_request: NextRequest) => {
  try {
    const [raw, liveCatalog] = await Promise.all([
      getRawConfig(DEFAULT_MODE),
      getModelCatalog(),
    ]);
    const registry = listProviders().map((slug) => ({
      slug,
      models: mergedListModels(slug, liveCatalog),
    }));
    return successResponse(buildChatModelCatalog(raw.llm as LlmConfig | undefined, registry));
  } catch (error) {
    return handleApiError(error);
  }
});
