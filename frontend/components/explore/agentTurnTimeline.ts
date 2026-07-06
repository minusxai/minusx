import type React from 'react';
import type { MessageWithFlags } from './message/messageHelpers';
import { embeddedQuestionCount } from '@/lib/data/story-question';
import { getToolConfig } from '@/lib/tools/tool-config';
import { type WebSearchResult } from './tools/WebSearchDisplay';
import { ToolNames } from '@/lib/types';
import { immutableSet } from '@/lib/utils/immutable-collections';
import type { QueryResult } from '@/lib/types';
import { LuBrain, LuDatabase } from 'react-icons/lu';

export function getToolName(msg: MessageWithFlags): string {
  if (msg.role !== 'tool') return '';
  return (msg as any).function?.name || '';
}

export const CHAT_TOOLS: ReadonlySet<string> = immutableSet([
  ToolNames.TALK_TO_USER,
  ToolNames.ANALYST_AGENT,
  ToolNames.ATLAS_ANALYST_AGENT,
  ToolNames.TEST_AGENT,
  ToolNames.ONBOARDING_CONTEXT_AGENT,
  ToolNames.ONBOARDING_DASHBOARD_AGENT,
  ToolNames.SLACK_AGENT,
]);

// Labels used for file-mutating tool nodes (create/edit/read) — shared between
// the parent's chart-content memos and the detail-pane's chart-item extraction.
export const FILE_LABELS: ReadonlySet<string> = new Set(['file create', 'file edit', 'file read']);

// ─── Timeline node types ───────────────────────────────────────────

export type TimelineNodeType = 'agent' | 'query' | 'tool';

export interface TimelineNode {
  type: TimelineNodeType;
  icon: React.ComponentType;
  label: string;          // Singular noun: "file edit", "search", "query"
  labelPlural: string;    // Plural noun: "file edits", "searches", "queries"
  verb: string;           // e.g. "Creating", "Editing", "Executing"
  count: number;
  messages: MessageWithFlags[];
  webSearchResults?: WebSearchResult[];  // Only set for synthetic web search nodes
}

// ─── Helpers ───────────────────────────────────────────────────────

export function getDisplayName(msg: MessageWithFlags, filesDict: Record<number, any>): string {
  const toolMsg = msg as any;
  const args = toolMsg.function?.arguments;
  let parsed: any = {};
  try {
    parsed = typeof args === 'string' ? JSON.parse(args) : args || {};
  } catch { /* ignore */ }

  // 1. Look up file name from Redux by ID
  const fileId = parsed.fileId || parsed.fileIds?.[0];
  if (fileId && filesDict[fileId]) {
    return filesDict[fileId].name || `#${fileId}`;
  }

  // 2. Check tool args for name
  if (parsed.name) return parsed.name;

  // 3. Check tool response content for file name
  try {
    const content = typeof toolMsg.content === 'string' ? JSON.parse(toolMsg.content) : toolMsg.content;
    const stateName = content?.state?.fileState?.name;
    if (stateName) return stateName;
  } catch { /* ignore */ }

  // 4. Fallback
  return parsed.file_type || (fileId ? `#${fileId}` : getToolName(msg));
}

/** Parse agent content (TalkToUser) into thinking + content sections */
export function parseAgentContent(msg: MessageWithFlags): { thinking: string | null; content: string } {
  const toolMsg = msg as any;
  let raw = toolMsg.content || '';
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed?.content_blocks && Array.isArray(parsed.content_blocks)) {
      const thinkingParts: string[] = [];
      const textParts: string[] = [];
      for (const block of parsed.content_blocks) {
        if (block.type === 'thinking' && block.thinking) thinkingParts.push(block.thinking);
        else if (block.type === 'text' && block.text) textParts.push(block.text);
      }
      return {
        thinking: thinkingParts.length > 0 ? thinkingParts.join('\n\n') : null,
        content: textParts.join('\n\n'),
      };
    }
    if (typeof parsed === 'string') raw = parsed;
    else if (parsed?.content) raw = parsed.content;
    else if (parsed?.message) raw = parsed.message;
  } catch { /* use raw */ }

  // Check for legacy <thinking> tags
  const thinkingMatch = raw.match(/<thinking>([\s\S]*?)<\/thinking>/);
  const thinking = thinkingMatch ? thinkingMatch[1].trim() : null;
  const content = raw.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();

  return { thinking, content };
}

