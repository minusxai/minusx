'use client';

/**
 * SkillEditorCard - collapsible editor card for a single user-defined skill.
 * Extracted from ContextEditorV2 (Skills tab) — pure structural move, no
 * behavior change.
 */

import { Box, VStack, HStack, Button, Text, Field, Input, Collapsible, Icon, Switch } from '@chakra-ui/react';
import { memo, useState, useEffect, useCallback } from 'react';
import { LuTrash2, LuChevronRight } from 'react-icons/lu';
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
      <Box
        role="group"
        border="1px solid"
        borderColor={invalidName ? 'accent.danger' : 'border.muted'}
        borderRadius="lg"
        overflow="hidden"
        bg={skill.enabled ? 'bg.panel' : 'bg.subtle'}
        transition="border-color 160ms ease, box-shadow 160ms ease"
        _hover={{
          borderColor: invalidName ? 'accent.danger' : skill.enabled ? 'accent.teal/40' : 'border.emphasized',
          boxShadow: 'xs',
        }}
      >
        <Collapsible.Trigger asChild>
          <HStack
            minH="68px"
            px={3.5}
            py={3}
            justify="space-between"
            align="center"
            gap={3}
            cursor="pointer"
          >
            <Box
              display="grid"
              placeItems="center"
              w="28px"
              h="28px"
              flexShrink={0}
              borderRadius="md"
              color={expanded ? 'accent.teal' : 'fg.muted'}
              bg={expanded ? 'accent.teal/10' : 'transparent'}
              transition="background 160ms ease, color 160ms ease"
              _groupHover={{ color: 'accent.teal' }}
            >
              <Icon
                as={LuChevronRight}
                boxSize={4}
                transform={expanded ? 'rotate(90deg)' : 'rotate(0deg)'}
                transition="transform 160ms ease"
              />
            </Box>

            <Box minW={0} flex={1} textAlign="left">
              <HStack gap={2} minW={0}>
                <Text fontSize="sm" fontWeight="700" color="fg.default" truncate>
                  {draft.displayName || 'Untitled skill'}
                </Text>
                {invalidName && (
                  <Text fontSize="2xs" color="accent.danger" flexShrink={0}>
                    Name is required
                  </Text>
                )}
              </HStack>
              <HStack gap={1.5} minW={0} mt={1}>
                <Text fontSize="2xs" fontFamily="mono" color="fg.subtle" truncate flexShrink={0}>
                  #{canonicalName}
                </Text>
                <Text aria-hidden="true" fontSize="xs" color="fg.subtle">·</Text>
                <Text fontSize="xs" color="fg.muted" truncate>
                  {draft.description || 'No description yet'}
                </Text>
              </HStack>
            </Box>

            {canManageSkills ? (
              <HStack
                gap={0}
                p={0.5}
                flexShrink={0}
                border="1px solid"
                borderColor="border.muted"
                borderRadius="full"
                bg="bg.muted"
                onClick={(event) => event.stopPropagation()}
              >
                <Box px={1.5} py={0.5}>
                  <Switch.Root
                    size="xs"
                    checked={skill.enabled}
                    onCheckedChange={(e) => onUpdate(index, { enabled: e.checked })}
                    colorPalette="teal"
                  >
                    <Switch.HiddenInput aria-label={`Skill ${draft.displayName || canonicalName} enabled`} />
                    <Switch.Control>
                      <Switch.Thumb />
                    </Switch.Control>
                    <Switch.Label
                      fontSize="2xs"
                      fontWeight="700"
                      color={skill.enabled ? 'accent.teal' : 'fg.muted'}
                    >
                      {skill.enabled ? 'Enabled' : 'Disabled'}
                    </Switch.Label>
                  </Switch.Root>
                </Box>
                <Box pl={0.5} borderLeft="1px solid" borderColor="border.default">
                  <Button
                    aria-label={`Delete skill ${draft.displayName || canonicalName}`}
                    size="xs"
                    variant="ghost"
                    borderRadius="full"
                    minW="26px"
                    w="26px"
                    h="26px"
                    p={0}
                    color="fg.muted"
                    _hover={{ color: 'accent.danger', bg: 'bg.panel' }}
                    onClick={() => onDelete(index)}
                  >
                    <Icon as={LuTrash2} boxSize={3} />
                  </Button>
                </Box>
              </HStack>
            ) : (
              <HStack gap={1.5} flexShrink={0} color="fg.muted">
                <Box
                  aria-hidden="true"
                  w="6px"
                  h="6px"
                  borderRadius="full"
                  bg={skill.enabled ? 'accent.teal' : 'fg.subtle'}
                />
                <Text fontSize="2xs" fontWeight="700">
                  {skill.enabled ? 'Enabled' : 'Disabled'}
                </Text>
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
