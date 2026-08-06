'use client';

/**
 * SkillsTabContent - the "Skills" tab body of ContextEditorV2: user-defined
 * skill cards, read-only system skills, and the raw JSON editor variant.
 * Extracted from ContextEditorV2 — pure structural move, no behavior change.
 *
 * NOTE: the collapsible open/closed state (`userSkillsOpen`/`systemSkillsOpen`)
 * is owned by the parent (not this component) because this tab unmounts/
 * remounts whenever the page is toggled between the visual picker and the
 * whole-file JSON/XML code view — keeping that state in the parent means it
 * survives the toggle, matching pre-extraction behavior.
 */

import { Box, VStack, HStack, Button, Text, Badge, Collapsible, Icon, IconButton, Input, Tabs, SimpleGrid } from '@chakra-ui/react';
import { useState } from 'react';
import {
  LuBell,
  LuBookOpen,
  LuBraces,
  LuChevronDown,
  LuChevronRight,
  LuCircleHelp,
  LuCompass,
  LuFileText,
  LuFiles,
  LuLayers3,
  LuLayoutDashboard,
  LuLockKeyhole,
  LuNotebookTabs,
  LuPlus,
  LuSearch,
  LuSlidersHorizontal,
  LuSparkles,
  LuX,
} from 'react-icons/lu';
import type { IconType } from 'react-icons';
import type { ContextContent, SkillEntry } from '@/lib/types';
import Editor from '@monaco-editor/react';
import { SkillEditorCard } from './SkillEditorCard';
import type { MentionsConfig } from '@/components/lexical/LexicalTextEditor';

const MONACO_READ_ONLY_MESSAGE = { value: 'Switch to edit mode to make changes.' };

const SYSTEM_SKILL_ICONS: Record<string, IconType> = {
  questions: LuCircleHelp,
  dashboards: LuLayoutDashboard,
  contexts: LuLayers3,
  semantic_models: LuBraces,
  reports: LuFileText,
  alerts: LuBell,
  parameters: LuSlidersHorizontal,
  app_guide: LuCompass,
  explore: LuSearch,
  large_file: LuFiles,
  stories: LuBookOpen,
  notebooks: LuNotebookTabs,
};

function SystemSkillTile({ skill }: { skill: { name: string; description: string } }) {
  const SkillIcon = SYSTEM_SKILL_ICONS[skill.name.toLowerCase()] ?? LuSparkles;

  return (
    <Box
      role="group"
      aria-label={`System skill ${skill.name}`}
      minH="88px"
      px={3.5}
      py={3}
      border="1px solid"
      borderColor="border.muted"
      borderRadius="lg"
      bg="bg.panel"
      transition="transform 160ms ease, border-color 160ms ease, background 160ms ease"
      _hover={{
        transform: 'translateY(-1px)',
        borderColor: 'accent.teal/40',
        bg: 'bg.subtle',
      }}
    >
      <HStack align="start" gap={3}>
        <Box
          display="grid"
          placeItems="center"
          w="38px"
          h="38px"
          flexShrink={0}
          border="1px solid"
          borderColor="accent.teal/20"
          borderRadius="md"
          bg="accent.teal/10"
          color="accent.teal"
          transition="background 160ms ease, color 160ms ease"
          _groupHover={{ bg: 'accent.teal/15' }}
        >
          <Icon as={SkillIcon} boxSize={4.5} />
        </Box>
        <Box minW={0} pt={0.5}>
          <Text
            fontSize="sm"
            fontFamily="mono"
            fontWeight="700"
            color="fg.default"
            lineHeight="1.25"
          >
            {skill.name}
          </Text>
          <Text
            fontSize="xs"
            color="fg.muted"
            mt={1.5}
            lineHeight="1.5"
            lineClamp={2}
          >
            {skill.description || 'Built-in product guidance.'}
          </Text>
        </Box>
      </HStack>
    </Box>
  );
}

interface SkillsTabContentProps {
  activeTab: 'picker' | 'yaml';
  colorMode: string;
  content: ContextContent;
  onChange: (updates: Partial<ContextContent>) => void;
  canAddSkill: boolean;
  canManageSkills: boolean;
  systemSkills: { name: string; description: string }[];
  systemSkillNames: Set<string>;
  mentions?: MentionsConfig;
  userSkillsOpen: boolean;
  onUserSkillsOpenChange: (open: boolean) => void;
  systemSkillsOpen: boolean;
  onSystemSkillsOpenChange: (open: boolean) => void;
  onAddSkill: () => void;
  onUpdateSkill: (index: number, updates: Partial<SkillEntry>) => void;
  onDeleteSkill: (index: number) => void;
}

