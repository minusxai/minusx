import 'server-only';
import { FilesAPI } from '@/lib/data/files.server';
import { linkGroupsOf, reimportLinkGroup, type LinkGroupSyncResult } from '@/lib/data/dataset-sync.server';
import type { JobHandler } from '../job-registry';
import type { JobHandlerResult, JobRunnerInput } from '@/lib/types';
import type { DatasetContent } from '@/lib/types/datasets';

/**
 * Resyncs each link group (Google Sheets today) of a DATASET from its live
 * source. Same atomicity rule as the manual Re-import button (both call
 * reimportLinkGroup): new data is validated before old objects are deleted,
 * so a failed sync keeps the previous data; deletions/renames the user made
 * are preserved by the merge.
 */
export const sheetsSyncJobHandler: JobHandler = {
  async execute({ jobId, file }: JobRunnerInput, user): Promise<JobHandlerResult> {
    const content = file as DatasetContent;
    const fileId = parseInt(jobId, 10);
    const { data: doc } = await FilesAPI.loadFile(fileId, user);
    if (!doc) throw new Error(`Dataset ${jobId} not found`);

    const groups = linkGroupsOf(content);
    if (groups.length === 0) throw new Error('Dataset has no link sources to sync');

    let files = content.files ?? [];
    const results: LinkGroupSyncResult[] = [];
    for (const group of groups) {
      const out = await reimportLinkGroup(doc.name, files, group, user);
      files = out.files;
      results.push(out.result);
    }

    const failures = results.filter((r) => r.status === 'error');
    const anySuccess = failures.length < results.length;

    const updatedContent: DatasetContent = {
      ...content,
      files,
      ...(anySuccess ? { lastSyncedAt: new Date().toISOString() } : {}),
      lastSyncError: failures.length > 0
        ? failures.map((f) => `${f.source_url}: ${f.error}`).join('; ')
        : undefined,
    };
    await FilesAPI.saveFile(fileId, doc.name, doc.path, updatedContent as never, doc.references ?? [], user);

    return {
      output: { results, synced: results.length - failures.length, failed: failures.length },
      messages: [],
      status: failures.length > 0 ? 'failure' : 'success',
    };
  },
};
