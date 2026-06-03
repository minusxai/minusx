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

import { Box, VStack, HStack, Button, Text, Badge, Collapsible, Icon, Switch } from '@chakra-ui/react';
import { useState, useRef, useCallback } from 'react';
import { LuTrash2, LuPlus, LuImage, LuChevronDown, LuChevronRight, LuCircleAlert } from 'react-icons/lu';
import Editor, { DiffEditor } from '@monaco-editor/react';
import type { DocEntry } from '@/lib/types';
import { uploadFile } from '@/lib/object-store/client';
import { toaster } from '@/components/ui/toaster';
import { useAppSelector } from '@/store/hooks';
import Markdown from '../Markdown';
import ChildPathSelector from '../ChildPathSelector';

const MONACO_READ_ONLY_MESSAGE = { value: 'Switch to edit mode to make changes.' };

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
  onChangeRef.current = onDocsChange;
  const docsRef = useRef(docs);
  docsRef.current = docs;
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
          const previewLine = docEntry.content.trim().split('\n')[0]?.slice(0, 80) || 'Empty';

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
                    py={2}
                    bg="bg.muted"
                    cursor="pointer"
                    _hover={{ bg: 'bg.emphasized' }}
                    {...(isDocExpanded ? { borderBottom: '1px solid', borderColor: 'border.default' } : {})}
                  >
                    <HStack justify="space-between">
                      <HStack gap={2}>
                        <Icon as={isDocExpanded ? LuChevronDown : LuChevronRight} boxSize={4} color="fg.muted" />
                        <Text fontSize="sm" fontWeight="600">
                          {entryLabel} {index + 1}
                        </Text>
                        {!isDocExpanded && (
                          <Text fontSize="xs" color="fg.muted" truncate maxW="400px">
                            {previewLine}
                          </Text>
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
