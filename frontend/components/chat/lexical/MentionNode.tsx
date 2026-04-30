import React from 'react';
import { DecoratorNode, LexicalNode, NodeKey, SerializedLexicalNode, Spread } from 'lexical';
import { Box, Icon } from '@chakra-ui/react';
import { FILE_TYPE_METADATA, TABLE_MENTION_METADATA, ACCENT_HEX, getMentionColors } from '@/lib/ui/file-metadata';
import type { ChatMentionData } from '@/lib/types';

/**
 * Get chip metadata (icon, colors) for a mention based on its type.
 * Shared between MentionNode (editor) and MessageWithMentions (chat display).
 */
export function getMentionChipMetadata(
  data: ChatMentionData,
  colorMap: Record<string, string>,
) {
  if (data.type === 'table') {
    return {
      icon: TABLE_MENTION_METADATA.icon,
      colors: getMentionColors(TABLE_MENTION_METADATA.color),
    };
  }

  if (data.type === 'skill') {
    return {
      icon: null,
      colors: getMentionColors(ACCENT_HEX.teal),
    };
  }

  const fileMetadata = FILE_TYPE_METADATA[data.type as keyof typeof FILE_TYPE_METADATA];
  if (fileMetadata) {
    const hex = colorMap[fileMetadata.color] || ACCENT_HEX.muted;
    return {
      icon: fileMetadata.icon,
      colors: getMentionColors(hex),
    };
  }

  return {
    icon: null,
    colors: getMentionColors(ACCENT_HEX.muted),
  };
}

export type SerializedMentionNode = Spread<
  {
    mentionData: MentionData;
  },
  SerializedLexicalNode
>;

export class MentionNode extends DecoratorNode<React.ReactElement> {
  __mentionData: MentionData;

  static getType(): string {
    return 'mention';
  }

  static clone(node: MentionNode): MentionNode {
    return new MentionNode(node.__mentionData, node.__key);
  }

  constructor(mentionData: MentionData, key?: NodeKey) {
    super(key);
    this.__mentionData = mentionData;
  }

  createDOM(): HTMLElement {
    const span = document.createElement('span');
    span.setAttribute('data-lexical-mention', 'true');
    span.contentEditable = 'false';
    span.style.userSelect = 'none';
    return span;
  }

  isInline(): boolean {
    return true;
  }

  isKeyboardSelectable(): boolean {
    return false;
  }

  updateDOM(): boolean {
    return false;
  }

  decorate(): React.ReactElement {
    const data = this.__mentionData;
    const displayText = data.name;
    const metaText = data.type === 'table' ? data.schema : undefined;
    const isSkill = data.type === 'skill';

    const colorMap: Record<string, string> = {
      'accent.primary': ACCENT_HEX.primary,
      'accent.danger': ACCENT_HEX.danger,
      'accent.secondary': ACCENT_HEX.secondary,
      'accent.success': ACCENT_HEX.success,
      'accent.warning': ACCENT_HEX.warning,
      'accent.teal': ACCENT_HEX.teal,
      'accent.info': ACCENT_HEX.info,
      'accent.cyan': ACCENT_HEX.cyan,
      'accent.muted': ACCENT_HEX.muted,
    };

    const metadata = getMentionChipMetadata(data, colorMap);

    // Map mention type to Chakra semantic color token for the icon
    const iconColorToken = isSkill ? 'accent.teal'
      : data.type === 'table' ? 'accent.cyan'
      : data.type === 'question' ? 'accent.primary'
      : data.type === 'dashboard' ? 'accent.danger'
      : 'fg.muted';

    return (
      <Box
        as="span"
        display="inline"
        px="4px"
        py="2px"
        mx="1px"
        bg="bg.muted"
        borderRadius="sm"
        fontSize="0.85em"
        fontFamily="mono"
        lineHeight="inherit"
        color="fg.default"
        fontWeight="600"
        whiteSpace="nowrap"
      >
        <Box as="span" color={iconColorToken}>
          {isSkill ? '/' : metadata.icon ? <Icon as={metadata.icon} boxSize="0.85em" verticalAlign="-0.1em" /> : null}
        </Box>
        {' '}
        {metaText && (
          <Box as="span" color="fg.muted" fontWeight="500">{metaText}.</Box>
        )}
        {displayText}
      </Box>
    );
  }

  static importJSON(serializedNode: SerializedMentionNode): MentionNode {
    return new MentionNode(serializedNode.mentionData);
  }

  exportJSON(): SerializedMentionNode {
    return {
      mentionData: this.__mentionData,
      type: 'mention',
      version: 1,
    };
  }

  getTextContent(): string {
    // For plain text export
    const data = this.__mentionData;
    return data.type === 'table'
      ? `@${data.schema}.${data.name}`
      : `@@${data.name}`;
  }
}

export function $createMentionNode(mentionData: MentionData): MentionNode {
  return new MentionNode(mentionData);
}

export function $isMentionNode(node: LexicalNode | null | undefined): node is MentionNode {
  return node instanceof MentionNode;
}

export type MentionData = ChatMentionData;
