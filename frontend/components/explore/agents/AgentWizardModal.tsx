'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  Box,
  HStack,
  VStack,
  Text,
  Icon,
  Input,
  Textarea,
  Button,
  Badge,
} from '@chakra-ui/react';
import { LuCheck, LuChevronDown } from 'react-icons/lu';
import { useAppDispatch } from '@/store/hooks';
import { publishAgent } from '@/store/agentsSlice';
import { toaster } from '@/components/ui/toaster';
import {
  DemoAgent,
  AgentIconKey,
  AGENT_ICONS,
  AGENT_ACCENTS,
  AVAILABLE_TOOLS,
  AVAILABLE_SKILLS,
  AgentCapability,
  buildPromptTemplate,
} from '@/lib/agents/demo-agents';

const STEP_TITLES = ['Basics', 'Prompt', 'Capabilities', 'Review'];

interface AgentDraft {
  name: string;
  description: string;
  goal: string;
  icon: AgentIconKey;
  accent: string;
  systemPrompt: string;
  tools: string[];
  skills: string[];
}

const EMPTY_DRAFT: AgentDraft = {
  name: '',
  description: '',
  goal: '',
  icon: 'bot',
  accent: 'accent.teal',
  systemPrompt: '',
  tools: ['sql', 'charts'],
  skills: [],
};

function draftFromAgent(agent: DemoAgent): AgentDraft {
  const { name, description, goal, icon, accent, systemPrompt, tools, skills } = agent;
  return { name, description, goal, icon, accent, systemPrompt, tools: [...tools], skills: [...skills] };
}

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'custom-agent';
}

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

function WizardStepIndicator({ steps, currentIndex }: { steps: string[]; currentIndex: number }) {
  return (
    <VStack align="stretch" gap={2} aria-label={`Step ${currentIndex + 1} of ${steps.length}`}>
      <HStack gap={0} align="center">
        {steps.map((step, i) => {
          const done = i < currentIndex;
          const active = i === currentIndex;
          return (
            <HStack key={step} gap={0} flex={i < steps.length - 1 ? '1' : '0 0 auto'} align="center">
              <VStack gap={1} minW="72px">
                <Box
                  boxSize="28px"
                  borderRadius="full"
                  display="flex"
                  alignItems="center"
                  justifyContent="center"
                  bg={done || active ? 'accent.teal' : 'bg.muted'}
                  border="2px solid"
                  borderColor={done || active ? 'accent.teal' : 'border.muted'}
                  color={done || active ? 'white' : 'fg.muted'}
                  fontSize="xs"
                  fontWeight="700"
                  fontFamily="mono"
                  transition="all 0.2s"
                >
                  {done ? <Icon as={LuCheck} boxSize={3.5} /> : i + 1}
                </Box>
                <Text
                  fontSize="2xs"
                  fontFamily="mono"
                  textTransform="uppercase"
                  letterSpacing="0.05em"
                  fontWeight={active ? '700' : '500'}
                  color={active ? 'fg.default' : 'fg.muted'}
                >
                  {step}
                </Text>
              </VStack>
              {i < steps.length - 1 && (
                <Box flex="1" height="2px" bg={done ? 'accent.teal' : 'border.muted'} mb={5} mx={1} borderRadius="full" />
              )}
            </HStack>
          );
        })}
      </HStack>
    </VStack>
  );
}

// ---------------------------------------------------------------------------
// Field label
// ---------------------------------------------------------------------------