export function SkillsTabContent({
  activeTab,
  colorMode,
  content,
  onChange,
  canAddSkill,
  canManageSkills,
  systemSkills,
  systemSkillNames,
  mentions,
  userSkillsOpen,
  onUserSkillsOpenChange,
  systemSkillsOpen,
  onSystemSkillsOpenChange,
  onAddSkill,
  onUpdateSkill,
  onDeleteSkill,
}: SkillsTabContentProps) {
  const [newlyAddedSkillIndex, setNewlyAddedSkillIndex] = useState<number | null>(null);
  const [skillQuery, setSkillQuery] = useState('');
  const normalizedSkillQuery = skillQuery.trim().toLowerCase().replace(/[_-]+/g, ' ');
  const isSearching = normalizedSkillQuery.length > 0;
  const matchesQuery = (...values: Array<string | undefined>) => !isSearching || values.some((value) => (
    value?.toLowerCase().replace(/[_-]+/g, ' ').includes(normalizedSkillQuery)
  ));
  const visibleUserSkills = (content.skills || [])
    .map((skill, index) => ({ skill, index }))
    .filter(({ skill }) => matchesQuery(skill.displayName, skill.name, skill.description));
  const visibleSystemSkills = systemSkills.filter((skill) => matchesQuery(skill.name, skill.description));
  const totalSkillCount = (content.skills?.length ?? 0) + systemSkills.length;
  const visibleSkillCount = visibleUserSkills.length + visibleSystemSkills.length;
  const hasNoMatches = isSearching && visibleSkillCount === 0;
  const userSkillsExpanded = isSearching || userSkillsOpen;
  const systemSkillsExpanded = isSearching || systemSkillsOpen;

  return (
    <Tabs.Content value="skills">
      {activeTab === 'picker' ? (
        <VStack gap={7} align="stretch">
          <HStack gap={3} align="center">
            <Box
              position="relative"
              flex="1"
              border="1px solid"
              borderColor="border.default"
              borderRadius="md"
              bg="bg.subtle"
              _focusWithin={{
                borderColor: 'accent.teal',
                boxShadow: '0 0 0 1px var(--chakra-colors-accent-teal)',
              }}
              transition="border-color 160ms ease, box-shadow 160ms ease"
            >
              <Icon
                as={LuSearch}
                position="absolute"
                left={3}
                top="50%"
                transform="translateY(-50%)"
                color="fg.muted"
                boxSize={4}
                pointerEvents="none"
              />
              <Input
                aria-label="Search skills"
                value={skillQuery}
                onChange={(event) => setSkillQuery(event.target.value)}
                placeholder="Search skills by name or description…"
                border="none"
                bg="transparent"
                fontFamily="mono"
                fontSize="sm"
                pl={9}
                pr={skillQuery ? 10 : 3}
                _focus={{ outline: 'none', boxShadow: 'none' }}
              />
              {skillQuery && (
                <IconButton
                  aria-label="Clear skill search"
                  position="absolute"
                  right={1.5}
                  top="50%"
                  transform="translateY(-50%)"
                  size="2xs"
                  variant="ghost"
                  color="fg.subtle"
                  onClick={() => setSkillQuery('')}
                  _hover={{ color: 'fg.default', bg: 'bg.muted' }}
                >
                  <LuX size={13} />
                </IconButton>
              )}
            </Box>
            {isSearching && (
              <Badge
                aria-label="Skill search results"
                size="sm"
                variant="subtle"
                colorPalette={hasNoMatches ? 'gray' : 'teal'}
                borderRadius="full"
                px={2.5}
                py={1}
                whiteSpace="nowrap"
              >
                {visibleSkillCount} of {totalSkillCount}
              </Badge>
            )}
          </HStack>

          {hasNoMatches && (
            <Box
              py={8}
              px={5}
              border="1px dashed"
              borderColor="border.default"
              borderRadius="lg"
              textAlign="center"
              bg="bg.subtle"
            >
              <Text fontSize="sm" fontWeight="700">No skills match “{skillQuery.trim()}”</Text>
              <Text fontSize="xs" color="fg.muted" mt={1}>Try another name or description.</Text>
              <Button size="xs" variant="ghost" colorPalette="teal" mt={3} onClick={() => setSkillQuery('')}>
                Clear search
              </Button>
            </Box>
          )}

          {!hasNoMatches && (!isSearching || visibleUserSkills.length > 0) && (
            <Collapsible.Root open={userSkillsExpanded} onOpenChange={(e) => onUserSkillsOpenChange(e.open)}>
              <Box>
                <Collapsible.Trigger asChild>
                  <HStack justify="space-between" cursor="pointer" gap={4}>
                    <HStack gap={3} minW={0}>
                      <Box
                        display="grid"
                        placeItems="center"
                        w="30px"
                        h="30px"
                        borderRadius="md"
                        bg="accent.teal/10"
                        color="accent.teal"
                        flexShrink={0}
                      >
                        <Icon as={userSkillsExpanded ? LuChevronDown : LuChevronRight} boxSize={4} />
                      </Box>
                      <Box minW={0} textAlign="left">
                        <HStack gap={2}>
                          <Text fontSize="sm" fontWeight="700" color="fg.default">Your skills</Text>
                          <Badge size="xs" colorPalette="teal" variant="subtle">
                            {isSearching ? visibleUserSkills.length : (content.skills?.length ?? 0)}
                          </Badge>
                        </HStack>
                        <Text fontSize="xs" color="fg.muted" mt={0.5} truncate>
                          Custom instructions maintained in this Knowledge Base.
                        </Text>
                      </Box>
                    </HStack>
                    {canAddSkill && (
                      <Button
                        aria-label="Add skill"
                        size="xs"
                        variant="outline"
                        onClick={(event) => {
                          event.stopPropagation();
                          setNewlyAddedSkillIndex(content.skills?.length ?? 0);
                          onAddSkill();
                        }}
                      >
                        <LuPlus />
                        Add skill
                      </Button>
                    )}
                  </HStack>
                </Collapsible.Trigger>
                <Collapsible.Content>
                  <VStack align="stretch" gap={3} pt={4}>
                    {visibleUserSkills.map(({ skill, index }) => {
                      const siblingNames = new Set((content.skills || [])
                        .filter((_, otherIndex) => otherIndex !== index)
                        .map(other => other.name.trim().toLowerCase()));
                      return (
                        <SkillEditorCard
                          key={`skill-${index}`}
                          skill={skill}
                          index={index}
                          canManageSkills={canManageSkills}
                          initiallyExpanded={index === newlyAddedSkillIndex}
                          mentions={mentions}
                          siblingNames={siblingNames}
                          systemSkillNames={systemSkillNames}
                          onUpdate={onUpdateSkill}
                          onDelete={onDeleteSkill}
                        />
                      );
                    })}
                    {!isSearching && (content.skills || []).length === 0 && (
                      <Text py={5} textAlign="center" fontSize="sm" color="fg.muted">
                        No custom skills yet.
                      </Text>
                    )}
                  </VStack>
                </Collapsible.Content>
              </Box>
            </Collapsible.Root>
          )}

          {!hasNoMatches && (!isSearching || visibleSystemSkills.length > 0) && (
            <Collapsible.Root open={systemSkillsExpanded} onOpenChange={(e) => onSystemSkillsOpenChange(e.open)}>
              <Box pt={5} borderTop="1px solid" borderColor="border.muted">
                <Collapsible.Trigger asChild>
                  <HStack justify="space-between" cursor="pointer" gap={4}>
                    <HStack gap={3} minW={0}>
                      <Box
                        display="grid"
                        placeItems="center"
                        w="30px"
                        h="30px"
                        borderRadius="md"
                        bg="bg.muted"
                        color="fg.muted"
                        flexShrink={0}
                      >
                        <Icon as={systemSkillsExpanded ? LuChevronDown : LuChevronRight} boxSize={4} />
                      </Box>
                      <Box minW={0} textAlign="left">
                        <HStack gap={2}>
                          <Text fontSize="sm" fontWeight="700" color="fg.default">System skills</Text>
                          <Badge size="xs" colorPalette="gray" variant="subtle">
                            {isSearching ? visibleSystemSkills.length : systemSkills.length}
                          </Badge>
                        </HStack>
                        <Text fontSize="xs" color="fg.muted" mt={0.5} truncate>
                          Built-in product knowledge maintained by MinusX.
                        </Text>
                      </Box>
                    </HStack>
                    <HStack gap={1.5} color="fg.subtle" flexShrink={0}>
                      <Icon as={LuLockKeyhole} boxSize={3} />
                      <Text fontSize="2xs" fontWeight="700" textTransform="uppercase" letterSpacing="wide">
                        Read only
                      </Text>
                    </HStack>
                  </HStack>
                </Collapsible.Trigger>
                <Collapsible.Content>
                  <SimpleGrid
                    aria-label="System skills catalog"
                    columns={{ base: 1, lg: 2 }}
                    gap={3}
                    pt={4}
                  >
                    {visibleSystemSkills.map(skill => (
                      <SystemSkillTile key={skill.name} skill={skill} />
                    ))}
                    {!isSearching && systemSkills.length === 0 && (
                      <Text fontSize="sm" color="fg.muted">System skills are not loaded yet.</Text>
                    )}
                  </SimpleGrid>
                </Collapsible.Content>
              </Box>
            </Collapsible.Root>
          )}
        </VStack>
      ) : (
        <Box
          border="1px solid"
          borderColor="border.default"
          borderRadius="md"
          overflow="hidden"
          minH="600px"
        >
          <Editor
            height="600px"
            language="json"
            value={JSON.stringify(content.skills || [], null, 2)}
            onChange={(value) => {
              try {
                const parsed = JSON.parse(value || '[]');
                if (Array.isArray(parsed)) onChange({ skills: parsed });
              } catch { /* ignore parse errors while typing */ }
            }}
            theme={colorMode === 'dark' ? 'vs-dark' : 'light'}
            options={{
              readOnly: !canManageSkills,
              readOnlyMessage: MONACO_READ_ONLY_MESSAGE,
              minimap: { enabled: false },
              wordWrap: 'on',
              lineNumbers: 'on',
              fontSize: 14,
              fontFamily: 'JetBrains Mono, monospace',
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 2,
            }}
          />
        </Box>
      )}
    </Tabs.Content>
  );
}
