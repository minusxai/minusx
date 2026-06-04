'use client';

/**
 * ContextDocsEditor — the reusable "Docs" list extracted from ContextEditorV2.
 *
 * Renders inherited (read-only) docs plus the editable multi-entry collapsible
 * list (per-entry markdown editor + preview/diff, draft toggle, child-path
 * selector, image upload, add/remove). It is fully controlled: it takes a
 * `docs` array and emits the next array via `onDocsChange`.
 *
 * Both the context file editor (ContextEditorV2) and the onboarding wizard
 * (StepContext) render this so the docs UX stays identical in both places.
 * Feature flags let the lighter onboarding surface hide concepts that only make
 * sense on a saved context (draft state, child paths, diff).
 */

import { Box, VStack, HStack, Button, Text, Badge, Collapsible, Icon, Switch, Input } from '@chakra-ui/react';
import { useState, useRef, useEffect, useCallback } from 'react';
import { LuTrash2, LuPlus, LuImage, LuChevronDown, LuChevronRight, LuCircleAlert } from 'react-icons/lu';
import Editor, { DiffEditor } from '@monaco-editor/react';
import type { DocEntry } from '@/lib/types';
import { uploadFile } from '@/lib/object-store/client';
import { toaster } from '@/components/ui/toaster';
import { useAppSelector } from '@/store/hooks';
import Markdown from '../Markdown';
import ChildPathSelector from '../ChildPathSelector';

const MONACO_READ_ONLY_MESSAGE = { value: 'Switch to edit mode to make changes.' };

/**
 * Inline-edit styling: the field reads as plain text (transparent border/bg),
 * and only reveals an editable affordance — a soft tinted fill — on hover and
 * focus. Two scales: a bold `title` and a muted `description` subtitle.
 */
const INLINE_FIELD_BASE = {
  border: '1px solid',
  borderColor: 'transparent',
  bg: 'transparent',
  borderRadius: 'md',
  outline: 'none',
  transition: 'background 0.12s ease, border-color 0.12s ease',
  _hover: { bg: 'bg.emphasized' },
  _focusVisible: { bg: 'bg.subtle', borderColor: 'border.emphasized', outline: 'none', boxShadow: 'none' },
  _placeholder: { color: 'fg.subtle', fontWeight: 'normal' },
  _disabled: { opacity: 1, cursor: 'default', _hover: { bg: 'transparent' } },
} as const;

const INLINE_TITLE_STYLE = { ...INLINE_FIELD_BASE, h: 7, px: 1.5, fontSize: 'sm', fontWeight: '600' } as const;
const INLINE_DESC_STYLE = { ...INLINE_FIELD_BASE, h: 6, px: 1.5, fontSize: 'xs', color: 'fg.muted' } as const;

/**
 * An uncontrolled text input that lets the DOM own the buffer while typing and
 * only commits upward on blur — so persisting `onDocsChange` (which writes the
 * whole file) doesn't fire on every keystroke. Keying on `value` remounts the
 * field when it changes externally (e.g. entry reindex after add/remove),
 * re-seeding `defaultValue`.
 */
function DocTextField({
  value,
  onCommit,
  ...inputProps
}: { value: string; onCommit: (next: string) => void } & React.ComponentProps<typeof Input>) {
  return (
    <Input
      {...inputProps}
      key={value}
      defaultValue={value}
      onBlur={(e) => { if (e.target.value !== value) onCommit(e.target.value); }}
    />
  );
}

interface ContextDocsEditorProps {
  /** Editable doc entries (controlled). */
  docs: DocEntry[];
  /** Emits the next docs array (edits are debounced, structural ops immediate). */
  onDocsChange: (docs: DocEntry[]) => void;
  /** Inherited docs from parent contexts — rendered read-only above the list. */
  inheritedDocs?: DocEntry[];
  /** Saved docs for the diff view (per index). */
  originalDocs?: DocEntry[];
  /** Child folder paths offered by the child-path selector. */
  availableChildPaths?: string[];
  editMode?: boolean;
  editorHeight?: string;
  entryLabel?: string;
  addButtonLabel?: string;
  helperText?: string;
  showInheritedDocs?: boolean;
  showEmptyWarning?: boolean;
  showHelperText?: boolean;
  showAddButton?: boolean;
  showDraftToggle?: boolean;
  showChildPaths?: boolean;
  showImageUpload?: boolean;
  /** Show the optional per-entry title + description inputs. */
  showTitleDescription?: boolean;
  /** Seed for the (uncontrolled) expanded set. Default: first entry open. */
  defaultExpandedIndices?: number[];
  /** Controlled expanded indices. When provided, the parent owns expand/collapse. */
  expandedIndices?: number[];
  onExpandedChange?: (indices: number[]) => void;
}