/** Parse file tool content (CreateFile/EditFile/ReadFiles) to extract question content + query result */
export function parseFileToolContent(msg: MessageWithFlags): {
  content: import('@/lib/types').QuestionContent | null;
  queryResult: QueryResult | null;
  fileName: string | null;
  filePath: string | null;
  fileType: string | null;
  assetCount: number | null; // for dashboards
} {
  const toolMsg = msg as any;
  const empty = { content: null, queryResult: null, fileName: null, filePath: null, fileType: null, assetCount: null };
  try {
    // content may be a string, an object, or an array of content blocks (text + image)
    let rawContent = toolMsg.content;
    if (Array.isArray(rawContent)) {
      const textBlock = rawContent.find((b: any) => b.type === 'text');
      rawContent = textBlock?.text ?? rawContent;
    }
    const parsed = typeof rawContent === 'string' ? JSON.parse(rawContent) : rawContent;
    // Handle CreateFile (state.fileState), EditFile (fileState), ReadFiles (files[0].fileState)
    const fileState = parsed?.state?.fileState || parsed?.fileState || parsed?.files?.[0]?.fileState;
    const queryResults = parsed?.state?.queryResults || parsed?.queryResults || parsed?.files?.[0]?.queryResults;

    if (!fileState) return empty;

    const fileName = fileState.name || null;
    const filePath = fileState.path || null;
    const fileType = fileState.type || null;
    const assetCount = embeddedQuestionCount(fileState.content, fileType) || null;

    if (!fileState.content || fileState.type !== 'question') {
      return { content: null, queryResult: null, fileName, filePath, fileType, assetCount };
    }

    const content = fileState.content;
    let queryResult: QueryResult | null = null;

    if (queryResults?.[0]) {
      const qr = queryResults[0];

      // Option 1: rows already parsed as array
      if (qr.rows && Array.isArray(qr.rows) && qr.rows.length > 0) {
        queryResult = { columns: qr.columns, types: qr.types, rows: qr.rows };
      }
      // Option 2: data is markdown table string — parse into Record<string, any>[]
      else if (qr.data && typeof qr.data === 'string') {
        const columns: string[] = qr.columns;
        const lines = qr.data.split('\n').filter((l: string) => l.trim().startsWith('|') && !l.includes('---'));
        // First line is header, rest are data
        const dataLines = lines.slice(1);
        const rows = dataLines
          .filter((line: string) => line.trim().length > 0)
          .map((line: string) => {
            const cells = line.split('|').slice(1, -1).map((cell: string) => {
              const trimmed = cell.trim();
              if (trimmed === '' || trimmed === '-') return null;
              const num = Number(trimmed);
              return isNaN(num) ? trimmed : num;
            });
            // Build a Record<string, any> using column names as keys
            const row: Record<string, any> = {};
            columns.forEach((col, i) => { row[col] = cells[i] ?? null; });
            return row;
          });
        if (rows.length > 0) {
          queryResult = { columns: qr.columns, types: qr.types, rows };
        }
      }
    }

    return { content, queryResult, fileName, filePath, fileType, assetCount };
  } catch {
    return empty;
  }
}

