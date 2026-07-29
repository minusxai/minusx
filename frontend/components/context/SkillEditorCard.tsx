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
import LexicalTextEditor, { LexicalTextViewer, type MentionsConfig } from '@/components/lexical/LexicalTextEditor';
import { getUserSkillDisplayName, uniqueUserSkillName } from '@/lib/context/skill-utils';

interface SkillEditorCardProps {
  skill: SkillEntry;
  index: number;
  canManageSkills: boolean;
  initiallyExpanded?: boolean;
  mentions?: MentionsConfig;
  siblingNames: Set<string>;
  systemSkillNames: Set<string>;
  onUpdate: (index: number, updates: Partial<SkillEntry>) => void;
  onDelete: (index: number) => void;
}

export const SkillEditorCard = memo(function SkillEditorCard({
  skill,
  index,
  canManageSkills,
  initiallyExpanded = false,
  mentions,
  siblingNames,
  systemSkillNames,
  onUpdate,
  onDelete,
}: SkillEditorCardProps) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  // Reset draft when skill prop changes externally — use a serialized key to detect changes
  const displayName = getUserSkillDisplayName(skill);
  const skillKey = `${skill.name}\0${skill.displayName ?? ''}\0${skill.description}\0${skill.content}`;
  const [prevSkillKey, setPrevSkillKey] = useState(skillKey);
  const [draft, setDraft] = useState({
    displayName,
    description: skill.description,
    content: skill.content,
  });

  if (prevSkillKey !== skillKey) {
    setPrevSkillKey(skillKey);
    setDraft({ displayName, description: skill.description, content: skill.content });
  }

  useEffect(() => {
    if (
      draft.displayName === displayName &&
      draft.description === skill.description &&
      draft.content === skill.content
    ) {
      return;
    }
    const timeout = window.setTimeout(() => {
      onUpdate(index, draft);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [displayName, draft, index, onUpdate, skill.content, skill.description]);

  const flushDraft = useCallback(() => {
    if (
      draft.displayName !== displayName ||
      draft.description !== skill.description ||
      draft.content !== skill.content
    ) {
      onUpdate(index, draft);
    }
  }, [displayName, draft, index, onUpdate, skill.content, skill.description]);

  const canonicalName = uniqueUserSkillName(draft.displayName, [...siblingNames, ...systemSkillNames]);
  const invalidName = draft.displayName.trim().length === 0;

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
              <Text fontSize="sm" fontWeight="700" color="fg.default" truncate maxW="260px">
                {draft.displayName || 'Untitled skill'}
              </Text>
              <Text fontSize="xs" fontFamily="mono" color="fg.subtle" truncate flexShrink={0}>
                #{canonicalName}
              </Text>
              <Text fontSize="sm" color="fg.muted" truncate flex={1}>
                {draft.description || 'No description'}
              </Text>
              {invalidName && (
                <Text fontSize="xs" color="accent.danger" flexShrink={0}>
                  Name is required
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
                  aria-label={`Skill ${index + 1} name`}
                  value={draft.displayName}
                  disabled={!canManageSkills}
                  onChange={(e) => setDraft(prev => ({ ...prev, displayName: e.target.value }))}
                  onBlur={flushDraft}
                />
                <Text fontSize="2xs" color="fg.subtle" mt={1.5}>
                  Saved internally as <Text as="span" fontFamily="mono" fontWeight="600">#{canonicalName}</Text>
                </Text>
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

            <Box h="240px" border="1px solid" borderColor="border.default" borderRadius="md" overflow="hidden" bg="bg.panel">
              {canManageSkills ? (
                <LexicalTextEditor
                  initialMarkdown={draft.content}
                  onChange={(content) => setDraft(prev => ({ ...prev, content }))}
                  ariaLabel={`Skill ${index + 1} content`}
                  placeholder="Write the instructions this skill should provide…"
                  contentPadding="20px 20px"
                  mentions={mentions}
                  showProTip={false}
                />
              ) : (
                <LexicalTextViewer markdown={draft.content} padding="20px 20px" />
              )}
            </Box>
          </VStack>
        </Collapsible.Content>
      </Box>
    </Collapsible.Root>
  );
});
