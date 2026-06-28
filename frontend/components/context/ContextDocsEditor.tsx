'use client';

/**
 * ContextDocsEditor — the reusable "Docs" list extracted from ContextEditorV2.
 *
 * Renders inherited (read-only) docs plus the editable multi-entry collapsible
 * list (per-entry WYSIWYG markdown editor, draft toggle, child-path selector,
 * image upload, @ mentions, add/remove). It is fully controlled: it takes a
 * `docs` array and emits the next array via `onDocsChange`.
 *
 * Editing uses the Lexical WYSIWYG editor (the editing surface IS the rendered
 * preview), so there is no separate editor/preview toggle. When a saved baseline
 * exists, a "Diff" button reveals a read-only Monaco markdown diff on demand.
 *
 * Both the context file editor (ContextEditorV2) and the onboarding wizard
 * (StepContext) render this so the docs UX stays identical in both places.
 * Feature flags let the lighter onboarding surface hide concepts that only make
 * sense on a saved context (draft state, child paths, diff).
 */

import { Box, VStack, HStack, Button, Text, Badge, Collapsible, Icon, Switch, Input } from '@chakra-ui/react';
import { useState, useRef, useEffect, useCallback } from 'react';
import { LuTrash2, LuPlus, LuChevronDown, LuChevronRight, LuCircleAlert } from 'react-icons/lu';
import { DiffEditor } from '@monaco-editor/react';
import type { DocEntry } from '@/lib/types';
import { PER_DOC_CONTENT_CHARS, isDocContentOverLimit } from '@/lib/context/context-budgets';
import { uploadFile } from '@/lib/object-store/client';
import { toaster } from '@/components/ui/toaster';
import { useAppSelector } from '@/store/hooks';
import LexicalTextEditor, { LexicalTextViewer, type MentionsConfig } from '@/components/lexical/LexicalTextEditor';
import ChildPathSelector from '../ChildPathSelector';
import { GenerateButton } from '@/components/ui/GenerateButton';
import { runMicroTaskClient } from '@/lib/api/micro-task';

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
  /** Emits the next docs array (markdown edits are debounced by the editor, structural ops immediate). */
  onDocsChange: (docs: DocEntry[]) => void;
  /** Inherited docs from parent contexts — rendered read-only above the list. */
  inheritedDocs?: DocEntry[];
  /** Saved docs for the diff view (per index). */
  originalDocs?: DocEntry[];
  /** Child folder paths offered by the child-path selector. */
  availableChildPaths?: string[];
  /** Enables the @ / @@ mention typeahead (tables, questions, dashboards). */
  mentions?: MentionsConfig;
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
  /** Show the per-entry "Always include" (pin) toggle. */
  showAlwaysIncludeToggle?: boolean;
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
  mentions,
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
  showAlwaysIncludeToggle = true,
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
  // Which entries currently show the read-only Monaco diff (vs the WYSIWYG editor).
  const [diffOpen, setDiffOpen] = useState<Record<number, boolean>>({});
  // Inherited docs are collapsed by default (empty set); expand on click.
  const [expandedInherited, setExpandedInherited] = useState<Set<number>>(() => new Set());

  // The editor owns its buffer while typing, so we read the latest docs via ref
  // when an entry's markdown changes and write the whole array back.
  const onChangeRef = useRef(onDocsChange);
  const docsRef = useRef(docs);
  useEffect(() => {
    onChangeRef.current = onDocsChange;
    docsRef.current = docs;
  });

  const toggleDoc = (index: number) => {
    const next = new Set(expandedDocs);
    if (next.has(index)) { next.delete(index); } else { next.add(index); }
    if (isExpandedControlled) {
      onExpandedChange?.(Array.from(next));
    } else {
      setInternalExpanded(next);
    }
  };

  const toggleDiff = (index: number) => {
    setDiffOpen(prev => ({ ...prev, [index]: !prev[index] }));
  };

  const toggleInherited = (index: number) => {
    setExpandedInherited(prev => {
      const next = new Set(prev);
      if (next.has(index)) { next.delete(index); } else { next.add(index); }
      return next;
    });
  };

  const handleMarkdownChange = useCallback((index: number, newMarkdown: string) => {
    const currentDocs = docsRef.current || [];
    if (currentDocs[index]?.content === newMarkdown) return;
    const newDocs = [...currentDocs];
    newDocs[index] = { ...newDocs[index], content: newMarkdown };
    onChangeRef.current(newDocs);
  }, []);

  // Upload an image and return its public URL for the editor to embed inline.
  const handleImageUpload = useCallback(async (file: File): Promise<string> => {
    try {
      const { publicUrl } = await uploadFile(file);
      return publicUrl;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to upload image';
      toaster.create({ title: message, type: 'error' });
      return '';
    }
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

  // "Always include" pins a doc inline in the agent's prompt every turn. When off
  // (default), the doc is loaded on demand via LoadContext — so it needs a title
  // to be addressable (see the per-entry title warning below).
  const handleToggleAlwaysInclude = (index: number) => {
    const newDocs = [...(docs || [])];
    newDocs[index] = { ...newDocs[index], alwaysInclude: !newDocs[index].alwaysInclude };
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

  // Per-entry "Auto" generation: summarize THIS doc's body into a title /
  // description via the micro-task agent. Keyed by index; writes through the refs
  // so a concurrent edit elsewhere isn't clobbered (same pattern as markdown).
  const [genBusy, setGenBusy] = useState<Record<string, boolean>>({});
  const generateField = useCallback(
    async (index: number, field: 'title' | 'description') => {
      const content = (docsRef.current?.[index]?.content ?? '').trim();
      if (!content) return;
      const busyKey = `${index}:${field}`;
      setGenBusy((b) => ({ ...b, [busyKey]: true }));
      try {
        // The analytics agent only sees each doc's title + description (not the
      // body); it decides whether to LoadContext the full doc from those. So bias
      // generation toward "is this doc relevant to my task?" signal.
      const instructions =
        field === 'description'
          ? 'IMPORTANT: Only this title and description are shown to the analytics agent — it uses them to decide whether to load the full document. Write the description so the agent can tell exactly when this document is relevant: name the topics, tables, metrics, or questions it covers.'
          : 'IMPORTANT: The analytics agent loads documents on demand from their title and description alone. Make the title clearly signal the topic so the agent knows when to load this document.';
      const value = await runMicroTaskClient(field, { input: content, subject: 'a knowledge base document', instructions });
        const newDocs = [...(docsRef.current || [])];
        newDocs[index] = { ...newDocs[index], [field]: value };
        onChangeRef.current(newDocs);
      } catch (err) {
        console.error(`[ContextDocsEditor] failed to generate ${field}:`, err);
      } finally {
        setGenBusy((b) => ({ ...b, [busyKey]: false }));
      }
    },
    [],
  );

  return (
    <Box>
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

      {/* Inherited docs (read-only) — rendered through the Lexical viewer so
          mentions and images display the same as in the editable entries. */}
      {showInheritedDocs && inheritedDocs && inheritedDocs.length > 0 && (
        <Box mb={4}>
          <Text fontSize="sm" fontWeight="600" color="fg.muted" mb={2}>
            Inherited Documentation (from parent contexts)
          </Text>
          <VStack gap={2} align="stretch">
            {inheritedDocs.map((docEntry, idx) => {
              const isString = typeof docEntry === 'string';
              const title = (!isString && docEntry.title?.trim()) || '';
              const description = (!isString && docEntry.description?.trim()) || '';
              const content = isString ? docEntry : docEntry.content;
              const isOpen = expandedInherited.has(idx);
              return (
                <Box
                  key={`inherited-${idx}`}
                  border="1px solid"
                  borderColor="border.default"
                  borderRadius="md"
                  bg="bg.muted"
                  opacity={0.7}
                  overflow="hidden"
                >
                  <Collapsible.Root open={isOpen} onOpenChange={() => toggleInherited(idx)}>
                    <Collapsible.Trigger asChild>
                      <Box
                        aria-label={`Toggle inherited documentation ${idx + 1}`}
                        px={3}
                        py={2}
                        cursor="pointer"
                        _hover={{ bg: 'bg.emphasized' }}
                        {...(isOpen ? { borderBottom: '1px solid', borderColor: 'border.default' } : {})}
                      >
                        <HStack gap={2} align="center" flex={1} minW={0}>
                          <Icon as={isOpen ? LuChevronDown : LuChevronRight} boxSize={4} color="fg.muted" flexShrink={0} />
                          <Text fontSize="sm" fontWeight="600" flexShrink={0}>{title || `Inherited Documentation ${idx + 1}`}</Text>
                          {description && (
                            <>
                              <Text fontSize="xs" color="fg.subtle" flexShrink={0}>·</Text>
                              <Text fontSize="xs" color="fg.muted" truncate>{description}</Text>
                            </>
                          )}
                        </HStack>
                      </Box>
                    </Collapsible.Trigger>
                    <Collapsible.Content>
                      <Box px={3} py={3}>
                        <LexicalTextViewer key={content} markdown={content} padding="0" />
                      </Box>
                    </Collapsible.Content>
                  </Collapsible.Root>
                </Box>
              );
            })}
          </VStack>
        </Box>
      )}

      {/* Separator + heading distinguishing this context's own docs from inherited ones */}
      {showInheritedDocs && inheritedDocs && inheritedDocs.length > 0 && (
        <Box borderTop="1px solid" borderColor="border.default" mb={4} pt={4}>
          <Text fontSize="sm" fontWeight="600" color="fg.muted">
            This context&apos;s documentation
          </Text>
        </Box>
      )}

      {/* Own docs (editable) */}
      <VStack gap={4} align="stretch">
        {(docs || []).map((docEntry, index) => {
          const isDocExpanded = expandedDocs.has(index);
          // Active docs need a title + description (the agent loads them by title);
          // also flag duplicate titles so they stay distinguishable. Drafts are
          // exempt (excluded from the agent until activated).
          const trimmedTitle = docEntry.title?.trim() ?? '';
          const trimmedDesc = docEntry.description?.trim() ?? '';
          const needsMeta = !docEntry.draft;
          const duplicateTitle = trimmedTitle !== '' && (docs || []).some(
            (d, i) => i !== index && (d.title?.trim() ?? '') === trimmedTitle,
          );
          const docTitleWarning = !needsMeta ? null
            : (!trimmedTitle && !trimmedDesc) ? 'Add a title and description — both are required to save an active doc.'
            : !trimmedTitle ? 'Add a title — required to save an active doc.'
            : !trimmedDesc ? 'Add a description — required to save an active doc.'
            : duplicateTitle ? 'Another doc has this title — the agent may not be able to tell them apart. Use a unique title.'
            : null;
          const savedContent = originalDocs?.[index]?.content;
          const hasDiff = savedContent != null && savedContent !== docEntry.content;
          const isDiffOpen = !!diffOpen[index] && hasDiff;
          const previewLine = docEntry.description?.trim()
            || docEntry.content.trim().split('\n')[0]?.slice(0, 80)
            || 'Empty';
          // Remount the editor only when the saved baseline changes (version switch
          // / save) or the entry reindexes — never on keystrokes, which would drop
          // the cursor. When there's no baseline (e.g. onboarding), key on index.
          const editorKey = `doc-${index}-${editMode ? 'edit' : 'view'}-${savedContent ?? ''}`;

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
                            <HStack gap={1} align="center">
                              <DocTextField
                                {...INLINE_TITLE_STYLE}
                                flex="1"
                                aria-label={`${entryLabel} ${index + 1} title`}
                                placeholder="Add title"
                                value={docEntry.title ?? ''}
                                onCommit={(v) => handleTitleChange(index, v)}
                              />
                              {!docEntry.title?.trim() && docEntry.content?.trim() && (
                                <GenerateButton
                                  label={`Generate title for entry ${index + 1}`}
                                  loading={!!genBusy[`${index}:title`]}
                                  onClick={() => generateField(index, 'title')}
                                />
                              )}
                            </HStack>
                            <HStack gap={1} align="center">
                              <DocTextField
                                {...INLINE_DESC_STYLE}
                                flex="1"
                                aria-label={`${entryLabel} ${index + 1} description`}
                                placeholder="Add a description"
                                value={docEntry.description ?? ''}
                                onCommit={(v) => handleDescriptionChange(index, v)}
                              />
                              {!docEntry.description?.trim() && docEntry.content?.trim() && (
                                <GenerateButton
                                  label={`Generate description for entry ${index + 1}`}
                                  loading={!!genBusy[`${index}:description`]}
                                  onClick={() => generateField(index, 'description')}
                                />
                              )}
                            </HStack>
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
                        {showAlwaysIncludeToggle && (
                          <HStack gap={1.5} title="When on, this doc is always included in the agent's prompt. When off, the agent loads it on demand by title.">
                            <Badge size="sm" colorPalette={docEntry.alwaysInclude ? 'blue' : 'gray'} variant="subtle">
                              {docEntry.alwaysInclude ? 'Always on' : 'On demand'}
                            </Badge>
                            <Switch.Root
                              size="sm"
                              aria-label={`${entryLabel} ${index + 1} always include`}
                              checked={!!docEntry.alwaysInclude}
                              onCheckedChange={() => handleToggleAlwaysInclude(index)}
                              colorPalette="blue"
                            >
                              <Switch.HiddenInput />
                              <Switch.Control>
                                <Switch.Thumb />
                              </Switch.Control>
                            </Switch.Root>
                          </HStack>
                        )}
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
                  {/* Title addressability warning for on-demand (lazy) docs. */}
                  {editMode && showAlwaysIncludeToggle && docTitleWarning && (
                    <HStack px={3} py={2} gap={2} bg="bg.muted" borderBottom="1px solid" borderColor="border.default" color="fg.muted">
                      <Icon as={LuCircleAlert} boxSize={3.5} color="orange.fg" flexShrink={0} />
                      <Text fontSize="xs">{docTitleWarning}</Text>
                    </HStack>
                  )}
                  {/* childPaths selector — only when there are child folders to assign. */}
                  {showChildPaths && availableChildPaths.length > 0 && (
                    <Box px={3} py={2} bg="bg.muted" borderBottom="1px solid" borderColor="border.default">
                      <ChildPathSelector
                        availablePaths={availableChildPaths}
                        selectedPaths={docEntry.childPaths}
                        onChange={(paths) => handleChildPathsChange(index, paths)}
                      />
                    </Box>
                  )}

                  {/* Body: read-only viewer, on-demand Monaco diff, or the WYSIWYG editor.
                      The Diff toggle lives in the editor's own toolbar row (no extra bar). */}
                  {!editMode ? (
                    <Box maxH={editorHeight} overflowY="auto">
                      {docEntry.content.trim() ? (
                        <LexicalTextViewer key={editorKey} markdown={docEntry.content} />
                      ) : (
                        <Text p={4} color="fg.muted" fontSize="sm">No content.</Text>
                      )}
                    </Box>
                  ) : isDiffOpen ? (
                    <Box height={editorHeight} display="flex" flexDirection="column">
                      <HStack px={2} py={1} justify="flex-end" borderBottomWidth="1px" borderColor="border.default" bg="bg.muted" flexShrink={0}>
                        <Button size="xs" variant="solid" onClick={() => toggleDiff(index)}>Diff</Button>
                      </HStack>
                      <Box flex={1} minH={0}>
                        <DiffEditor
                          height="100%"
                          language="markdown"
                          original={originalDocs?.[index]?.content ?? ''}
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
                    </Box>
                  ) : (
                    <Box height={editorHeight}>
                      <LexicalTextEditor
                        key={editorKey}
                        initialMarkdown={docEntry.content}
                        onChange={(markdown) => handleMarkdownChange(index, markdown)}
                        onImageUpload={showImageUpload ? handleImageUpload : undefined}
                        mentions={mentions}
                        insertMenu
                        editWithAgent={{ editorKind: 'richtext', fileName: docEntry.title?.trim() || `doc ${index + 1}`, blockId: `doc-${index}` }}
                        renderToolbar={originalDocs?.[index] != null ? (toolbar) => (
                          <HStack justify="space-between" borderBottomWidth="1px" borderColor="border.default" bg="bg.muted" flexShrink={0} pr={2}>
                            <Box flex={1} minW={0}>{toolbar}</Box>
                            <Button size="xs" variant="ghost" onClick={() => toggleDiff(index)} disabled={!hasDiff}>Diff</Button>
                          </HStack>
                        ) : undefined}
                      />
                    </Box>
                  )}
                  {(() => {
                    const len = docEntry.content?.length ?? 0;
                    const over = isDocContentOverLimit(docEntry.content ?? '');
                    return (
                      <HStack justify="flex-end" px={2} pt={1}>
                        <Text
                          fontSize="2xs"
                          color={over ? 'accent.danger' : 'fg.subtle'}
                          fontWeight={over ? '600' : '400'}
                          aria-label={`${entryLabel} ${index + 1} character count`}
                        >
                          {len.toLocaleString()} / {PER_DOC_CONTENT_CHARS.toLocaleString()} chars
                          {over ? ' — too long to save' : ''}
                        </Text>
                      </HStack>
                    );
                  })()}
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
