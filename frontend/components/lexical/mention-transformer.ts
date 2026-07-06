/**
 * Mention markdown transformer for the docs Lexical editor.
 *
 * Docs are stored as plain markdown, and a mention of a table / question /
 * dashboard is serialized using the SAME format the chat input uses:
 *
 *     @{"type":"table","name":"orders","schema":"public","id":42}
 *
 * Reusing chat's format (and chat's `MentionNode`) keeps the two surfaces
 * consistent and lets the existing chat parsing/rendering apply unchanged.
 * This module adds the round-trip: a `MentionNode` exports to `@{json}`, and
 * `@{json}` in loaded markdown imports back into a `MentionNode`.
 */

import type { TextMatchTransformer } from '@lexical/markdown';
import type { LexicalNode, TextNode } from 'lexical';
import {
  MentionNode,
  $createMentionNode,
  $isMentionNode,
  type MentionData,
} from './MentionNode';

export const MENTION: TextMatchTransformer = {
  dependencies: [MentionNode],
  export: (node: LexicalNode) => {
    if (!$isMentionNode(node)) return null;
    return `@${JSON.stringify(node.__mentionData)}`;
  },
  // Lazy `{.+?}` stops at the first closing brace — mention JSON is flat
  // (type/name/schema/id), so it never contains nested braces.
  importRegExp: /@(\{.+?\})/,
  regExp: /@(\{.+?\})$/,
  replace: (textNode: TextNode, match: RegExpMatchArray) => {
    try {
      const data = JSON.parse(match[1]) as MentionData;
      textNode.replace($createMentionNode(data));
    } catch {
      // Malformed JSON — leave the text as-is rather than throw.
    }
  },
  trigger: '}',
  type: 'text-match',
};
