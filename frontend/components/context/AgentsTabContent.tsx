'use client';

/**
 * AgentsTabContent — the "Agents" tab body of ContextEditorV2: user-defined
 * custom agents (AgentEntry on the context content), the minimal multi-step
 * builder (AgentBuilder), inherited agents (fullAgents, read-only), and the
 * raw JSON editor variant. Structure mirrors SkillsTabContent.
 */

import { useState } from 'react';
import { Badge, Box, Button, HStack, Icon, SimpleGrid, Switch, Tabs, Text, VStack } from '@chakra-ui/react';
import { LuPencil, LuPlus, LuTrash2 } from 'react-icons/lu';
import type { AgentEntry, ContextContent } from '@/lib/types';
import { mergeSkillsByName } from '@/lib/context/context-utils';
import { getUserSkillDisplayName } from '@/lib/context/skill-utils';
import Editor from '@monaco-editor/react';
import { AgentBuilder } from './AgentBuilder';
import { AgentReadView, type AgentDraft } from './AgentReadView';
import type { MentionsConfig } from '@/components/lexical/LexicalTextEditor';

const MONACO_READ_ONLY_MESSAGE = { value: 'Switch to edit mode to make changes.' };

interface AgentsTabContentProps {
  activeTab: 'picker' | 'yaml';
  colorMode: string;
  content: ContextContent;
  onChange: (updates: Partial<ContextContent>) => void;
  canAddAgent: boolean;
  canManageAgents: boolean;
  systemSkills: { name: string; description: string }[];
  mentions?: MentionsConfig;
  onStartAddAgent: () => void;
  onAddAgent: (draft: AgentDraft) => void;
  onUpdateAgent: (index: number, updates: Partial<AgentEntry>) => void;
  onDeleteAgent: (index: number) => void;
}

type BuilderState = { mode: 'new' } | { mode: 'edit'; index: number } | null;

