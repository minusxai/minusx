/**
 * Parse a report/markdown body into renderable parts: prose text, chart embeds, query refs,
 * suggested-question blocks, and trust blocks. Pure (no React) so it's unit-testable.
 *
 * Chart embeds support TWO syntaxes:
 *  - NEW: `<Question id={N}/>` (also `id="N"`, with optional extra attrs) — the `<Question>`
 *    component form, matching how stories embed saved questions.
 *  - LEGACY: `<div data-question-id="N">…</div>` — kept so existing report runs still render.
 * Both resolve to a live embedded question (rendered via SmartEmbeddedQuestionContainer).
 */
import { parseSuggestedQuestions, parseTrustInfo, type ParsedTrustInfo } from '@/lib/utils/xml-parser';
import type { ReportQueryResult } from '@/lib/types';

export type ContentPart =
  | { type: 'text'; content: string }
  | { type: 'query'; content: string }
  | { type: 'question_embed'; questionId: number }
  | { type: 'trust_legacy'; content: string }
  | { type: 'suggested_questions'; questions: string[] }
  | { type: 'trust_info'; info: ParsedTrustInfo };

/**
 * Parse content string into parts, extracting XML blocks and legacy patterns.
 * Incomplete XML blocks (no closing tag yet — streaming) are stripped from output.
 */
export function parseContentParts(text: string, _queries?: Record<string, ReportQueryResult>): ContentPart[] {
  // Combined pattern, in priority order: XML blocks, legacy patterns, the legacy
  // `<div data-question-id>` embed, then the new `<Question id={N}/>` embed.
  const xmlBlockPattern = /(?:<suggested_questions>([\s\S]*?)<\/suggested_questions>|<trust_info\s([\s\S]*?)<\/trust_info>|\{\{(query):([^}]+)\}\}|\[\[(trust):([^\]]+)\]\]|<div\b[^>]*\bdata-question-id=["']?(\d+)["']?[^>]*>[\s\S]*?<\/div>|<Question\b[^>]*\bid=\{?["']?(\d+)["']?\}?[^>]*\/>)/g;

  const parts: ContentPart[] = [];
  let lastIndex = 0;
  let match;

  while ((match = xmlBlockPattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }

    if (match[1] !== undefined) {
      // <suggested_questions>...</suggested_questions>
      const questions = parseSuggestedQuestions(match[0]);
      if (questions.length > 0) parts.push({ type: 'suggested_questions', questions });
    } else if (match[2] !== undefined) {
      // <trust_info ...>...</trust_info>
      const info = parseTrustInfo(match[0]);
      if (info) parts.push({ type: 'trust_info', info });
    } else if (match[3] === 'query') {
      // {{query:id}}
      parts.push({ type: 'query', content: match[4] });
    } else if (match[5] === 'trust') {
      // [[trust:level]] — legacy
      parts.push({ type: 'trust_legacy', content: match[6] });
    } else if (match[7] !== undefined) {
      // <div data-question-id="N">…</div> — legacy live embedded question chart
      parts.push({ type: 'question_embed', questionId: parseInt(match[7], 10) });
    } else if (match[8] !== undefined) {
      // <Question id={N}/> — new live embedded question chart (story-style)
      parts.push({ type: 'question_embed', questionId: parseInt(match[8], 10) });
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining text — but strip any incomplete XML tags (streaming)
  if (lastIndex < text.length) {
    let remaining = text.slice(lastIndex);
    remaining = remaining.replace(/<suggested_questions>[\s\S]*$/, '');
    remaining = remaining.replace(/<trust_info[\s\S]*$/, '');
    if (remaining.trim()) parts.push({ type: 'text', content: remaining });
  }

  return parts;
}
