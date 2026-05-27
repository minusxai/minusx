import React, { forwardRef, memo, useImperativeHandle, useMemo, useRef } from 'react';
import isEqual from 'lodash/isEqual';
import { useStableCallback, shallowEqualExcept } from '@/lib/hooks/use-stable-callback';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { Box } from '@chakra-ui/react';
import { MentionNode } from './lexical/MentionNode';
import { MentionsPlugin } from './lexical/MentionsPlugin';
import { EditorState, $getRoot, $createParagraphNode, $getSelection, $isRangeSelection, $createTextNode, COMMAND_PRIORITY_HIGH, KEY_ENTER_COMMAND, PASTE_COMMAND, LexicalEditor, FOCUS_COMMAND, BLUR_COMMAND, TextNode } from 'lexical';
import { useEffect } from 'react';
import { $createMentionNode, MentionData as MentionNodeData } from './lexical/MentionNode';
import type { ChatMentionData, DatabaseWithSchema, SkillMention, SlashCommand } from '@/lib/types';

interface LexicalMentionEditorProps {
  placeholder?: string;
  databaseName?: string;
  disabled?: boolean;
  onSubmit?: () => void;
  onChange?: (serialized: string) => void;
  singleLine?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  whitelistedSchemas?: DatabaseWithSchema[];
  availableSkills?: SkillMention[];
  availableCommands?: SlashCommand[];
  onCommandExecute?: (command: SlashCommand) => void;
}

export interface LexicalMentionEditorRef {
  focus: () => void;
  clear: () => void;
  setText: (text: string) => void;
  insertMention: (mentionData: ChatMentionData, triggerLength: number) => void;
}

// Module-scoped: avoids a fresh identity each render, which was flagging
// LexicalComposer's `initialConfig` as "Referentially unequal but deeply equal".
const editorTheme = {
  paragraph: 'editor-paragraph',
  text: {
    bold: 'editor-text-bold',
    italic: 'editor-text-italic',
  },
};

const EDITOR_NODES = [MentionNode];
const handleEditorError = (error: Error) => console.error(error);

// ContentEditable inline styles — hoisted so identity is stable across
// re-renders of the editor.
const SINGLE_LINE_STYLES: React.CSSProperties = {
  minHeight: '40px',
  maxHeight: '40px',
  overflow: 'hidden',
  outline: 'none',
  fontFamily: 'var(--font-jetbrains-mono), monospace',
  fontSize: '14px',
  padding: '8px 16px',
  display: 'flex',
  alignItems: 'center',
};
const MULTI_LINE_STYLES: React.CSSProperties = {
  minHeight: '72px',
  outline: 'none',
  fontFamily: 'monospace',
  fontSize: '14px',
  padding: '8px',
};

function OnSubmitPlugin({ onSubmit }: { onSubmit?: () => void }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent | null) => {
        if (event && !event.shiftKey && onSubmit) {
          event.preventDefault();
          onSubmit();

          // Clear editor after submit
          editor.update(() => {
            const root = $getRoot();
            root.clear();
            root.append($createParagraphNode());
          });

          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_HIGH
    );
  }, [editor, onSubmit]);

  return null;
}

function EditablePlugin({ disabled }: { disabled: boolean }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    // Update editor's editable state when disabled prop changes
    editor.setEditable(!disabled);
  }, [editor, disabled]);

  return null;
}

function PastePlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (event: ClipboardEvent) => {
        const clipboardData = event.clipboardData;
        if (!clipboardData) return false;

        const text = clipboardData.getData('text/plain');
        if (!text) return false;

        // Check if text contains mention patterns @{...}
        const mentionRegex = /@(\{.+?\})/g;
        if (!mentionRegex.test(text)) {
          // No mentions, let default paste behavior handle it
          return false;
        }

        // Parse and insert mentions
        event.preventDefault();

        editor.update(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return;

          // Parse text and create nodes
          const nodes = [];
          let lastIndex = 0;
          mentionRegex.lastIndex = 0; // Reset regex
          let match;

          while ((match = mentionRegex.exec(text)) !== null) {
            // Add text before mention
            if (match.index > lastIndex) {
              const textBefore = text.slice(lastIndex, match.index);
              nodes.push($createTextNode(textBefore));
            }

            // Parse mention JSON
            try {
              const mentionData = JSON.parse(match[1]) as MentionNodeData;
              nodes.push($createMentionNode(mentionData));
            } catch (e) {
              // If JSON parse fails, insert as text
              nodes.push($createTextNode(match[0]));
            }

            lastIndex = match.index + match[0].length;
          }

          // Add remaining text
          if (lastIndex < text.length) {
            nodes.push($createTextNode(text.slice(lastIndex)));
          }

          // Insert all nodes
          selection.insertNodes(nodes);
        });

        return true;
      },
      COMMAND_PRIORITY_HIGH
    );
  }, [editor]);

  return null;
}

function FocusPlugin({
  onFocus,
  onBlur,
  editorRef,
}: {
  onFocus?: () => void;
  onBlur?: () => void;
  editorRef: React.MutableRefObject<LexicalEditor | null>;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    // Store editor reference for external focus calls
    editorRef.current = editor;
  }, [editor, editorRef]);

  useEffect(() => {
    const unregisterFocus = editor.registerCommand(
      FOCUS_COMMAND,
      () => {
        onFocus?.();
        return false;
      },
      COMMAND_PRIORITY_HIGH
    );

    const unregisterBlur = editor.registerCommand(
      BLUR_COMMAND,
      () => {
        onBlur?.();
        return false;
      },
      COMMAND_PRIORITY_HIGH
    );

    return () => {
      unregisterFocus();
      unregisterBlur();
    };
  }, [editor, onFocus, onBlur]);

  return null;
}

