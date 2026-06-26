// Inspect-content codec for the "Inspect tool calls" modal.
//
// Turns a USER MESSAGE and an APP STATE into a flat list of typed `InspectPart`s so the modal can
// render each by content type — images inline (<img>), markup (<file_markup> JSX) as formatted code,
// query results as a table, and everything else as pretty-printed JSON. User message and app state
// share this one part model so they render IDENTICALLY (the locked requirement). Pure + React-free
// so it can be unit-tested directly.
import type { AppState } from '@/lib/appState';
import { appStateForLlm, takeAppStateMarkup } from '@/lib/appState';
import { renderMarkupBlock } from '@/lib/api/markup-blocks';
import type { Attachment, CompressedFileState } from '@/lib/types';

export type InspectPart =
  | { kind: 'text'; label: string; text: string }
  | { kind: 'markup'; label: string; text: string }
  | { kind: 'image'; label: string; url: string }
  | { kind: 'query'; label: string; columns: string[]; data: string; totalRows: number }
  | { kind: 'json'; label: string; value: unknown };

/** Resolve a usable <img> src from a stored image facet: a remote url, else inline base64. */
function imageSrc(img: CompressedFileState['image'] | undefined): string | undefined {
  if (!img) return undefined;
  if (img.url) return img.url;
  if (img.data) return `data:${img.mimeType ?? 'image/jpeg'};base64,${img.data}`;
  return undefined;
}

/** Drop the heavy image payload (url/base64) from a file state, keeping only the dedup `key`. The
 *  screenshot is rendered as its own image part, and the real prompt sends it as a separate image
 *  block (never base64 in the JSON) — so the JSON part should only carry the lean key. */
function leanImageFileState(fs: CompressedFileState | undefined): CompressedFileState | undefined {
  if (!fs?.image) return fs;
  return { ...fs, image: { key: fs.image.key } };
}

/** Strip every image payload in a file app state down to its key, for the JSON part only. */
function leanImageAppState(appState: AppState): AppState {
  if (appState.type !== 'file' || !appState.state) return appState;
  const s = appState.state;
  return {
    ...appState,
    state: {
      ...s,
      fileState: leanImageFileState(s.fileState)!,
      references: Array.isArray(s.references) ? s.references.map((r) => leanImageFileState(r)!) : s.references,
    },
  };
}

/** The user's turn: the goal text + each attachment (images inline, text as text). */
export function userMessageParts(msg: { content?: string; attachments?: Attachment[] }): InspectPart[] {
  const parts: InspectPart[] = [];
  if (msg.content) parts.push({ kind: 'text', label: 'Message', text: msg.content });
  for (const a of msg.attachments ?? []) {
    if (a.type === 'image') {
      if (a.content) parts.push({ kind: 'image', label: a.name || 'image', url: a.content });
    } else if (a.content) {
      parts.push({ kind: 'text', label: a.name || 'attachment', text: a.content });
    }
  }
  return parts;
}

/**
 * The app state for a turn, rendered exactly as the LLM saw it: the file screenshot(s) inline, each
 * query result as a table, each file's JSX `markup` as a formatted `<file_markup>` block, and the
 * remaining metadata as JSON (content-stripped + markup pulled out, mirroring the prompt projection).
 * Non-file pages (folder/explore/slack) render as a single JSON part.
 */
export function appStateParts(appState: AppState | undefined | null): InspectPart[] {
  if (!appState) return [];
  if (appState.type !== 'file' || !appState.state) {
    return [{ kind: 'json', label: 'App state', value: appStateForLlm(appState) }];
  }

  const parts: InspectPart[] = [];

  // Screenshots — primary file + any references that carry one.
  const primary = appState.state.fileState;
  const primarySrc = imageSrc(primary?.image);
  if (primarySrc) parts.push({ kind: 'image', label: `Screenshot — ${primary.name}`, url: primarySrc });
  for (const ref of appState.state.references ?? []) {
    const src = imageSrc(ref?.image);
    if (src) parts.push({ kind: 'image', label: `Screenshot — ${ref.name}`, url: src });
  }

  // Query results — the compressed markdown table the agent sees.
  for (const qr of appState.state.queryResults ?? []) {
    if (qr?.data) {
      parts.push({ kind: 'query', label: 'Query result', columns: qr.columns ?? [], data: qr.data, totalRows: qr.totalRows ?? 0 });
    }
  }

  // Markup — strip JSON `content` then pull each file's JSX `markup` out as a raw block (same as the
  // prompt projection), and keep the leftover metadata as the JSON part.
  const { value, blocks } = takeAppStateMarkup(appStateForLlm(appState));
  for (const b of blocks) {
    parts.push({ kind: 'markup', label: b.fileId != null ? `Markup — file ${b.fileId}` : 'Markup', text: renderMarkupBlock(b) });
  }
  // Lean the JSON: the screenshot is its own image part above (and a separate block in the real
  // prompt), so the JSON keeps only the image `key`, never the heavy base64/url.
  parts.push({ kind: 'json', label: 'App state JSON', value: leanImageAppState(value) });

  return parts;
}