/** Extract web search results from a CHAT_TOOLS message's content_blocks */
export function extractWebSearchResults(msg: MessageWithFlags): WebSearchResult[] | null {
  const toolMsg = msg as any;
  const raw = toolMsg.content || '';
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed?.content_blocks || !Array.isArray(parsed.content_blocks)) return null;

    const results: WebSearchResult[] = [];
    for (const block of parsed.content_blocks) {
      if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
        for (const item of block.content) {
          if (item.type === 'web_search_result') {
            results.push({ url: item.url, title: item.title });
          }
        }
      }
    }

    // Enrich with cited_text from top-level citations
    if (parsed.citations && Array.isArray(parsed.citations)) {
      for (const citation of parsed.citations) {
        if (citation.type === 'web_search_result_location' && citation.cited_text) {
          const match = results.find(r => r.url === citation.url);
          if (match) match.cited_text = citation.cited_text;
        }
      }
    }

    return results.length > 0 ? results : null;
  } catch {
    return null;
  }
}

// ─── Build timeline from messages ──────────────────────────────────

export function buildTimeline(
  agentMessages: MessageWithFlags[],
): { timeline: TimelineNode[]; lastChatMessage: MessageWithFlags | null } {
  const nodes: TimelineNode[] = [];
  const allChat: MessageWithFlags[] = [];

  for (const msg of agentMessages) {
    // Handle autogenerated messages (e.g. skill_load)
    if (msg.role === 'autogenerated') {
      const autoMsg = msg as any;
      if (autoMsg.type === 'skill_load') {
        const config = getToolConfig('LoadSkill');
        const last = nodes[nodes.length - 1];
        if (last && last.type === 'tool' && last.label === config.chipLabel) {
          last.messages.push(msg);
          last.count++;
        } else {
          nodes.push({ type: 'tool', icon: config.chipIcon, label: config.chipLabel, labelPlural: config.chipLabelPlural, verb: config.timelineVerb, count: 1, messages: [msg] });
        }
      }
      continue;
    }

    if (msg.role !== 'tool') continue; // skip debug

    const toolName = getToolName(msg);

    if (CHAT_TOOLS.has(toolName)) {
      // Check for web search results embedded in this chat message
      const webResults = extractWebSearchResults(msg);
      if (webResults) {
        const wsConfig = getToolConfig('WebSearch');
        nodes.push({
          type: 'tool', icon: wsConfig.chipIcon, label: wsConfig.chipLabel,
          labelPlural: wsConfig.chipLabelPlural, verb: wsConfig.timelineVerb,
          count: webResults.length, messages: [msg], webSearchResults: webResults,
        });
      }

      allChat.push(msg);
      const last = nodes[nodes.length - 1];
      if (last && last.type === 'agent') {
        last.messages.push(msg);
        last.count++;
      } else {
        nodes.push({ type: 'agent', icon: LuBrain, label: 'thought', labelPlural: 'thoughts', verb: 'Thinking', count: 1, messages: [msg] });
      }
    } else if (toolName === ToolNames.EXECUTE_QUERY) {
      const last = nodes[nodes.length - 1];
      if (last && last.type === 'query') {
        last.messages.push(msg);
        last.count++;
      } else {
        nodes.push({ type: 'query', icon: LuDatabase, label: 'query', labelPlural: 'queries', verb: 'Querying', count: 1, messages: [msg] });
      }
    } else {
      const config = getToolConfig(toolName);
      const key = config.chipLabel;
      const last = nodes[nodes.length - 1];
      if (last && last.type === 'tool' && last.label === key) {
        last.messages.push(msg);
        last.count++;
      } else {
        nodes.push({ type: 'tool', icon: config.chipIcon, label: config.chipLabel, labelPlural: config.chipLabelPlural, verb: config.timelineVerb, count: 1, messages: [msg] });
      }
    }
  }

  // Last chat message renders outside the working area — remove it from the timeline node
  const lastChatMessage = allChat.length > 0 ? allChat[allChat.length - 1] : null;

  if (lastChatMessage) {
    // Find the agent node that contains the last chat message and remove it
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      if (node.type === 'agent') {
        const msgIdx = node.messages.indexOf(lastChatMessage);
        if (msgIdx !== -1) {
          node.messages.splice(msgIdx, 1);
          node.count--;
          // If node is now empty, remove it
          if (node.messages.length === 0) {
            nodes.splice(i, 1);
          }
          break;
        }
      }
    }
  }

  return { timeline: nodes, lastChatMessage };
}
