/**
 * Canonical file path → ID map, derived directly from company-template.json.
 *
 * company-template.json is the single source of truth for file IDs. Every
 * company seeded from the template gets the same IDs, scoped by company_id in
 * the database — so id=107 always means /org/database/static for whichever
 * company the current user belongs to.
 *
 * Do NOT hardcode IDs elsewhere. Use this map instead.
 */
import companyTemplate from './company-template.json';

export const TEMPLATE_FILE_IDS: Record<string, number> = Object.fromEntries(
  (companyTemplate.companies[0] as { documents: { path: string; id: number }[] })
    .documents.map((doc) => [doc.path, doc.id])
);
