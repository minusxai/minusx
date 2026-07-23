'use client';

/**
 * ReportRunContainerV2
 * Smart container for report run files — standalone page and inline panel.
 */
import { LuExternalLink } from 'react-icons/lu';
import Link from 'next/link';
import { preserveParams } from '@/lib/navigation/url-utils';
import { useFile } from '@/lib/hooks/file-state-hooks';
import Markdown from '@/components/Markdown';
import { Badge } from '@/components/kit/badge';
import { cn } from '@/components/kit/cn';
import type { ReportOutput, RunFileContent } from '@/lib/types';
import type { FileId } from '@/store/filesSlice';
import type { FileViewMode } from '@/lib/ui/fileComponents';

/** Status badge tint (Chakra colorPalette subtle-badge equivalent) — matches ReportView's scheme. */
const STATUS_BADGE_CLASS: Record<'green' | 'red' | 'yellow', string> = {
  green: 'border-transparent bg-[color-mix(in_srgb,#2ecc71_18%,transparent)] text-[#27ae60]',
  red: 'border-transparent bg-[color-mix(in_srgb,#c0392b_15%,transparent)] text-[#c0392b]',
  yellow: 'border-transparent bg-[color-mix(in_srgb,#f39c12_18%,transparent)] text-[#f39c12]',
};

interface ReportRunContainerV2Props {
  fileId: FileId;
  mode?: FileViewMode;
  inline?: boolean;
}

export default function ReportRunContainerV2({ fileId, inline }: ReportRunContainerV2Props) {
  const { fileState: file } = useFile(fileId) ?? {};

  if (!file || file.loading) {
    return <div className="p-4 text-muted-foreground">Loading run details...</div>;
  }

  if (!file.content) {
    return <div className="p-4 text-muted-foreground">Run details not available.</div>;
  }

  const run = file.content as RunFileContent;
  const output = run.output as ReportOutput | undefined;

  const statusColor =
    run.status === 'success' ? 'green' :
    run.status === 'failure' ? 'red' :
    'yellow';

  return (
    <div className={cn('flex flex-col gap-4', inline ? 'p-0' : 'p-4')}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge className={cn(STATUS_BADGE_CLASS[statusColor], 'px-2.5 text-sm font-bold')}>
            {run.status.toUpperCase()}
          </Badge>
          <p className="text-xs text-muted-foreground">
            {new Date(run.startedAt).toLocaleString()}
          </p>
          {run.completedAt && (
            <p className="text-xs text-muted-foreground">
              → {new Date(run.completedAt).toLocaleString()}
            </p>
          )}
        </div>
        {!inline && typeof fileId === 'number' && (
          <Link href={preserveParams(`/f/${fileId}`)} style={{ opacity: 0.5 }}>
            <LuExternalLink size={14} />
          </Link>
        )}
      </div>

      {run.error && (
        <div className="rounded-md bg-[color-mix(in_srgb,#c0392b_10%,transparent)] p-3 text-[#c0392b]">
          <p className="text-sm">{run.error}</p>
        </div>
      )}

      {output?.generatedReport ? (
        <div className="rounded-md bg-muted p-4">
          <Markdown queries={output.queries}>
            {output.generatedReport}
          </Markdown>
        </div>
      ) : !run.error && (
        <p className="text-sm text-muted-foreground">No report content generated.</p>
      )}
    </div>
  );
}
