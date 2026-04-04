import 'server-only';
import { combineContent, parseThinkingAnswer } from '@/lib/utils/xml-parser';
import type { ConversationLogEntry, QueryResult } from '@/lib/types';
import type { VizSettings } from '@/lib/types.gen';

// ── Markdown → Slack mrkdwn conversion ───────────────────────────────────────

/**
 * Convert standard Markdown to Slack mrkdwn format.
 *
 * Slack uses its own markup: *bold*, _italic_, ~strike~, <url|text>.
 * LLMs produce standard Markdown: **bold**, *italic*, ~~strike~~, [text](url).
 *
 * Code blocks and inline code are preserved — no conversions inside them.
 */
export function markdownToSlackMrkdwn(md: string): string {
  // Split into code blocks vs. non-code segments to avoid converting inside code
  const parts = md.split(/(```[\s\S]*?```|`[^`]+`)/g);

  for (let i = 0; i < parts.length; i++) {
    // Odd indices are code block/inline code matches — skip them
    if (i % 2 === 1) {
      // Strip language hint from fenced code blocks (```sql → ```)
      parts[i] = parts[i].replace(/^```\w+\n/, '```\n');
      continue;
    }

    let segment = parts[i];

    // Image links: ![alt](url) → remove (images handled separately via content_blocks)
    segment = segment.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '');

    // Links: [text](url) → <url|text>
    segment = segment.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>');

    // Bold: **text** or __text__ → placeholder \x00B…\x00 to avoid italic regex
    segment = segment.replace(/\*\*(.+?)\*\*/g, '\x00B$1\x00');
    segment = segment.replace(/__(.+?)__/g, '\x00B$1\x00');

    // Headers: # ... → bold placeholder
    segment = segment.replace(/^#{1,6}\s+(.+)$/gm, '\x00B$1\x00');

    // Italic: *text* → _text_ (remaining single-asterisk pairs)
    segment = segment.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '_$1_');

    // Restore bold placeholders → *text*
    segment = segment.replace(/\x00B([\s\S]+?)\x00/g, '*$1*');

    // Strikethrough: ~~text~~ → ~text~
    segment = segment.replace(/~~(.+?)~~/g, '~$1~');

    parts[i] = segment;
  }

  return parts.join('');
}

// ── Structured reply extraction ──────────────────────────────────────────────

export interface SlackReply {
  text: string;
  images: string[];
}

function extractToolContent(content: unknown): { text: string; images: string[] } {
  const images: string[] = [];

  if (typeof content === 'string') {
    const trimmed = content.trim();
    if (!trimmed) return { text: '', images };

    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') {
        return extractToolContent(parsed);
      }
    } catch {
      // Plain text — expected fast path
    }

    return { text: trimmed, images };
  }

  if (content && typeof content === 'object') {
    const record = content as Record<string, unknown>;

    // Handle content_blocks: [{ type: 'text', text }, { type: 'image', url }]
    if ('content_blocks' in record && Array.isArray(record.content_blocks)) {
      const blocks = record.content_blocks as Array<Record<string, unknown>>;
      const textParts: string[] = [];

      for (const block of blocks) {
        if (block.type === 'text' && typeof block.text === 'string') {
          textParts.push(block.text);
        } else if (block.type === 'image' && typeof block.url === 'string') {
          images.push(block.url);
        }
      }

      const text = textParts.join('\n').trim();
      if (text || images.length > 0) {
        return { text, images };
      }
    }

    if ('content' in record) {
      return extractToolContent(record.content);
    }
  }

  return { text: '', images };
}

function toVisibleReply(rawText: string): string | null {
  const parsed = parseThinkingAnswer(rawText, false);
  if (!parsed) {
    return rawText.trim() || null;
  }

  const visible = combineContent({
    ...parsed,
    thinking: [],
  }, false).trim();

  return visible || null;
}

export function normalizeSlackPrompt(text: string, botUserId?: string): string {
  let normalized = text.trim();
  if (botUserId) {
    normalized = normalized.replace(new RegExp(`<@${botUserId}>`, 'g'), '').trim();
  }
  return normalized.replace(/\s+/g, ' ');
}

const AGENT_TOOL_NAMES = ['TalkToUser', 'AnalystAgent', 'AtlasAnalystAgent', 'SlackAgent'];

/**
 * Extract a structured reply (text + images) from a conversation log.
 * Returns null if no usable reply is found.
 */
