import React from 'react';
import { DecoratorNode, LexicalNode, NodeKey, SerializedLexicalNode, Spread } from 'lexical';
import { Box, Icon } from '@chakra-ui/react';
import { FILE_TYPE_METADATA, TABLE_MENTION_METADATA, ACCENT_HEX, getMentionColors } from '@/lib/ui/file-metadata';

export interface MentionData {
  id?: number;
  name: string;
  schema?: string;
  type: 'table' | 'question' | 'dashboard';
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
    const displayText = data.type === 'table'
      ? `${data.schema}.${data.name}`
      : data.name;

    // Map semantic token to hex value
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

    // Get metadata based on mention type
    const getMentionMetadata = () => {
      if (data.type === 'table') {
        return {
          label: TABLE_MENTION_METADATA.label,
          icon: TABLE_MENTION_METADATA.icon,
          colors: getMentionColors(TABLE_MENTION_METADATA.color),
        };
      }

      // Type assertion since we know 'question' and 'dashboard' are valid keys
      const fileMetadata = FILE_TYPE_METADATA[data.type as keyof typeof FILE_TYPE_METADATA];
      if (fileMetadata) {
        const hex = colorMap[fileMetadata.color] || ACCENT_HEX.muted;
        return {
          label: fileMetadata.label.charAt(0).toUpperCase(),
          icon: fileMetadata.icon,
          colors: getMentionColors(hex),
        };
      }

      // Fallback
      return {
        label: '?',
        icon: null,
        colors: getMentionColors(ACCENT_HEX.muted),
      };
    };

    const metadata = getMentionMetadata();

    return (
      <Box
        as="span"
        display="inline-flex"
        alignItems="center"
        px={1.5}
        py={0.5}
        mx={0.5}
        bg={metadata.colors.bg}
        color={metadata.colors.color}
        borderRadius="sm"
        fontSize="sm"
        fontWeight="600"
        border="1px solid"
        borderColor={metadata.colors.border}
      >
        <Box
          as="span"
          display="inline-flex"
          alignItems="center"
          px={1}
          py={0.5}
          bg={metadata.colors.labelBg}
          color="white"
          borderRadius="sm"
          fontSize="2xs"
          fontWeight="700"
          mr={1}
          gap={0.5}
        >
          {metadata.icon && <Icon as={metadata.icon} boxSize={2.5} />}
          {metadata.label}
        </Box>
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
