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

import { Box, VStack, HStack, Button, Text, Badge, Collapsible, Icon, Tabs } from '@chakra-ui/react';
import { LuBookOpen, LuPlus, LuChevronDown, LuChevronRight } from 'react-icons/lu';
import type { ContextContent, SkillEntry } from '@/lib/types';
import Editor from '@monaco-editor/react';
import { SkillEditorCard } from './SkillEditorCard';

const MONACO_READ_ONLY_MESSAGE = { value: 'Switch to edit mode to make changes.' };

interface SkillsTabContentProps {
  activeTab: 'picker' | 'yaml';
  colorMode: string;
  content: ContextContent;
  onChange: (updates: Partial<ContextContent>) => void;
  canManageSkills: boolean;
  systemSkills: { name: string; description: string }[];
  systemSkillNames: Set<string>;
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
  canManageSkills,
  systemSkills,
  systemSkillNames,
  userSkillsOpen,
  onUserSkillsOpenChange,
  systemSkillsOpen,
  onSystemSkillsOpenChange,
  onAddSkill,
  onUpdateSkill,
  onDeleteSkill,
}: SkillsTabContentProps) {
  return (
    <Tabs.Content value="skills">
      {activeTab === 'picker' ? (
        <VStack gap={4} align="stretch">
          <Collapsible.Root open={userSkillsOpen} onOpenChange={(e) => onUserSkillsOpenChange(e.open)}>
            <Box border="1px solid" borderColor="border.muted" borderRadius="md" p={3}>
              <Collapsible.Trigger asChild>
                <HStack mb={userSkillsOpen ? 3 : 0} justify="space-between" cursor="pointer">
                  <HStack gap={2}>
                    <Icon as={userSkillsOpen ? LuChevronDown : LuChevronRight} boxSize={4} color="fg.muted" />
                    <Text fontSize="xs" fontWeight="700" textTransform="uppercase" letterSpacing="wider" color="fg.muted">User Skills</Text>
                    <Badge size="xs" colorPalette="teal" variant="subtle">{content.skills?.length ?? 0}</Badge>
                  </HStack>
                  {canManageSkills && (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={(event) => {
                        event.stopPropagation();
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
                <VStack align="stretch" gap={3}>
                  {(content.skills || []).map((skill, index) => {
                    const siblingNames = new Set((content.skills || [])
                      .filter((_, otherIndex) => otherIndex !== index)
                      .map(other => other.name.trim().toLowerCase()));
                    return (
                      <SkillEditorCard
                        key={`skill-${index}`}
                        skill={skill}
                        index={index}
                        canManageSkills={canManageSkills}
                        colorMode={colorMode}
                        siblingNames={siblingNames}
                        systemSkillNames={systemSkillNames}
                        onUpdate={onUpdateSkill}
                        onDelete={onDeleteSkill}
                      />
                    );
                  })}
                  {(content.skills || []).length === 0 && (
                    <Text fontSize="sm" color="fg.muted">
                      No user-defined skills yet.
                    </Text>
                  )}
                </VStack>
              </Collapsible.Content>
            </Box>
          </Collapsible.Root>

          <Collapsible.Root open={systemSkillsOpen} onOpenChange={(e) => onSystemSkillsOpenChange(e.open)}>
            <Box border="1px solid" borderColor="border.muted" borderRadius="md" p={3}>
              <Collapsible.Trigger asChild>
                <HStack mb={systemSkillsOpen ? 3 : 0} justify="space-between" cursor="pointer">
                  <HStack gap={2}>
                    <Icon as={systemSkillsOpen ? LuChevronDown : LuChevronRight} boxSize={4} color="fg.muted" />
                    <Icon as={LuBookOpen} boxSize={4} color="fg.muted" />
                    <Text fontSize="xs" fontWeight="700" textTransform="uppercase" letterSpacing="wider" color="fg.muted">System Skills</Text>
                    <Badge size="xs" colorPalette="gray" variant="subtle">{systemSkills.length}</Badge>
                  </HStack>
                  <Badge size="xs" colorPalette="gray" variant="subtle">Read only</Badge>
                </HStack>
              </Collapsible.Trigger>
              <Collapsible.Content>
                <VStack align="stretch" gap={2}>
                  {systemSkills.map(skill => (
                    <Box key={skill.name} p={3} border="1px solid" borderColor="border.muted" borderRadius="md" bg="bg.subtle">
                      <Text fontSize="sm" fontFamily="mono" fontWeight="700" color="fg.default">{skill.name}</Text>
                      <Text fontSize="xs" color="fg.muted" mt={1}>{skill.description}</Text>
                    </Box>
                  ))}
                  {systemSkills.length === 0 && (
                    <Text fontSize="sm" color="fg.muted">System skills are not loaded yet.</Text>
                  )}
                </VStack>
              </Collapsible.Content>
            </Box>
          </Collapsible.Root>
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
