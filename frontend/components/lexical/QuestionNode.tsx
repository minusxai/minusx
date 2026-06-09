'use client';

/**
 * QuestionNode — a Lexical DecoratorNode that embeds a MinusX question (chart)
 * inline in a report document. The node stores only the question id; the chart
 * is rendered live (and re-rendered as data changes) by SmartEmbeddedQuestionContainer.
 */

import { ReactNode } from 'react';
import {
  DecoratorNode,
  $getNodeByKey,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
  type LexicalEditor,
} from 'lexical';
import { Box, HStack, IconButton, Text } from '@chakra-ui/react';
import { LuScanSearch, LuTrash2 } from 'react-icons/lu';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection';
import SmartEmbeddedQuestionContainer from '@/components/containers/SmartEmbeddedQuestionContainer';
import { useAppSelector } from '@/store/hooks';

export type SerializedQuestionNode = Spread<
  { questionId: number },
  SerializedLexicalNode
>;

function QuestionEmbed({ questionId, nodeKey }: { questionId: number; nodeKey: NodeKey }) {
  const [editor] = useLexicalComposerContext();
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(nodeKey);
  const editable = editor.isEditable();
  const name = useAppSelector(state => state.files.files[questionId]?.name) || 'Question';

  const remove = () => {
    editor.update(() => {
      $getNodeByKey(nodeKey)?.remove();
    });
  };

  return (
    <Box
      my={4}
      borderWidth="1px"
      borderColor={isSelected && editable ? 'accent.primary' : 'border.default'}
      borderRadius="lg"
      overflow="hidden"
      bg="bg.surface"
      boxShadow="xs"
      position="relative"
      transition="border-color 0.15s"
      onClick={editable ? (e) => {
        e.stopPropagation();
        clearSelection();
        setSelected(true);
      } : undefined}
      css={editable ? { '&:hover .q-embed-tools': { opacity: 1 } } : undefined}
    >
      {/* Caption / controls */}
      <HStack
        justify="space-between"
        px={3}
        py={1.5}
        borderBottomWidth="1px"
        borderColor="border.muted"
        bg="bg.subtle"
      >
        <HStack gap={1.5} color="fg.muted" minW={0}>
          <LuScanSearch size={12} />
          <Text fontSize="xs" fontWeight={600} fontFamily="mono" lineClamp={1}>{name}</Text>
        </HStack>
        {editable && (
          <Box className="q-embed-tools" opacity={0} transition="opacity 0.15s">
            <IconButton
              aria-label="Remove chart"
              size="2xs"
              variant="ghost"
              color="fg.subtle"
              _hover={{ color: 'accent.danger', bg: 'accent.danger/10' }}
              onClick={(e) => { e.stopPropagation(); remove(); }}
            >
              <LuTrash2 size={13} />
            </IconButton>
          </Box>
        )}
      </HStack>

      {/* Live chart */}
      <Box height="340px" css={{ '& > div': { height: '100%' } }} pointerEvents={editable ? 'none' : 'auto'}>
        <SmartEmbeddedQuestionContainer questionId={questionId} showTitle={false} />
      </Box>
    </Box>
  );
}

export class QuestionNode extends DecoratorNode<ReactNode> {
  __questionId: number;

  static getType(): string {
    return 'question-embed';
  }

  static clone(node: QuestionNode): QuestionNode {
    return new QuestionNode(node.__questionId, node.__key);
  }

  constructor(questionId: number, key?: NodeKey) {
    super(key);
    this.__questionId = questionId;
  }

  getQuestionId(): number {
    return this.__questionId;
  }

  static importJSON(serialized: SerializedQuestionNode): QuestionNode {
    return new QuestionNode(serialized.questionId);
  }

  exportJSON(): SerializedQuestionNode {
    return {
      type: QuestionNode.getType(),
      version: 1,
      questionId: this.__questionId,
    };
  }

  createDOM(): HTMLElement {
    const div = document.createElement('div');
    div.style.display = 'block';
    return div;
  }

  updateDOM(): false {
    return false;
  }

  // Block-level embed (own line), not inline within a paragraph.
  isInline(): boolean {
    return false;
  }

  decorate(_editor: LexicalEditor): ReactNode {
    return <QuestionEmbed questionId={this.__questionId} nodeKey={this.__key} />;
  }
}

export function $createQuestionNode(questionId: number): QuestionNode {
  return new QuestionNode(questionId);
}

export function $isQuestionNode(node: LexicalNode | null | undefined): node is QuestionNode {
  return node instanceof QuestionNode;
}