/**
 * memo comparator: ignores callback identity (handled internally via stable
 * wrappers / the plugin-level ref pattern); deep-equals the data arrays that
 * callers tend to rebuild inline (`whitelistedSchemas`, `availableSkills`,
 * `availableCommands`). Pre-fix the trace showed 43/43 wasted renders here.
 */
const lexicalEditorPropsEqual = (prev: LexicalMentionEditorProps, next: LexicalMentionEditorProps): boolean => {
  if (!isEqual(prev.whitelistedSchemas, next.whitelistedSchemas)) return false;
  if (!isEqual(prev.availableSkills, next.availableSkills)) return false;
  if (!isEqual(prev.availableCommands, next.availableCommands)) return false;
  return shallowEqualExcept(prev, next, [
    'whitelistedSchemas', 'availableSkills', 'availableCommands',
    'onSubmit', 'onChange', 'onFocus', 'onBlur', 'onCommandExecute',
  ]);
};

const LexicalMentionEditorInner = forwardRef<LexicalMentionEditorRef, LexicalMentionEditorProps>(
  function LexicalMentionEditor(
    {
      placeholder = 'Ask a question...',
      databaseName,
      disabled = false,
      onSubmit,
      onChange,
      singleLine = false,
      onFocus,
      onBlur,
      whitelistedSchemas,
      availableSkills = [],
      availableCommands,
      onCommandExecute,
    },
    ref
  ) {
    const editorRef = useRef<LexicalEditor | null>(null);

    useImperativeHandle(ref, () => ({
      focus: () => {
        editorRef.current?.focus();
      },
      clear: () => {
        editorRef.current?.update(() => {
          const root = $getRoot();
          root.clear();
          root.append($createParagraphNode());
        });
      },
      setText: (text: string) => {
        editorRef.current?.update(() => {
          const root = $getRoot();
          root.clear();
          const paragraph = $createParagraphNode();
          paragraph.append($createTextNode(text));
          root.append(paragraph);
        });
      },
      insertMention: (mentionData: ChatMentionData, triggerLength: number) => {
        editorRef.current?.update(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return;

          const anchor = selection.anchor;
          const anchorNode = anchor.getNode();
          if (!(anchorNode instanceof TextNode)) return;

          const offset = anchor.offset;
          const text = anchorNode.getTextContent();
          anchorNode.setTextContent(text.slice(0, offset - triggerLength) + text.slice(offset));
          anchorNode.select(offset - triggerLength, offset - triggerLength);

          const newSelection = $getSelection();
          if ($isRangeSelection(newSelection)) {
            newSelection.insertNodes([$createMentionNode(mentionData), $createTextNode(' ')]);
          }
        });
      },
    }));

    // initialConfig's identity only matters when `disabled` flips — Lexical
    // reads it on mount but we want to keep the reference stable across
    // unrelated re-renders so LexicalComposer's memoisation works.
    const initialConfig = useMemo(() => ({
      namespace: 'MentionEditor',
      theme: editorTheme,
      onError: handleEditorError,
      nodes: EDITOR_NODES,
      editable: !disabled,
    }), [disabled]);

    // useStableCallback: handleChange identity stays constant so the
    // OnChangePlugin doesn't re-mount its listener every render. The wrapped
    // closure still reads the latest `onChange` prop.
    const handleChange = useStableCallback((editorState: EditorState) => {
      if (!onChange) return;

      editorState.read(() => {
        const root = $getRoot();
        const serialized = serializeEditorState(root);
        onChange(serialized);
      });
    });

    return (
      <Box position="relative" flex={singleLine ? 1 : undefined}>
        <LexicalComposer initialConfig={initialConfig}>
          <Box position="relative">
            <RichTextPlugin
              contentEditable={
                <ContentEditable style={singleLine ? SINGLE_LINE_STYLES : MULTI_LINE_STYLES} />
              }
              placeholder={
                <Box
                  position="absolute"
                  top={singleLine ? '50%' : 2}
                  left={singleLine ? 4 : 2}
                  transform={singleLine ? 'translateY(-50%)' : undefined}
                  color="fg.muted"
                  fontFamily="mono"
                  fontSize="sm"
                  pointerEvents="none"
                >
                  {placeholder}
                </Box>
              }
              ErrorBoundary={LexicalErrorBoundary}
            />
            <HistoryPlugin />
            <OnChangePlugin onChange={handleChange} />
            <OnSubmitPlugin onSubmit={onSubmit} />
            <EditablePlugin disabled={disabled} />
            <PastePlugin />
            <FocusPlugin onFocus={onFocus} onBlur={onBlur} editorRef={editorRef} />
            <MentionsPlugin databaseName={databaseName} whitelistedSchemas={whitelistedSchemas} availableSkills={availableSkills} availableCommands={availableCommands} onCommandExecute={onCommandExecute} />
          </Box>
        </LexicalComposer>
      </Box>
    );
  }
);

export const LexicalMentionEditor = memo(LexicalMentionEditorInner, lexicalEditorPropsEqual);

// Serialization helper
function serializeEditorState(root: any): string {
  const children = root.getChildren();
  const paragraphs: string[] = [];

  for (const child of children) {
    if (child.getType() === 'paragraph') {
      const parts: string[] = [];
      const paragraphChildren = child.getChildren();
      for (const node of paragraphChildren) {
        if (node.getType() === 'linebreak') {
          parts.push('\n');
        } else if (node.getType() === 'text') {
          parts.push(node.getTextContent());
        } else if (node.getType() === 'mention') {
          const mentionData = node.__mentionData;
          parts.push(`@${JSON.stringify(mentionData)}`);
        }
      }
      paragraphs.push(parts.join(''));
    }
  }

  return paragraphs.join('\n');
}