function FieldLabel({ children }: { children: string }) {
  return (
    <Text fontSize="xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.05em" fontFamily="mono">
      {children}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Step 1: Basics
// ---------------------------------------------------------------------------

function BasicsStep({ draft, onChange }: { draft: AgentDraft; onChange: (patch: Partial<AgentDraft>) => void }) {
  return (
    <VStack align="stretch" gap={5}>
      <VStack align="stretch" gap={1.5}>
        <FieldLabel>Name</FieldLabel>
        <Input
          aria-label="Agent name"
          placeholder="e.g. Revenue Agent"
          fontFamily="mono"
          value={draft.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </VStack>

      <VStack align="stretch" gap={1.5}>
        <FieldLabel>Description</FieldLabel>
        <Input
          aria-label="Agent description"
          placeholder="One or two lines shown on the agent card"
          value={draft.description}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </VStack>

      <VStack align="stretch" gap={1.5}>
        <FieldLabel>Goal</FieldLabel>
        <Textarea
          aria-label="Agent goal"
          placeholder="What should this agent be responsible for?"
          rows={3}
          value={draft.goal}
          onChange={(e) => onChange({ goal: e.target.value })}
        />
      </VStack>

      <HStack align="flex-start" gap={8} flexWrap="wrap">
        <VStack align="stretch" gap={1.5}>
          <FieldLabel>Icon</FieldLabel>
          <HStack gap={2} flexWrap="wrap">
            {(Object.keys(AGENT_ICONS) as AgentIconKey[]).map((key) => {
              const IconComp = AGENT_ICONS[key];
              const selected = draft.icon === key;
              return (
                <Box
                  key={key}
                  as="button"
                  aria-label={`Agent icon: ${key}`}
                  p={2}
                  borderRadius="lg"
                  border="2px solid"
                  borderColor={selected ? draft.accent : 'border.muted'}
                  bg={selected ? `${draft.accent}/10` : 'bg.muted'}
                  cursor="pointer"
                  transition="all 0.15s"
                  _hover={{ borderColor: draft.accent }}
                  onClick={() => onChange({ icon: key })}
                >
                  <Icon as={IconComp} boxSize={5} color={selected ? draft.accent : 'fg.muted'} />
                </Box>
              );
            })}
          </HStack>
        </VStack>

        <VStack align="stretch" gap={1.5}>
          <FieldLabel>Color</FieldLabel>
          <HStack gap={2}>
            {AGENT_ACCENTS.map(({ token, label }) => {
              const selected = draft.accent === token;
              return (
                <Box
                  key={token}
                  as="button"
                  aria-label={`Agent color: ${label}`}
                  boxSize="32px"
                  borderRadius="full"
                  bg={token}
                  border="3px solid"
                  borderColor={selected ? 'fg.default' : 'transparent'}
                  cursor="pointer"
                  transition="all 0.15s"
                  _hover={{ transform: 'scale(1.1)' }}
                  onClick={() => onChange({ accent: token })}
                />
              );
            })}
          </HStack>
        </VStack>
      </HStack>
    </VStack>
  );
}

// ---------------------------------------------------------------------------
// Step 2: Prompt
// ---------------------------------------------------------------------------

function PromptStep({ draft, onChange }: { draft: AgentDraft; onChange: (patch: Partial<AgentDraft>) => void }) {
  return (
    <VStack align="stretch" gap={1.5}>
      <FieldLabel>System Prompt</FieldLabel>
      <Text fontSize="sm" color="fg.muted" mb={1}>
        This is the standing instruction the agent follows on every conversation.
      </Text>
      <Textarea
        aria-label="System prompt"
        fontFamily="mono"
        fontSize="sm"
        rows={12}
        value={draft.systemPrompt}
        onChange={(e) => onChange({ systemPrompt: e.target.value })}
      />
    </VStack>
  );
}

// ---------------------------------------------------------------------------
// Step 3: Capabilities (tools + skills)
// ---------------------------------------------------------------------------

function CapabilityRow({
  capability,
  kind,
  checked,
  accent,
  onToggle,
}: {
  capability: AgentCapability;
  kind: 'Tool' | 'Skill';
  checked: boolean;
  accent: string;
  onToggle: () => void;
}) {
  return (
    <HStack
      as="button"
      aria-label={`${kind}: ${capability.label}`}
      aria-checked={checked}
      role="checkbox"
      gap={3}
      p={2.5}
      borderRadius="md"
      border="1px solid"
      borderColor={checked ? accent : 'border.muted'}
      bg={checked ? `${accent}/5` : 'transparent'}
      cursor="pointer"
      transition="all 0.15s"
      textAlign="left"
      width="100%"
      _hover={{ borderColor: accent }}
      onClick={onToggle}
    >
      <Box
        boxSize="18px"
        borderRadius="sm"
        border="2px solid"
        borderColor={checked ? accent : 'border.emphasized'}
        bg={checked ? accent : 'transparent'}
        display="flex"
        alignItems="center"
        justifyContent="center"
        flexShrink={0}
      >
        {checked && <Icon as={LuCheck} boxSize={3} color="white" />}
      </Box>
      <VStack align="flex-start" gap={0} flex="1" minW={0}>
        <Text fontSize="sm" fontWeight="600" color="fg.default" fontFamily="mono">
          {capability.label}
        </Text>
        <Text fontSize="xs" color="fg.muted" lineClamp={1}>
          {capability.description}
        </Text>
      </VStack>
    </HStack>
  );
}

function CapabilityAccordion({
  title,
  selectedCount,
  totalCount,
  isOpen,
  onToggleOpen,
  children,
}: {
  title: string;
  selectedCount: number;
  totalCount: number;
  isOpen: boolean;
  onToggleOpen: () => void;
  children: React.ReactNode;
}) {
  return (
    <Box border="1px solid" borderColor="border.muted" borderRadius="lg" overflow="hidden">
      <HStack
        as="button"
        aria-label={`Toggle ${title.toLowerCase()} section`}
        aria-expanded={isOpen}
        width="100%"
        justify="space-between"
        px={4}
        py={3}
        bg="bg.muted"
        cursor="pointer"
        _hover={{ bg: 'bg.subtle' }}
        onClick={onToggleOpen}
      >
        <HStack gap={2.5}>
          <Text fontSize="xs" fontWeight="700" color="fg.default" textTransform="uppercase" letterSpacing="0.05em" fontFamily="mono">
            {title}
          </Text>
          <Badge fontSize="2xs" fontFamily="mono" color="fg.muted" bg="bg.surface" borderRadius="sm" px={2} py={0.5}>
            {selectedCount} of {totalCount} selected
          </Badge>
        </HStack>
        <Icon
          as={LuChevronDown}
          boxSize={4}
          color="fg.muted"
          transition="transform 0.2s"
          transform={isOpen ? 'rotate(180deg)' : 'rotate(0deg)'}
        />
      </HStack>
      {isOpen && (
        <VStack align="stretch" gap={2} p={3}>
          {children}
        </VStack>
      )}
    </Box>
  );
}

function CapabilitiesStep({ draft, onChange }: { draft: AgentDraft; onChange: (patch: Partial<AgentDraft>) => void }) {
  const [openSections, setOpenSections] = useState<{ tools: boolean; skills: boolean }>({ tools: true, skills: true });
  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter(x => x !== id) : [...list, id];

  return (
    <VStack align="stretch" gap={4}>
      <CapabilityAccordion
        title="Tools"
        selectedCount={draft.tools.length}
        totalCount={AVAILABLE_TOOLS.length}
        isOpen={openSections.tools}
        onToggleOpen={() => setOpenSections(s => ({ ...s, tools: !s.tools }))}
      >
        {AVAILABLE_TOOLS.map(tool => (
          <CapabilityRow
            key={tool.id}
            capability={tool}
            kind="Tool"
            accent={draft.accent}
            checked={draft.tools.includes(tool.id)}
            onToggle={() => onChange({ tools: toggle(draft.tools, tool.id) })}
          />
        ))}
      </CapabilityAccordion>
      <CapabilityAccordion
        title="Skills"
        selectedCount={draft.skills.length}
        totalCount={AVAILABLE_SKILLS.length}
        isOpen={openSections.skills}
        onToggleOpen={() => setOpenSections(s => ({ ...s, skills: !s.skills }))}
      >
        {AVAILABLE_SKILLS.map(skill => (
          <CapabilityRow
            key={skill.id}
            capability={skill}
            kind="Skill"
            accent={draft.accent}
            checked={draft.skills.includes(skill.id)}
            onToggle={() => onChange({ skills: toggle(draft.skills, skill.id) })}
          />
        ))}
      </CapabilityAccordion>
    </VStack>
  );
}

// ---------------------------------------------------------------------------
// Step 4: Review
// ---------------------------------------------------------------------------

function ReviewStep({ draft }: { draft: AgentDraft }) {
  const IconComp = AGENT_ICONS[draft.icon] ?? AGENT_ICONS.bot;
  const toolLabels = AVAILABLE_TOOLS.filter(t => draft.tools.includes(t.id)).map(t => t.label);
  const skillLabels = AVAILABLE_SKILLS.filter(s => draft.skills.includes(s.id)).map(s => s.label);

  return (
    <VStack align="stretch" gap={5}>
      <HStack gap={3}>
        <Box p={2.5} borderRadius="lg" bg={`${draft.accent}/10`}>
          <Icon as={IconComp} boxSize={6} color={draft.accent} />
        </Box>
        <VStack align="flex-start" gap={0}>
          <Text fontSize="md" fontWeight="700" fontFamily="mono">{draft.name}</Text>
          <Text fontSize="sm" color="fg.muted">{draft.description || 'No description'}</Text>
        </VStack>
      </HStack>

      {draft.goal && (
        <VStack align="stretch" gap={1}>
          <FieldLabel>Goal</FieldLabel>
          <Text fontSize="sm" color="fg.default">{draft.goal}</Text>
        </VStack>
      )}

      <VStack align="stretch" gap={1}>
        <FieldLabel>System Prompt</FieldLabel>
        <Box p={3} borderRadius="md" bg="bg.muted" border="1px solid" borderColor="border.muted">
          <Text fontSize="xs" fontFamily="mono" color="fg.muted" lineClamp={4} whiteSpace="pre-wrap">
            {draft.systemPrompt || 'No prompt set'}
          </Text>
        </Box>
      </VStack>

      <HStack align="flex-start" gap={8} flexWrap="wrap">
        <VStack align="stretch" gap={1.5}>
          <FieldLabel>Tools</FieldLabel>
          <HStack gap={1.5} flexWrap="wrap">
            {toolLabels.length > 0 ? toolLabels.map(label => (
              <Badge key={label} fontFamily="mono" fontSize="2xs" bg={`${draft.accent}/10`} color={draft.accent} borderRadius="sm" px={2} py={0.5}>
                {label}
              </Badge>
            )) : <Text fontSize="xs" color="fg.muted">None selected</Text>}
          </HStack>
        </VStack>
        <VStack align="stretch" gap={1.5}>
          <FieldLabel>Skills</FieldLabel>
          <HStack gap={1.5} flexWrap="wrap">
            {skillLabels.length > 0 ? skillLabels.map(label => (
              <Badge key={label} fontFamily="mono" fontSize="2xs" bg="bg.muted" color="fg.muted" borderRadius="sm" px={2} py={0.5}>
                {label}
              </Badge>
            )) : <Text fontSize="xs" color="fg.muted">None selected</Text>}
          </HStack>
        </VStack>
      </HStack>
    </VStack>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

interface AgentWizardModalProps {
  isOpen: boolean;
  /** When set, the wizard edits this agent (prefilled) instead of creating a new one. */
  editingAgent: DemoAgent | null;
  onClose: () => void;
}

export default function AgentWizardModal({ isOpen, editingAgent, onClose }: AgentWizardModalProps) {
  const dispatch = useAppDispatch();
  const [stepIndex, setStepIndex] = useState(0);
  const [draft, setDraft] = useState<AgentDraft>(EMPTY_DRAFT);

  // Re-seed the draft each time the dialog opens (create: empty; edit: prefilled).
  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraft(editingAgent ? draftFromAgent(editingAgent) : EMPTY_DRAFT);
      setStepIndex(0);
    }
  }, [isOpen, editingAgent]);

  const patchDraft = (patch: Partial<AgentDraft>) => setDraft(prev => ({ ...prev, ...patch }));

  const goNext = () => {
    // Entering the prompt step with an empty prompt: prefill from the template.
    if (stepIndex === 0 && !draft.systemPrompt.trim()) {
      patchDraft({ systemPrompt: buildPromptTemplate(draft.name, draft.goal) });
    }
    setStepIndex(i => Math.min(i + 1, STEP_TITLES.length - 1));
  };

  const handlePublish = () => {
    const agent: DemoAgent = {
      slug: editingAgent ? editingAgent.slug : slugify(draft.name),
      name: draft.name.trim(),
      icon: draft.icon,
      accent: draft.accent,
      description: draft.description.trim() || draft.goal.trim() || 'A custom agent for your workspace.',
      goal: draft.goal.trim(),
      greeting: editingAgent?.greeting ?? `Hi, I am your ${draft.name.trim()}. Ask me anything.`,
      systemPrompt: draft.systemPrompt,
      tools: draft.tools,
      skills: draft.skills,
      questionSections: editingAgent?.questionSections ?? [
        {
          title: 'Get Started',
          questions: ['What all can you do?', 'Show me an interesting visualization'],
        },
      ],
      preset: editingAgent?.preset,
    };
    dispatch(publishAgent(agent));
    toaster.create({ title: `${agent.name} published`, type: 'success' });
    onClose();
  };

  const isLastStep = stepIndex === STEP_TITLES.length - 1;

  return (
    <Dialog.Root open={isOpen} onOpenChange={(e) => { if (!e.open) onClose(); }}>
      <Dialog.Backdrop />
      <Dialog.Positioner>
        <Dialog.Content maxW="720px" width="95vw" p={6} borderRadius="xl" bg="bg.surface">
          <Dialog.Header pb={4}>
            <VStack align="stretch" gap={5} width="100%">
              <Dialog.Title fontSize="lg" fontWeight="800" fontFamily="mono" letterSpacing="-0.01em">
                {editingAgent ? `Configure ${editingAgent.name}` : 'Create Agent'}
              </Dialog.Title>
              <WizardStepIndicator steps={STEP_TITLES} currentIndex={stepIndex} />
            </VStack>
          </Dialog.Header>

          <Dialog.Body minH="340px" maxH="60vh" overflowY="auto" py={2}>
            {stepIndex === 0 && <BasicsStep draft={draft} onChange={patchDraft} />}
            {stepIndex === 1 && <PromptStep draft={draft} onChange={patchDraft} />}
            {stepIndex === 2 && <CapabilitiesStep draft={draft} onChange={patchDraft} />}
            {stepIndex === 3 && <ReviewStep draft={draft} />}
          </Dialog.Body>

          <Dialog.Footer pt={4}>
            <HStack justify="space-between" width="100%">
              <Button variant="ghost" aria-label="Cancel" onClick={onClose}>
                Cancel
              </Button>
              <HStack gap={2}>
                {stepIndex > 0 && (
                  <Button variant="outline" aria-label="Back" onClick={() => setStepIndex(i => Math.max(i - 1, 0))}>
                    Back
                  </Button>
                )}
                {isLastStep ? (
                  <Button
                    aria-label="Publish agent"
                    bg="accent.teal"
                    color="white"
                    _hover={{ bg: 'accent.teal', opacity: 0.9 }}
                    disabled={!draft.name.trim()}
                    onClick={handlePublish}
                  >
                    Publish Agent
                  </Button>
                ) : (
                  <Button
                    aria-label="Next step"
                    bg="accent.teal"
                    color="white"
                    _hover={{ bg: 'accent.teal', opacity: 0.9 }}
                    disabled={!draft.name.trim()}
                    onClick={goNext}
                  >
                    Next
                  </Button>
                )}
              </HStack>
            </HStack>
          </Dialog.Footer>

          <Dialog.CloseTrigger />
        </Dialog.Content>
      </Dialog.Positioner>
    </Dialog.Root>
  );
}