export default function ContextDocsEditor({
  docs,
  onDocsChange,
  inheritedDocs,
  originalDocs,
  availableChildPaths = [],
  editMode = true,
  editorHeight = '500px',
  entryLabel = 'Documentation Entry',
  addButtonLabel = 'Add Documentation Entry',
  helperText = 'Add notes and documentation about the databases',
  showInheritedDocs = true,
  showEmptyWarning = true,
  showHelperText = true,
  showAddButton = true,
  showDraftToggle = true,
  showChildPaths = true,
  showImageUpload = true,
  showTitleDescription = true,
  defaultExpandedIndices,
  expandedIndices,
  onExpandedChange,
}: ContextDocsEditorProps) {
  const colorMode = useAppSelector((state) => state.ui.colorMode);

  // Expanded set is uncontrolled by default (first entry open), but a parent can
  // take control by passing `expandedIndices` + `onExpandedChange`.
  const [internalExpanded, setInternalExpanded] = useState<Set<number>>(() => new Set(defaultExpandedIndices ?? [0]));
  const isExpandedControlled = expandedIndices !== undefined;
  const expandedDocs = isExpandedControlled ? new Set(expandedIndices) : internalExpanded;
  // null = editor + preview side by side, 'editor' = editor only, 'preview' = preview only, 'diff' = diff
  const [docViewModes, setDocViewModes] = useState<Record<number, 'editor' | 'preview' | 'diff' | null>>({});

  // One hidden file input shared across all doc entries for image upload
  const imageUploadInputRef = useRef<HTMLInputElement>(null);
  const imageUploadTargetIndex = useRef<number | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const docEditorRefs = useRef<Record<number, any>>({});

  // Debounced markdown edits — Monaco owns its buffer, so we read latest docs via ref.
  const onChangeRef = useRef(onDocsChange);
  const docsRef = useRef(docs);
  useEffect(() => {
    onChangeRef.current = onDocsChange;
    docsRef.current = docs;
  });
  const markdownTimerRef = useRef<NodeJS.Timeout | null>(null);

  const toggleDoc = (index: number) => {
    const next = new Set(expandedDocs);
    if (next.has(index)) { next.delete(index); } else { next.add(index); }
    if (isExpandedControlled) {
      onExpandedChange?.(Array.from(next));
    } else {
      setInternalExpanded(next);
    }
  };

  const setDocViewMode = (index: number, mode: 'editor' | 'preview' | 'diff' | null) => {
    setDocViewModes(prev => ({ ...prev, [index]: mode }));
  };

  const handleMarkdownChange = useCallback((index: number, newMarkdown: string) => {
    if (markdownTimerRef.current) clearTimeout(markdownTimerRef.current);
    markdownTimerRef.current = setTimeout(() => {
      const currentDocs = docsRef.current || [];
      const newDocs = [...currentDocs];
      newDocs[index] = { ...newDocs[index], content: newMarkdown };
      onChangeRef.current(newDocs);
    }, 300);
  }, []);

  const handleAddDoc = () => {
    onDocsChange([...(docs || []), { content: '' }]);
  };

  const handleRemoveDoc = (index: number) => {
    onDocsChange((docs || []).filter((_, i) => i !== index));
  };

  const handleToggleDraft = (index: number) => {
    const newDocs = [...(docs || [])];
    newDocs[index] = { ...newDocs[index], draft: !newDocs[index].draft };
    onDocsChange(newDocs);
  };

  const handleChildPathsChange = (index: number, childPaths: string[] | undefined) => {
    const newDocs = [...(docs || [])];
    newDocs[index] = { ...newDocs[index], childPaths };
    onDocsChange(newDocs);
  };

  // Empty title/description normalize to undefined so "not given" stays clean.
  const handleTitleChange = (index: number, value: string) => {
    const newDocs = [...(docs || [])];
    newDocs[index] = { ...newDocs[index], title: value.trim() === '' ? undefined : value };
    onDocsChange(newDocs);
  };

  const handleDescriptionChange = (index: number, value: string) => {
    const newDocs = [...(docs || [])];
    newDocs[index] = { ...newDocs[index], description: value.trim() === '' ? undefined : value };
    onDocsChange(newDocs);
  };

  const handleImageUploadClick = useCallback((index: number) => {
    imageUploadTargetIndex.current = index;
    imageUploadInputRef.current?.click();
  }, []);

  const handleImageFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || imageUploadTargetIndex.current === null) return;
    const targetIndex = imageUploadTargetIndex.current;
    try {
      const { publicUrl } = await uploadFile(file);
      const markdownSnippet = `![${file.name}](${publicUrl})`;
      const editor = docEditorRefs.current[targetIndex];
      if (editor) {
        const selection = editor.getSelection();
        editor.executeEdits('image-upload', [{ range: selection, text: markdownSnippet }]);
        editor.focus();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to upload image';
      toaster.create({ title: message, type: 'error' });
    }
  }, []);

  const previewMaxH = editorHeight;

  return (
    <Box>
      {/* Hidden file input shared across all markdown editors for image upload */}
      {showImageUpload && (
        <input
          aria-label="Upload image to insert in documentation"
          type="file"
          accept="image/*"
          ref={imageUploadInputRef}
          style={{ display: 'none' }}
          onChange={handleImageFileSelect}
        />
      )}

      {showEmptyWarning && (!docs || docs.length === 0) && (
        <HStack gap={1} color="accent.warning" mb={3}>
          <LuCircleAlert size={16} />
          <Text fontSize="sm" fontWeight="500">No documentation added</Text>
        </HStack>
      )}
      {showHelperText && (
        <Text fontSize="sm" color="fg.muted" mb={3}>
          {helperText}
        </Text>
      )}

      {/* Inherited docs (read-only) */}
      {showInheritedDocs && inheritedDocs && inheritedDocs.length > 0 && (
        <Box mb={4}>
          <Text fontSize="sm" fontWeight="600" color="fg.muted" mb={2}>
            Inherited Documentation (from parent contexts)
          </Text>
          <VStack gap={2} align="stretch">
            {inheritedDocs.map((docEntry, idx) => (
              <Box
                key={`inherited-${idx}`}
                p={3}
                border="1px solid"
                borderColor="border.default"
                borderRadius="md"
                bg="bg.muted"
                opacity={0.7}
              >
                {docEntry.title?.trim() && (
                  <Text fontSize="sm" fontWeight="600" mb={1}>{docEntry.title}</Text>
                )}
                {docEntry.description?.trim() && (
                  <Text fontSize="xs" color="fg.muted" mb={2}>{docEntry.description}</Text>
                )}
                <Markdown context="mainpage">{docEntry.content}</Markdown>
              </Box>
            ))}
          </VStack>
        </Box>
      )}

      {/* Own docs (editable) */}
      <VStack gap={4} align="stretch">
        {(docs || []).map((docEntry, index) => {
          const isDocExpanded = expandedDocs.has(index);
          const hasDiff = originalDocs?.[index] != null && originalDocs[index].content !== docEntry.content;
          const rawDocView = docViewModes[index] ?? null;
          const docView = rawDocView === 'diff' && !hasDiff ? null : rawDocView;
          const previewLine = docEntry.description?.trim()
            || docEntry.content.trim().split('\n')[0]?.slice(0, 80)
            || 'Empty';

          return (
            <Box
              key={index}
              border="1px solid"
              borderColor={docEntry.draft ? 'border.muted' : 'border.default'}
              borderRadius="md"
              overflow="hidden"
              opacity={docEntry.draft ? 0.6 : 1}
            >
              {/* Collapsible header */}
              <Collapsible.Root open={isDocExpanded} onOpenChange={() => toggleDoc(index)}>
                <Collapsible.Trigger asChild>
                  <Box
                    aria-label={`Toggle ${entryLabel} ${index + 1}`}
                    px={3}
                    py={showTitleDescription ? 1.5 : 2}
                    bg="bg.muted"
                    cursor="pointer"
                    _hover={{ bg: 'bg.emphasized' }}
                    {...(isDocExpanded ? { borderBottom: '1px solid', borderColor: 'border.default' } : {})}
                  >
                    <HStack justify="space-between" gap={2}>
                      <HStack gap={2} flex={1} minW={0}>
                        <Icon as={isDocExpanded ? LuChevronDown : LuChevronRight} boxSize={4} color="fg.muted" flexShrink={0} />
                        {showTitleDescription && editMode ? (
                          // Inline-editable title + description. stopPropagation so
                          // clicking/typing here doesn't toggle the collapsible.
                          <VStack gap={0} align="stretch" flex={1} minW={0} onClick={(e) => e.stopPropagation()}>
                            <DocTextField
                              {...INLINE_TITLE_STYLE}
                              aria-label={`${entryLabel} ${index + 1} title`}
                              placeholder="Add title"
                              value={docEntry.title ?? ''}
                              onCommit={(v) => handleTitleChange(index, v)}
                            />
                            <DocTextField
                              {...INLINE_DESC_STYLE}
                              aria-label={`${entryLabel} ${index + 1} description`}
                              placeholder="Add a description"
                              value={docEntry.description ?? ''}
                              onCommit={(v) => handleDescriptionChange(index, v)}
                            />
                          </VStack>
                        ) : showTitleDescription ? (
                          // Read-only: title and description on one line — "Title - description".
                          <HStack gap={2} flex={1} minW={0}>
                            <Text fontSize="sm" fontWeight="600" flexShrink={0}>
                              {docEntry.title?.trim() || `${entryLabel} ${index + 1}`}
                            </Text>
                            {docEntry.description?.trim() && (
                              <>
                                <Text fontSize="xs" color="fg.subtle" flexShrink={0}>·</Text>
                                <Text fontSize="xs" color="fg.muted" truncate>
                                  {docEntry.description}
                                </Text>
                              </>
                            )}
                          </HStack>
                        ) : (
                          <>
                            <Text fontSize="sm" fontWeight="600">
                              {docEntry.title?.trim() || `${entryLabel} ${index + 1}`}
                            </Text>
                            {!isDocExpanded && (
                              <Text fontSize="xs" color="fg.muted" truncate maxW="400px">
                                {previewLine}
                              </Text>
                            )}
                          </>
                        )}
                      </HStack>
                      <HStack gap={3} onClick={(e) => e.stopPropagation()}>
                        {showDraftToggle && (
                          <HStack gap={1.5}>
                            <Badge size="sm" colorPalette={docEntry.draft ? 'yellow' : 'green'} variant="subtle">
                              {docEntry.draft ? 'Draft' : 'Active'}
                            </Badge>
                            <Switch.Root
                              size="sm"
                              checked={!docEntry.draft}
                              onCheckedChange={() => handleToggleDraft(index)}
                              colorPalette="green"
                            >
                              <Switch.HiddenInput />
                              <Switch.Control>
                                <Switch.Thumb />
                              </Switch.Control>
                            </Switch.Root>
                          </HStack>
                        )}
                        <Button
                          aria-label={`Remove ${entryLabel} ${index + 1}`}
                          size="xs"
                          variant="ghost"
                          colorPalette="red"
                          onClick={() => handleRemoveDoc(index)}
                        >
                          <LuTrash2 />
                        </Button>
                      </HStack>
                    </HStack>
                  </Box>
                </Collapsible.Trigger>
                <Collapsible.Content>
                  {/* childPaths selector */}
                  {showChildPaths && (
                    <Box px={3} py={2} bg="bg.muted" borderBottom="1px solid" borderColor="border.default">
                      <ChildPathSelector
                        availablePaths={availableChildPaths}
                        selectedPaths={docEntry.childPaths}
                        onChange={(paths) => handleChildPathsChange(index, paths)}
                      />
                    </Box>
                  )}

                  {/* Toolbar: view mode + image upload */}
                  <HStack px={3} py={1.5} bg="bg.muted" borderBottom="1px solid" borderColor="border.default" gap={1} justify="space-between">
                    <HStack gap={1}>
                      <Button
                        size="xs"
                        variant={docView === 'editor' ? 'solid' : 'ghost'}
                        onClick={() => setDocViewMode(index, docView === 'editor' ? null : 'editor')}
                      >
                        Editor
                      </Button>
                      <Button
                        size="xs"
                        variant={docView === 'preview' ? 'solid' : 'ghost'}
                        onClick={() => setDocViewMode(index, docView === 'preview' ? null : 'preview')}
                      >
                        Preview
                      </Button>
                      {originalDocs?.[index] != null && (
                        <Button
                          size="xs"
                          variant={docView === 'diff' ? 'solid' : 'ghost'}
                          onClick={() => setDocViewMode(index, docView === 'diff' ? null : 'diff')}
                          disabled={!hasDiff}
                        >
                          Diff
                        </Button>
                      )}
                    </HStack>
                    {showImageUpload && (
                      <Button
                        aria-label="Upload image"
                        size="xs"
                        variant="ghost"
                        onClick={() => handleImageUploadClick(index)}
                        title="Insert image"
                      >
                        <LuImage />
                        Image
                      </Button>
                    )}
                  </HStack>

                  {/* Preview-only mode */}
                  {docView === 'preview' && (
                    <Box p={4} minH={editorHeight} maxH={editorHeight} overflowY="auto">
                      {docEntry.content.trim() ? (
                        <Markdown context="mainpage">{docEntry.content}</Markdown>
                      ) : (
                        <Text color="fg.muted" fontSize="sm">No content to preview.</Text>
                      )}
                    </Box>
                  )}

                  {/* Editor (always mounted, hidden in preview-only mode) + optional side panel */}
                  <HStack gap={0} align="stretch" display={docView === 'preview' ? 'none' : 'flex'}>
                    <Box flex={1} minW={0}>
                      <Editor
                        height={editorHeight}
                        language="markdown"
                        value={docEntry.content}
                        onChange={(value) => handleMarkdownChange(index, value || '')}
                        onMount={(editor) => { docEditorRefs.current[index] = editor; }}
                        theme={colorMode === 'dark' ? 'vs-dark' : 'light'}
                        options={{
                          readOnly: !editMode,
                          readOnlyMessage: MONACO_READ_ONLY_MESSAGE,
                          minimap: { enabled: false },
                          wordWrap: 'on',
                          lineNumbers: 'on',
                          fontSize: 14,
                          fontFamily: 'var(--font-jetbrains-mono)',
                          scrollBeyondLastLine: false,
                          automaticLayout: true,
                          tabSize: 2,
                        }}
                      />
                    </Box>
                    {/* Default (null) mode: editor + preview side by side */}
                    {docView === null && (
                      <Box
                        flex={1}
                        p={3}
                        bg="bg.muted"
                        maxH={previewMaxH}
                        overflowY="auto"
                        borderLeft="1px solid"
                        borderColor="border.default"
                        minW={0}
                      >
                        {docEntry.content.trim() ? (
                          <Markdown context="mainpage">{docEntry.content}</Markdown>
                        ) : (
                          <Text color="fg.muted" fontSize="sm">Preview will appear here...</Text>
                        )}
                      </Box>
                    )}
                    {/* Diff mode: editor + diff side by side */}
                    {originalDocs?.[index] && (
                      <Box
                        flex={1}
                        borderLeft="1px solid"
                        borderColor="border.default"
                        minW={0}
                        display={docView === 'diff' ? 'block' : 'none'}
                      >
                        <DiffEditor
                          height={editorHeight}
                          language="markdown"
                          original={originalDocs[index].content}
                          modified={docEntry.content}
                          theme={colorMode === 'dark' ? 'vs-dark' : 'light'}
                          keepCurrentOriginalModel
                          keepCurrentModifiedModel
                          options={{
                            minimap: { enabled: false },
                            wordWrap: 'on',
                            fontSize: 14,
                            fontFamily: 'var(--font-jetbrains-mono)',
                            scrollBeyondLastLine: false,
                            automaticLayout: true,
                            readOnly: true,
                            renderSideBySide: false,
                          }}
                        />
                      </Box>
                    )}
                  </HStack>
                </Collapsible.Content>
              </Collapsible.Root>
            </Box>
          );
        })}

        {/* Add doc button */}
        {showAddButton && (
          <Button
            aria-label={addButtonLabel}
            size="sm"
            variant="outline"
            onClick={handleAddDoc}
          >
            <LuPlus />
            {addButtonLabel}
          </Button>
        )}
      </VStack>
    </Box>
  );
}
