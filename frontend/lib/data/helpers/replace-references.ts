import { BaseFileContent, FileType } from '@/lib/types';

/**
 * Replace negative virtual IDs with real positive IDs in any file content.
 *
 * After batch-creating virtual files, we get a map of virtualId → realId.
 * This function rewrites references in other files so they point to the
 * newly-created real files instead of the stale negative IDs.
 */
export function replaceNegativeIdsInContent(
  content: BaseFileContent,
  type: FileType,
  idMap: Record<number, number>
): BaseFileContent {
  const cloned = JSON.parse(JSON.stringify(content));

  if (type === 'dashboard' || type === 'presentation' || type === 'notebook') {
    cloned.assets = (cloned.assets || []).map((a: any) =>
      a.type === 'question' && idMap[a.id] ? { ...a, id: idMap[a.id] } : a
    );
    // Dashboard layout: { columns, items: DashboardLayoutItem[] } where item.id is the question ID
    if (cloned.layout?.items) {
      cloned.layout = {
        ...cloned.layout,
        items: cloned.layout.items.map((item: any) =>
          idMap[item.id] ? { ...item, id: idMap[item.id] } : item
        ),
      };
    }
  }

  if (type === 'question' && cloned.references) {
    cloned.references = cloned.references.map((ref: any) =>
      idMap[ref.id] ? { ...ref, id: idMap[ref.id] } : ref
    );
  }

  if (type === 'report' && cloned.references) {
    cloned.references = cloned.references.map((r: any) =>
      r.reference && idMap[r.reference.id]
        ? { ...r, reference: { ...r.reference, id: idMap[r.reference.id] } }
        : r
    );
  }

  if (type === 'alert' && idMap[cloned.questionId]) {
    cloned.questionId = idMap[cloned.questionId];
  }

  return cloned;
}
