// setup-cli: print the model registry (baked pi-ai ∪ live models.dev catalog)
// — the same merged list the app's pickers use. setup.sh uses this for the
// retry-time model picker; the interview's suggestions come from the static
// compatibility.json.
//
//   docker run --rm <image> node setup-cli/list-models.js [provider]
//
// stdout: { providers: { <slug>: [{ id, name, reasoning, input, contextWindow }] } }
import { listProviders } from '@/orchestrator/llm';
import { getModelCatalog, mergedListModels } from '@/lib/llm/model-catalog.server';
import type { RegistryModelInfo } from '@/orchestrator/llm';
import { emit, isMain, type CliOutcome } from './io';

export interface ListModelsResult {
  providers: Record<string, RegistryModelInfo[]>;
}

export async function runListModels(provider: string | undefined): Promise<CliOutcome<ListModelsResult>> {
  const catalog = await getModelCatalog();
  const slugs = provider ? [provider] : listProviders();
  const providers: Record<string, RegistryModelInfo[]> = {};
  for (const slug of slugs) {
    const models = mergedListModels(slug, catalog);
    if (models.length > 0) providers[slug] = models;
  }
  return { result: { providers }, exitCode: 0 };
}

if (isMain(import.meta.url)) {
  void emit(runListModels(process.argv[2]));
}
