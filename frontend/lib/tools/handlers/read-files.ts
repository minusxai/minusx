/**
 * ReadFiles - Load multiple files with references and query results
 * Returns CompressedAugmentedFile[] — pre-merged content/persistableChanges so the
 * model always sees a single flat content layer (no layer reasoning needed).
 */
import type { ReadFilesResult } from '@/lib/types';
import { readFiles } from '@/lib/file-state/file-state';
import { compressAugmentedFile, TOOL_DEFAULT_LIMIT_CHARS, TOOL_MAX_LIMIT_CHARS, stripAugmentedContentForLlm } from '@/lib/chat/compress-augmented';
import { compressedToAugmentedFiles } from '@/lib/projection/from-compressed';
import { stripEntryQueryData } from '@/lib/projection/project';
import type { AugmentedToolDetails } from '@/lib/projection/messages';
import { isContentImageViz, shouldDropRows } from '@/lib/chart/query-presentation';
import { takeFilesMarkup, markupTextBlocks } from '@/lib/chat/markup-blocks';
import type { VizEnvelope, VizSettings } from '@/lib/validation/atlas-schemas';
import type { FrontendToolHandler } from './types';
import { renderFileChartImageBlocks } from './chart-images';

/** The viz-bearing shape of a file's content read by the image-presentation gate. */
type ContentViz = { viz?: VizEnvelope | null; vizSettings?: VizSettings | null } | undefined;

export const readFilesHandler: FrontendToolHandler = async (args, context) => {
  const { fileIds, maxChars: rawMaxChars, runQueries = true, rawData = false } = args;
  const maxChars = Math.min(rawMaxChars ?? TOOL_DEFAULT_LIMIT_CHARS, TOOL_MAX_LIMIT_CHARS);

  // Thread the conversation's abort signal into the query auto-execution: a ReadFiles over a wide
  // dashboard can otherwise block on every uncached query to its full timeout with Stop doing nothing.
  const result = await readFiles(fileIds, { runQueries, signal: context.signal });
  // The agent reads `markup`, not JSON `content` — strip the duplicate content, then pull the
  // JSX `markup` out into a separate raw <file_markup> block (real JSX, not escaped JSON).
  const { files: noMarkup, blocks } = takeFilesMarkup(
    result.map(f => stripAugmentedContentForLlm(compressAugmentedFile(f, maxChars))),
  );
  const textContent: ReadFilesResult = { success: true, files: noMarkup };
  const imageBlocks = await renderFileChartImageBlocks(result);
  // Only present-as-image (drop rows) when an image was ACTUALLY rendered. If the chart couldn't
  // render (no rows, render failure, server-side path with no DOM), keep the rows so the agent is
  // never left with neither an image nor data. `result[i]` and `__augmented[i]` are 1:1.
  const imageByFileId = new Set(
    imageBlocks.length > 0
      ? result.filter(f => f.queryResults?.[0]?.rows?.length && isContentImageViz(f.fileState.content as ContentViz)).map(f => f.fileState.id)
      : [],
  );
  // Rich payload for the projection pass (cross-turn diffing): the same files in the projector's
  // shape. The `content` above is kept verbatim for the chat UI; projectMessages rebuilds the
  // LLM-facing content from `__augmented` (diffed against the conversation) at send time.
  // Presentation: a question with a renderable chart viz returns the rendered IMAGE (above) + summary
  // instead of rows (unless rawData). Drop the row data facet for those files; keep it otherwise.
  const augmented: AugmentedToolDetails = {
    __augmented: result.map(f => {
      const aug = compressedToAugmentedFiles(compressAugmentedFile(f, maxChars));
      if (shouldDropRows({ imagePresentation: isContentImageViz(f.fileState.content as ContentViz), imageRendered: imageByFileId.has(f.fileState.id), rawData })) {
        aug.file = stripEntryQueryData(aug.file);
      }
      return aug;
    }),
    __jsonTag: 'Files',
    __status: { success: true },
  };
  return {
    content: [{ type: 'text', text: JSON.stringify(textContent) }, ...markupTextBlocks(blocks), ...imageBlocks],
    details: { success: true, ...augmented },
  };
};
