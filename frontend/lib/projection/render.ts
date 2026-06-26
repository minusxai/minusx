/**
 * Render a projected turn ({@link ProjectedFilesOutput}) into LLM content blocks — the exact wire
 * format the model sees. The lean JSON goes inside a tagged envelope; the out-of-JSON facets
 * (markup, query-result rows) follow as raw blocks correlated by id; images are native image
 * content blocks.
 *
 *   <AppState>{…lean json…}</AppState>
 *   <file_markup file_id="1" type="question">
 *   …raw JSX…
 *   </file_markup>
 *   <query_data query_result_id="h1">
 *   | a | b |
 *   …
 *   </query_data>
 *   [image content block(s)]
 *
 * The JSON + all text blocks are concatenated into ONE text content block (real newlines, never an
 * escaped JSON string), then images follow as separate blocks — the same text-then-images layout
 * the previous boundary used, so the model's mental model of the format is unchanged apart from the
 * explicit per-facet unchanged/present signals. `jsonTag` distinguishes contexts (e.g. `AppState`
 * for page context, `Files` for a ReadFiles tool result).
 */
import type { TextContent, ImageContent } from '@/orchestrator/llm';
import { FacetMemo } from './facets';
import { projectFiles } from './project';
import type { AugmentedFiles, ProjectedFilesOutput, ProjectionTextBlock } from './types';

function renderTextBlock(b: ProjectionTextBlock): string {
  if (b.kind === 'markup') {
    const attrs = `file_id="${b.fileId}"${b.type ? ` type="${b.type}"` : ''}`;
    return `<file_markup ${attrs}>\n${b.text}\n</file_markup>`;
  }
  return `<query_data query_result_id="${b.queryResultId}">\n${b.text}\n</query_data>`;
}

/** Render one projected turn to content blocks: a single text block (JSON + raw blocks) then images. */
export function renderProjectedFiles(
  output: ProjectedFilesOutput,
  opts: { jsonTag: string },
): (TextContent | ImageContent)[] {
  const parts = [`<${opts.jsonTag}>${JSON.stringify(output.json)}</${opts.jsonTag}>`];
  for (const b of output.textBlocks) parts.push(renderTextBlock(b));
  return [{ type: 'text', text: parts.join('\n') }, ...output.images];
}

/**
 * Project + render a sequence of file payloads (in conversation order) through ONE shared memo, so
 * repeats across turns collapse to `{unchanged:true}`. Each payload is one turn's app state or one
 * file-tool output; pass the SAME memo for the whole window (and `memo.reset()` at a summarization
 * boundary). Returns the rendered content blocks per payload, aligned to the input order.
 */
export function renderConversationFiles(
  memo: FacetMemo,
  payloads: Array<{ files: AugmentedFiles; jsonTag: string }>,
): Array<(TextContent | ImageContent)[]> {
  return payloads.map(({ files, jsonTag }) => {
    const out: ProjectedFilesOutput = projectFiles(memo, files);
    return renderProjectedFiles(out, { jsonTag });
  });
}
