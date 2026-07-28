'use client';

/**
 * AgentsTabContent — the "Agents" tab body of ContextEditorV2: user-defined
 * custom agents (AgentEntry on the context content), the minimal multi-step
 * builder (AgentBuilder), inherited agents (fullAgents, read-only), and the
 * raw JSON editor variant. Structure mirrors SkillsTabContent.
 */

import { useState } from 'react';
import { Badge, Box, Button, HStack, Icon, Switch, Tabs, Text, VStack } from '@chakra-ui/react';
import { LuPencil, LuPlus, LuTrash2 } from 'react-icons/lu';
import type { AgentEntry, ContextContent } from '@/lib/types';
import { mergeSkillsByName } from '@/lib/context/context-utils';
import Editor from '@monaco-editor/react';
import { AgentBuilder } from './AgentBuilder';
import { AgentReadView, type AgentDraft } from './AgentReadView';

const MONACO_READ_ONLY_MESSAGE = { value: 'Switch to edit mode to make changes.' };

interface AgentsTabContentProps {
  activeTab: 'picker' | 'yaml';
  colorMode: string;
  content: ContextContent;
  onChange: (updates: Partial<ContextContent>) => void;
  canAddAgent: boolean;
  canManageAgents: boolean;
  systemSkills: { name: string; description: string }[];
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
    .map((skill) => ({ name: skill.name, description: skill.description }));

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
        <VStack gap={4} align="stretch">
          {builder ? (
            <AgentBuilder
              initial={builder.mode === 'edit' ? agents[builder.index] : undefined}
              systemSkills={systemSkills}
              userSkills={userSkills}
              onSave={handleSave}
              onCancel={() => setBuilder(null)}
            />
          ) : (
            <>
              <HStack justify="space-between">
                <HStack gap={2}>
                  <Text fontSize="xs" fontWeight="700" textTransform="uppercase" letterSpacing="wider" color="fg.muted">
                    Custom Agents
                  </Text>
                  <Badge size="xs" colorPalette="teal" variant="subtle">{agents.length}</Badge>
                </HStack>
                {canAddAgent && (
                  <Button
                    aria-label="Add agent"
                    size="xs"
                    variant="outline"
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

              {agents.map((agent, index) => (
                <Box
                  key={`agent-${index}`}
                  aria-label={`Agent ${agent.name}`}
                  border="1px solid"
                  borderColor="border.muted"
                  borderRadius="md"
                  p={4}
                  opacity={agent.enabled ? 1 : 0.6}
                >
                  <HStack justify="space-between" mb={2}>
                    {canManageAgents ? (
                      <Switch.Root
                        size="sm"
                        colorPalette="green"
                        checked={agent.enabled}
                        onCheckedChange={(e) => onUpdateAgent(index, { enabled: e.checked })}
                      >
                        <Switch.HiddenInput aria-label={`Agent ${agent.name} enabled`} />
                        <Switch.Control>
                          <Switch.Thumb />
                        </Switch.Control>
                        <Switch.Label fontSize="xs" fontWeight="600" color={agent.enabled ? 'fg.default' : 'fg.muted'}>
                          {agent.enabled ? 'Production' : 'Draft'}
                        </Switch.Label>
                      </Switch.Root>
                    ) : (
                      <Badge size="sm" colorPalette={agent.enabled ? 'green' : 'gray'} variant="subtle">
                        {agent.enabled ? 'Production' : 'Draft'}
                      </Badge>
                    )}
                    {canManageAgents && (
                      <HStack gap={2}>
                        <Button
                          aria-label={`Edit agent ${agent.name}`}
                          size="xs"
                          variant="ghost"
                          onClick={() => setBuilder({ mode: 'edit', index })}
                        >
                          <Icon as={LuPencil} boxSize={3.5} />
                        </Button>
                        <Button
                          aria-label={`Delete agent ${agent.name}`}
                          size="xs"
                          variant="ghost"
                          colorPalette="red"
                          onClick={() => onDeleteAgent(index)}
                        >
                          <Icon as={LuTrash2} boxSize={3.5} />
                        </Button>
                      </HStack>
                    )}
                  </HStack>
                  <AgentReadView agent={agent} />
                </Box>
              ))}
              {agents.length === 0 && (
                <Text fontSize="sm" color="fg.muted">
                  No custom agents yet. An agent is a persona + skill selection on top of the default analyst —
                  it appears in the chat settings agent picker for everyone under this context.
                </Text>
              )}

              {inheritedAgents.length > 0 && (
                <Box border="1px solid" borderColor="border.muted" borderRadius="md" p={3}>
                  <HStack gap={2} mb={2}>
                    <Text fontSize="xs" fontWeight="700" textTransform="uppercase" letterSpacing="wider" color="fg.muted">
                      Inherited Agents
                    </Text>
                    <Badge size="xs" colorPalette="gray" variant="subtle">Read only</Badge>
                  </HStack>
                  <VStack align="stretch" gap={2}>
                    {inheritedAgents.map((agent) => (
                      <Box
                        key={agent.name}
                        aria-label={`Inherited agent ${agent.name}`}
                        p={3}
                        border="1px solid"
                        borderColor="border.muted"
                        borderRadius="md"
                        bg="bg.subtle"
                      >
                        <Text fontSize="sm" fontFamily="mono" fontWeight="700">
                          {agent.name}
                        </Text>
                        <Text fontSize="xs" color="fg.muted" mt={1}>{agent.description}</Text>
                      </Box>
                    ))}
                  </VStack>
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
