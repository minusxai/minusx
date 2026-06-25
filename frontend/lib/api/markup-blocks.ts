/**
 * markup-blocks — keep a file's JSX `markup` OUT of the LLM-facing JSON.
 *
 * The agent's edit surface is the JSX `markup` projection of a file. When that markup
 * is embedded as a JSON string value (app state / ReadFiles / EditFile), it arrives
 * escaped (`\n`, `\"`) and unreadable, and the agent's EditFile `oldMatch` then has to
 * match against escaped text. These helpers PULL the markup out of the JSON and render
 * it as a separate raw `<file_markup>` block — real newlines, real quotes — so the agent
 * reads/edits the exact JSX. Applied only at the LLM serialization boundary; the in-memory
 * / client state is untouched (it keeps `markup` + `content`).
 */
import type { CompressedAugmentedFile, CompressedFileState } from '@/lib/types';

export interface MarkupBlock {
  fileId?: number;
  type?: string;
  /** The raw JSX markup — emitted verbatim, never JSON-stringified. */
  markup: string;
}

/** Render one raw `<file_markup file_id="…" type="…">…</file_markup>` block. */
export function renderMarkupBlock(b: MarkupBlock): string {
  const attrs = [
    b.fileId != null ? `file_id="${b.fileId}"` : '',
    b.type ? `type="${b.type}"` : '',
  ].filter(Boolean).join(' ');
  return `<file_markup${attrs ? ' ' + attrs : ''}>\n${b.markup}\n</file_markup>`;
}

/** Render a list of markup blocks (newline-separated). Empty list → ''. */
export function renderMarkupBlocks(blocks: MarkupBlock[]): string {
  return blocks.map(renderMarkupBlock).join('\n');
}

/**
 * The raw markup as a tool-result content block (a single text block holding every
 * file's `<file_markup>`), or [] when there's nothing — so a tool can splice it into
 * its content array: `[{ type:'text', text: json }, ...markupTextBlocks(blocks), ...images]`.
 */
export function markupTextBlocks(blocks: MarkupBlock[]): Array<{ type: 'text'; text: string }> {
  return blocks.length ? [{ type: 'text', text: renderMarkupBlocks(blocks) }] : [];
}

/** Pull `markup` off a single CompressedFileState → the stripped state + the extracted block. */
export function takeFileStateMarkup(
  fs: CompressedFileState | undefined,
): { fileState: CompressedFileState | undefined; block: MarkupBlock | null } {
  if (!fs || typeof fs !== 'object' || typeof fs.markup !== 'string') {
    return { fileState: fs, block: null };
  }
  const { markup, ...rest } = fs;
  return { fileState: rest, block: { fileId: fs.id, type: fs.type, markup } };
}

/** Pull markup off a CompressedAugmentedFile (primary fileState + every reference). */
export function takeAugmentedMarkup(
  aug: CompressedAugmentedFile,
): { value: CompressedAugmentedFile; blocks: MarkupBlock[] } {
  const blocks: MarkupBlock[] = [];
  const primary = takeFileStateMarkup(aug.fileState);
  if (primary.block) blocks.push(primary.block);
  const references = Array.isArray(aug.references)
    ? aug.references.map((r) => {
        const t = takeFileStateMarkup(r);
        if (t.block) blocks.push(t.block);
        return t.fileState as CompressedFileState;
      })
    : aug.references;
  return { value: { ...aug, fileState: primary.fileState as CompressedFileState, references }, blocks };
}

/** Pull markup off an array of augmented files (ReadFiles), flattening the blocks. */
export function takeFilesMarkup(
  files: CompressedAugmentedFile[],
): { files: CompressedAugmentedFile[]; blocks: MarkupBlock[] } {
  const blocks: MarkupBlock[] = [];
  const out = files.map((f) => {
    const t = takeAugmentedMarkup(f);
    blocks.push(...t.blocks);
    return t.value;
  });
  return { files: out, blocks };
}
