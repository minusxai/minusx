'use client';

/**
 * SkillEditorCard - collapsible editor card for a single user-defined skill.
 * Extracted from ContextEditorV2 (Skills tab) — pure structural move, no
 * behavior change.
 */

import { Box, VStack, HStack, Button, Text, Badge, Field, Input, Collapsible, Icon, Switch } from '@chakra-ui/react';
import { memo, useState, useEffect, useCallback } from 'react';
import { LuTrash2, LuChevronDown, LuChevronRight } from 'react-icons/lu';
import type { SkillEntry } from '@/lib/types';
import Editor from '@monaco-editor/react';

const MONACO_READ_ONLY_MESSAGE = { value: 'Switch to edit mode to make changes.' };

interface SkillEditorCardProps {
  skill: SkillEntry;
  index: number;
  canManageSkills: boolean;
  colorMode: string;
  siblingNames: Set<string>;
  systemSkillNames: Set<string>;
  onUpdate: (index: number, updates: Partial<SkillEntry>) => void;
  onDelete: (index: number) => void;
}

export const SkillEditorCard = memo(function SkillEditorCard({
  skill,
  index,
  canManageSkills,
  colorMode,
  siblingNames,
  systemSkillNames,
  onUpdate,
  onDelete,
}: SkillEditorCardProps) {
  const [expanded, setExpanded] = useState(false);
  // Reset draft when skill prop changes externally — use a serialized key to detect changes
  const skillKey = `${skill.name}\0${skill.description}\0${skill.content}`;
  const [prevSkillKey, setPrevSkillKey] = useState(skillKey);
  const [draft, setDraft] = useState({
    name: skill.name,
    description: skill.description,
    content: skill.content,
  });

  if (prevSkillKey !== skillKey) {
    setPrevSkillKey(skillKey);
    setDraft({ name: skill.name, description: skill.description, content: skill.content });
  }

  useEffect(() => {
    if (
      draft.name === skill.name &&
      draft.description === skill.description &&
      draft.content === skill.content
    ) {
      return;
    }
    const timeout = window.setTimeout(() => {
      onUpdate(index, draft);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [draft, index, onUpdate, skill.content, skill.description, skill.name]);

  const flushDraft = useCallback(() => {
    if (
      draft.name !== skill.name ||
      draft.description !== skill.description ||
      draft.content !== skill.content
    ) {
      onUpdate(index, draft);
    }
  }, [draft, index, onUpdate, skill.content, skill.description, skill.name]);

  const normalizedName = draft.name.trim().toLowerCase();
  const duplicateName = siblingNames.has(normalizedName);
  const systemCollision = systemSkillNames.has(normalizedName);
  const invalidName = !/^[a-z0-9_]+$/.test(draft.name.trim()) || duplicateName || systemCollision;

  return (
    <Collapsible.Root open={expanded} onOpenChange={(e) => setExpanded(e.open)}>
      <Box border="1px solid" borderColor={invalidName ? 'accent.danger' : 'border.muted'} borderRadius="md" overflow="hidden">
        <Collapsible.Trigger asChild>
          <HStack
            px={3}
            py={2.5}
            justify="space-between"
            align="center"
            cursor="pointer"
            bg="bg.surface"
            _hover={{ bg: 'bg.muted' }}
          >
            <HStack gap={2} minW={0} flex={1}>
              <Icon as={expanded ? LuChevronDown : LuChevronRight} boxSize={4} color="fg.muted" flexShrink={0} />
              <Badge size="sm" colorPalette={skill.enabled ? 'green' : 'gray'} variant="subtle" flexShrink={0}>
                {skill.enabled ? 'Enabled' : 'Disabled'}
              </Badge>
              <Text fontSize="sm" fontFamily="mono" fontWeight="700" color="fg.default" truncate maxW="260px">
                {draft.name || 'unnamed_skill'}
              </Text>
              <Text fontSize="sm" color="fg.muted" truncate flex={1}>
                {draft.description || 'No description'}
              </Text>
              {invalidName && (
                <Text fontSize="xs" color="accent.danger" flexShrink={0}>
                  {duplicateName ? 'Duplicate name' : systemCollision ? 'Conflicts with system skill' : 'Invalid name'}
                </Text>
              )}
            </HStack>
            {canManageSkills && (
              <HStack gap={2} onClick={(event) => event.stopPropagation()} flexShrink={0}>
                <Switch.Root
                  size="sm"
                  checked={skill.enabled}
                  onCheckedChange={(e) => onUpdate(index, { enabled: e.checked })}
                  colorPalette="green"
                >
                  <Switch.HiddenInput />
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                </Switch.Root>
                <Button size="xs" variant="ghost" colorPalette="red" onClick={() => onDelete(index)}>
                  <LuTrash2 />
                </Button>
              </HStack>
            )}
          </HStack>
        </Collapsible.Trigger>
        <Collapsible.Content>
          <VStack align="stretch" gap={3} p={3} borderTop="1px solid" borderColor="border.muted">
            <HStack gap={3} align="start">
              <Field.Root flex={1} invalid={invalidName}>
                <Field.Label>Name</Field.Label>
                <Input
                  value={draft.name}
                  disabled={!canManageSkills}
                  onChange={(e) => setDraft(prev => ({ ...prev, name: e.target.value }))}
                  onBlur={flushDraft}
                  fontFamily="mono"
                />
              </Field.Root>
              <Field.Root flex={2}>
                <Field.Label>Description</Field.Label>
                <Input
                  value={draft.description}
                  disabled={!canManageSkills}
                  onChange={(e) => setDraft(prev => ({ ...prev, description: e.target.value }))}
                  onBlur={flushDraft}
                />
              </Field.Root>
            </HStack>

            <Box border="1px solid" borderColor="border.default" borderRadius="md" overflow="hidden">
              <Editor
                height="220px"
                language="markdown"
                value={draft.content}
                onChange={(value) => setDraft(prev => ({ ...prev, content: value || '' }))}
                onMount={(editor) => editor.onDidBlurEditorText(flushDraft)}
                theme={colorMode === 'dark' ? 'vs-dark' : 'light'}
                options={{
                  readOnly: !canManageSkills,
                  readOnlyMessage: MONACO_READ_ONLY_MESSAGE,
                  minimap: { enabled: false },
                  wordWrap: 'on',
                  lineNumbers: 'off',
                  fontSize: 13,
                  fontFamily: 'JetBrains Mono, monospace',
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                }}
              />
            </Box>
          </VStack>
        </Collapsible.Content>
      </Box>
    </Collapsible.Root>
  );
});