export function extractSlackReply(log: ConversationLogEntry[]): SlackReply | null {
  for (let i = log.length - 1; i >= 0; i--) {
    const entry = log[i];
    if (entry._type !== 'task_result') continue;

    const completedToolCalls = entry.result?.completed_tool_calls;
    if (Array.isArray(completedToolCalls)) {
      for (let j = completedToolCalls.length - 1; j >= 0; j--) {
        const toolCall = completedToolCalls[j];
        const functionName = toolCall?.function?.name;
        if (!AGENT_TOOL_NAMES.includes(functionName)) continue;

        const { text: rawText, images } = extractToolContent(toolCall.content);
        if (!rawText) continue;

        const visible = toVisibleReply(rawText);
        if (visible) {
          return { text: visible, images };
        }
      }
    }

    const { text: rootRaw, images: rootImages } = extractToolContent(entry.result);
    if (rootRaw) {
      const visible = toVisibleReply(rootRaw);
      if (visible) {
        return { text: visible, images: rootImages };
      }
    }
  }

  console.warn(
    '[Slack] extractSlackReply: could not find reply. Last entries:',
    log.slice(-3).map((e) => ({ type: e._type, hasResult: !!((e as unknown) as Record<string, unknown>).result })),
  );
  return null;
}

/** @deprecated Use extractSlackReply instead */
export function extractSlackReplyFromLog(log: ConversationLogEntry[]): string | null {
  const reply = extractSlackReply(log);
  return reply?.text ?? null;
}

// ── Block Kit builder ────────────────────────────────────────────────────────

interface SlackReplyBlocksOptions {
  text: string;
  images?: string[];
  viewUrl?: string;
}

/**
 * Build Slack Block Kit blocks for a rich reply message.
 * - Section block with mrkdwn text
 * - Optional image blocks
 * - Optional "View in MinusX" button
 */
export function buildSlackReplyBlocks(options: SlackReplyBlocksOptions): unknown[] {
  const blocks: unknown[] = [];

  // Text section
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: options.text },
  });

  // Image blocks
  if (options.images) {
    for (const imageUrl of options.images) {
      blocks.push({
        type: 'image',
        image_url: imageUrl,
        alt_text: 'Chart',
      });
    }
  }

  // "View in MinusX" button
  if (options.viewUrl) {
    blocks.push({
      type: 'actions',
      elements: [{
        type: 'button',
        text: { type: 'plain_text', text: 'View in MinusX', emoji: true },
        url: options.viewUrl,
        action_id: 'view_in_minusx',
      }],
    });
  }

  return blocks;
}

// ── Query chart extraction ───────────────────────────────────────────────────

const RENDERABLE_CHART_TYPES = new Set(['line', 'bar', 'area', 'scatter', 'pie', 'funnel']);

export interface QueryChart {
  queryResult: QueryResult;
  vizSettings: VizSettings;
}

/**
 * Extract renderable charts from an orchestration logDiff.
 *
 * Scans for ExecuteQuery tool calls that have:
 * - A non-table/pivot vizSettings
 * - A successful query result with rows
 *
 * Returns the last `maxCharts` renderable charts (most recent first).
 * Returns empty array if none found.
 */
export function extractQueryCharts(log: ConversationLogEntry[], maxCharts: number = 2): QueryChart[] {
  // Build a map of task unique_id → args for ExecuteQuery tasks
  const executeQueryTasks = new Map<string, { vizSettings?: string | VizSettings }>();

  for (const entry of log) {
    if (entry._type === 'task' && entry.agent === 'ExecuteQuery') {
      executeQueryTasks.set(entry.unique_id, {
        vizSettings: entry.args?.vizSettings,
      });
    }
  }

  if (executeQueryTasks.size === 0) return [];

  // Scan results in reverse to find the last renderable charts
  const charts: QueryChart[] = [];

  for (let i = log.length - 1; i >= 0; i--) {
    if (charts.length >= maxCharts) break;

    const entry = log[i];
    if (entry._type !== 'task_result') continue;

    const taskArgs = executeQueryTasks.get(entry._task_unique_id);
    if (!taskArgs) continue;

    // Extract QueryResult from details (full rows)
    const details = entry.details as { queryResult?: QueryResult } | undefined;
    const queryResult = details?.queryResult;
    if (!queryResult?.rows?.length || !queryResult?.columns?.length) continue;

    // Parse vizSettings
    let vizSettings: VizSettings | undefined;
    if (taskArgs.vizSettings) {
      if (typeof taskArgs.vizSettings === 'string') {
        try {
          vizSettings = JSON.parse(taskArgs.vizSettings);
        } catch {
          continue;
        }
      } else {
        vizSettings = taskArgs.vizSettings as VizSettings;
      }
    }

    // Skip non-renderable types
    if (!vizSettings || !RENDERABLE_CHART_TYPES.has(vizSettings.type)) continue;

    charts.push({ queryResult, vizSettings });
  }

  // Reverse so they're in chronological order (oldest first)
  return charts.reverse();
}

/** @deprecated Use extractQueryCharts instead */
export function extractQueryChart(log: ConversationLogEntry[]): QueryChart | null {
  const charts = extractQueryCharts(log, 1);
  return charts[0] ?? null;
}