export function AgentsTabContent({
  activeTab,
  colorMode,
  content,
  onChange,
  canAddAgent,
  canManageAgents,
  systemSkills,
  mentions,
  onStartAddAgent,
  onAddAgent,
  onUpdateAgent,
  onDeleteAgent,
}: AgentsTabContentProps) {
  const [builder, setBuilder] = useState<BuilderState>(null);
  const agents = content.agents || [];
  const inheritedAgents = content.fullAgents || [];
  const userSkills = mergeSkillsByName(content.fullSkills || [], content.skills || [])
    .filter((skill) => skill.enabled)
    .map((skill) => ({
      name: skill.name,
      displayName: getUserSkillDisplayName(skill),
      description: skill.description,
    }));

  // React's prop-derived state adjustment: page-level Cancel flips this flag
  // outside the tab, so clear any nested builder in the same render cycle.
  const [previousCanManageAgents, setPreviousCanManageAgents] = useState(canManageAgents);
  if (previousCanManageAgents !== canManageAgents) {
    setPreviousCanManageAgents(canManageAgents);
    if (!canManageAgents && builder !== null) setBuilder(null);
  }

  const handleSave = (draft: AgentDraft) => {
    if (builder?.mode === 'edit') {
      onUpdateAgent(builder.index, draft);
    } else {
      onAddAgent(draft);
    }
    setBuilder(null);
  };

  return (
    <Tabs.Content value="agents">
      {activeTab === 'picker' ? (
        <VStack gap={4} align="stretch" fontFamily="mono">
          {builder ? (
            <AgentBuilder
              initial={builder.mode === 'edit' ? agents[builder.index] : undefined}
              systemSkills={systemSkills}
              userSkills={userSkills}
              mentions={mentions}
              onSave={handleSave}
              onCancel={() => setBuilder(null)}
            />
          ) : (
            <>
              <HStack justify="space-between" align="end" gap={4}>
                <Box>
                  <HStack gap={2}>
                    <Text fontSize="xs" fontWeight="700" textTransform="uppercase" letterSpacing="0.12em" color="fg.muted">
                      Custom agents
                    </Text>
                    <Badge size="xs" colorPalette="teal" variant="subtle">{agents.length}</Badge>
                  </HStack>
                  <Text fontSize="sm" color="fg.subtle" mt={1}>
                    Personas available to everyone using this Knowledge Base.
                  </Text>
                </Box>
                {canAddAgent && (
                  <Button
                    aria-label="Add agent"
                    size="xs"
                    variant="outline"
                    borderColor="accent.teal"
                    color="accent.teal"
                    onClick={() => {
                      onStartAddAgent();
                      setBuilder({ mode: 'new' });
                    }}
                  >
                    <LuPlus />
                    Add agent
                  </Button>
                )}
              </HStack>

              {agents.length > 0 && (
                <SimpleGrid aria-label="Agent roster" columns={{ base: 1, xl: 2 }} gap={4} alignItems="stretch">
                  {agents.map((agent, index) => (
                    <Box
                      key={`agent-${index}`}
                      role="group"
                      aria-label={`Agent ${agent.name}`}
                      position="relative"
                      overflow="hidden"
                      border="1px solid"
                      borderColor="border.default"
                      borderRadius="xl"
                      bg={agent.enabled ? 'bg.panel' : 'bg.subtle'}
                      p={4}
                      boxShadow="sm"
                      transition="transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease"
                      _hover={{
                        transform: 'translateY(-2px)',
                        boxShadow: 'md',
                        borderColor: agent.enabled ? 'accent.teal/45' : 'border.default',
                      }}
                    >
                      <AgentReadView
                        agent={agent}
                        compact
                        muted={!agent.enabled}
                        headerEnd={(
                          <HStack
                            align="center"
                            gap={0.5}
                            p={0.5}
                            border="1px solid"
                            borderColor="border.muted"
                            borderRadius="full"
                            bg="bg.muted"
                          >
                            {canManageAgents ? (
                              <Box
                                px={1.5}
                                py={0.5}
                              >
                                <Switch.Root
                                  size="xs"
                                  colorPalette="teal"
                                  checked={agent.enabled}
                                  onCheckedChange={(e) => onUpdateAgent(index, { enabled: e.checked })}
                                >
                                  <Switch.HiddenInput aria-label={`Agent ${agent.name} enabled`} />
                                  <Switch.Control>
                                    <Switch.Thumb />
                                  </Switch.Control>
                                  <Switch.Label fontSize="2xs" fontWeight="700" color={agent.enabled ? 'accent.teal' : 'fg.muted'}>
                                    {agent.enabled ? 'Published' : 'Draft'}
                                  </Switch.Label>
                                </Switch.Root>
                              </Box>
                            ) : (
                              <Badge
                                size="xs"
                                variant="plain"
                                bg="transparent"
                                color={agent.enabled ? 'accent.teal' : 'fg.muted'}
                                borderRadius="full"
                                px={2}
                              >
                                {agent.enabled ? 'Published' : 'Draft'}
                              </Badge>
                            )}
                            {canManageAgents && (
                              <HStack
                                gap={0}
                                pl={0.5}
                                borderLeft="1px solid"
                                borderColor="border.default"
                              >
                                <Button
                                  aria-label={`Edit agent ${agent.name}`}
                                  size="xs"
                                  variant="ghost"
                                  borderRadius="full"
                                  minW="26px"
                                  w="26px"
                                  h="26px"
                                  p={0}
                                  color="fg.muted"
                                  _hover={{ color: 'accent.teal', bg: 'bg.subtle' }}
                                  onClick={() => setBuilder({ mode: 'edit', index })}
                                >
                                  <Icon as={LuPencil} boxSize={3} />
                                </Button>
                                <Button
                                  aria-label={`Delete agent ${agent.name}`}
                                  size="xs"
                                  variant="ghost"
                                  borderRadius="full"
                                  minW="26px"
                                  w="26px"
                                  h="26px"
                                  p={0}
                                  colorPalette="red"
                                  onClick={() => onDeleteAgent(index)}
                                >
                                  <Icon as={LuTrash2} boxSize={3} />
                                </Button>
                              </HStack>
                            )}
                          </HStack>
                        )}
                      />
                    </Box>
                  ))}
                </SimpleGrid>
              )}
              {agents.length === 0 && (
                <Box
                  border="1px dashed"
                  borderColor="border.default"
                  borderRadius="xl"
                  py={10}
                  px={6}
                  textAlign="center"
                  bg="bg.subtle"
                >
                  <Box
                    display="inline-flex"
                    alignItems="center"
                    justifyContent="center"
                    w="64px"
                    h="64px"
                    mb={4}
                    borderRadius="22px 22px 22px 8px"
                    bg="accent.teal/12"
                    color="accent.teal"
                    fontSize="2xl"
                    fontWeight="800"
                    transform="rotate(-3deg)"
                  >
                    AI
                  </Box>
                  <Text fontSize="md" fontWeight="700">Create your first specialist</Text>
                  <Text fontSize="sm" color="fg.muted" mt={1} maxW="520px" mx="auto">
                    Give a focused persona its own instructions and skill set. It will appear in the agent picker for this Knowledge Base.
                  </Text>
                </Box>
              )}

              {inheritedAgents.length > 0 && (
                <Box borderTop="1px solid" borderColor="border.muted" pt={5} mt={2}>
                  <HStack gap={2} mb={3}>
                    <Text fontSize="xs" fontWeight="700" textTransform="uppercase" letterSpacing="0.12em" color="fg.muted">
                      Inherited agents
                    </Text>
                    <Badge size="xs" colorPalette="gray" variant="subtle">Read only</Badge>
                  </HStack>
                  <SimpleGrid columns={{ base: 1, xl: 2 }} gap={3}>
                    {inheritedAgents.map((agent) => (
                      <HStack
                        key={agent.name}
                        aria-label={`Inherited agent ${agent.name}`}
                        align="start"
                        gap={3}
                        p={4}
                        border="1px solid"
                        borderColor="border.muted"
                        borderRadius="lg"
                        bg="bg.subtle"
                      >
                        <Box
                          display="flex"
                          alignItems="center"
                          justifyContent="center"
                          w="38px"
                          h="38px"
                          flexShrink={0}
                          borderRadius="12px 12px 12px 4px"
                          bg="bg.muted"
                          color="fg.muted"
                          fontSize="sm"
                          fontWeight="800"
                        >
                          {agent.name.charAt(0).toUpperCase()}
                        </Box>
                        <Box minW={0}>
                          <Text fontSize="sm" fontFamily="mono" fontWeight="700">
                            {agent.name}
                          </Text>
                          <Text fontSize="xs" color="fg.muted" mt={1} lineClamp={2}>{agent.description}</Text>
                        </Box>
                      </HStack>
                    ))}
                  </SimpleGrid>
                </Box>
              )}
            </>
          )}
        </VStack>
      ) : (
        <Box border="1px solid" borderColor="border.default" borderRadius="md" overflow="hidden" minH="600px">
          <Editor
            height="600px"
            language="json"
            value={JSON.stringify(content.agents || [], null, 2)}
            onChange={(value) => {
              try {
                const parsed = JSON.parse(value || '[]');
                if (Array.isArray(parsed)) onChange({ agents: parsed });
              } catch { /* ignore parse errors while typing */ }
            }}
            theme={colorMode === 'dark' ? 'vs-dark' : 'light'}
            options={{
              readOnly: !canManageAgents,
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
