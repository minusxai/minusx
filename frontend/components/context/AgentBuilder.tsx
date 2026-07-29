'use client';

/**
 * AgentBuilder — multi-step builder for a custom agent definition:
 * Identity → Prompt → Skills → Review, saved ONLY at the end. One component,
 * local state, no routing. The step tabs are directly clickable (gated on the
 * prerequisites: Prompt needs a name, Skills/Review need name + prompt), so an
 * editor can jump straight to the section they came to change. The Review step
 * renders the shared AgentReadView so what the user reviews is exactly what
 * will be saved.
 */

import { useState } from 'react';
import { Badge, Box, Button, createListCollection, HStack, Icon, Input, Portal, SimpleGrid, Text, Textarea, VStack } from '@chakra-ui/react';
import { LuBookOpen, LuCheck, LuCheckCheck, LuCircleOff, LuLibrary, LuSearch, LuZap } from 'react-icons/lu';
import { AgentReadView, type AgentDraft } from './AgentReadView';
import { SelectContent, SelectItem, SelectPositioner, SelectRoot, SelectTrigger, SelectValueText } from '@/components/ui/select';

const STEPS = ['identity', 'prompt', 'skills', 'review'] as const;
type Step = (typeof STEPS)[number];
const STEP_TITLES: Record<Step, string> = {
  identity: 'Identity',
  prompt: 'Prompt',
  skills: 'Skills',
  review: 'Review',
};

export interface AgentBuilderProps {
  /** Prefill for editing; omit for a new agent. */
  initial?: AgentDraft;
  systemSkills: { name: string; description: string }[];
  userSkills: { name: string; description: string }[];
  onSave: (draft: AgentDraft) => void;
  onCancel: () => void;
}

const EMPTY_DRAFT: AgentDraft = {
  name: '',
  description: '',
  prompt: '',
  promptMode: 'append',
  preloadSkills: [],
  includeSkills: [],
};

const GRADE_OPTIONS = createListCollection({
  items: [
    { label: 'Workspace default', value: 'default' },
    { label: 'Lite', value: 'lite' },
    { label: 'Core', value: 'core' },
    { label: 'Advanced', value: 'advanced' },
  ],
});

function normalizeSkillAccess(draft: AgentDraft): AgentDraft {
  const preloaded = new Set(draft.preloadSkills);
  return {
    ...draft,
    includeSkills: draft.includeSkills.filter((name) => !preloaded.has(name)),
  };
}

type SkillAccessMode = 'excluded' | 'demand' | 'always';

export function AgentBuilder({ initial, systemSkills, userSkills, onSave, onCancel }: AgentBuilderProps) {
  const [step, setStep] = useState<Step>('identity');
  const [draft, setDraft] = useState<AgentDraft>(() => normalizeSkillAccess(initial ?? EMPTY_DRAFT));
  const [skillQuery, setSkillQuery] = useState('');
  const stepIndex = STEPS.indexOf(step);

  const patch = (updates: Partial<AgentDraft>) => setDraft((d) => ({ ...d, ...updates }));
  const setSkillAccess = (mode: SkillAccessMode, name: string) => {
    setDraft((d) => ({
      ...d,
      preloadSkills: mode === 'always'
        ? [...d.preloadSkills.filter((n) => n !== name), name]
        : d.preloadSkills.filter((n) => n !== name),
      includeSkills: mode === 'demand'
        ? [...d.includeSkills.filter((n) => n !== name), name]
        : d.includeSkills.filter((n) => n !== name),
    }));
  };

  // Prerequisites per step: Prompt needs a name; Skills/Review need name + prompt.
  const hasName = draft.name.trim().length > 0;
  const hasPrompt = draft.prompt.trim().length > 0;
  const stepReachable: Record<Step, boolean> = {
    identity: true,
    prompt: hasName,
    skills: hasName && hasPrompt,
    review: hasName && hasPrompt,
  };
  const canAdvance = stepIndex < STEPS.length - 1 && stepReachable[STEPS[stepIndex + 1]];

  const allSkills = [
    ...userSkills.map((s) => ({ ...s, source: 'user' as const })),
    ...systemSkills.map((s) => ({ ...s, source: 'system' as const })),
  ];
  const normalizedSkillQuery = skillQuery.trim().toLowerCase();
  const filteredSkills = normalizedSkillQuery
    ? allSkills.filter((skill) => (
      skill.name.toLowerCase().includes(normalizedSkillQuery)
      || skill.description.toLowerCase().includes(normalizedSkillQuery)
      || skill.source.includes(normalizedSkillQuery)
    ))
    : allSkills;

  const label = (text: string) => (
    <Text fontSize="sm" fontWeight="600" color="fg.default" mb={1.5}>{text}</Text>
  );
  const hint = (text: string) => (
    <Text fontSize="xs" color="fg.muted" mt={1.5}>{text}</Text>
  );

  return (
    <Box border="1px solid" borderColor="border.muted" borderRadius="lg" p={5} aria-label="Agent builder">
      <HStack justify="space-between" mb={5}>
        <HStack gap={1}>
          {STEPS.map((s, i) => (
            <HStack key={s} gap={1}>
              {i > 0 && <Text fontSize="sm" color="fg.subtle" px={0.5}>›</Text>}
              <Button
                aria-label={`Builder step ${STEP_TITLES[s]}`}
                size="xs"
                variant={s === step ? 'subtle' : 'ghost'}
                colorPalette={s === step ? 'teal' : 'gray'}
                fontWeight={s === step ? '700' : '500'}
                disabled={!stepReachable[s]}
                onClick={() => setStep(s)}
              >
                {STEP_TITLES[s]}
              </Button>
            </HStack>
          ))}
        </HStack>
        <Button aria-label="Cancel agent builder" size="xs" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </HStack>

      {step === 'identity' && (
        <VStack align="stretch" gap={5} maxW="640px">
          <Box>
            {label('Name')}
            <Input
              aria-label="Agent name"
              size="md"
              fontFamily="mono"
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="sales_helper"
            />
            {hint('A unique slug — this is how the agent appears in the chat agent picker.')}
          </Box>
          <Box>
            {label('Description')}
            <Input
              aria-label="Agent description"
              size="md"
              value={draft.description}
              onChange={(e) => patch({ description: e.target.value })}
              placeholder="Answers sales pipeline questions"
            />
            {hint('One line shown under the name in the picker.')}
          </Box>
        </VStack>
      )}

      {step === 'prompt' && (
        <VStack align="stretch" gap={5}>
          <Box>
            {label('Persona / instructions')}
            <Textarea
              aria-label="Agent prompt"
              size="md"
              fontFamily="mono"
              fontSize="sm"
              rows={12}
              value={draft.prompt}
              onChange={(e) => patch({ prompt: e.target.value })}
              placeholder="You are a revenue analyst. Always report figures in USD…"
            />
          </Box>
          <HStack gap={8} align="start" flexWrap="wrap">
            <Box>
              {label('Prompt mode')}
              <HStack gap={2}>
                <Button
                  aria-label="Prompt mode append"
                  size="xs"
                  variant={draft.promptMode === 'append' ? 'solid' : 'outline'}
                  colorPalette="teal"
                  onClick={() => patch({ promptMode: 'append' })}
                >
                  Append
                </Button>
                <Button
                  aria-label="Prompt mode replace"
                  size="xs"
                  variant={draft.promptMode === 'replace' ? 'solid' : 'outline'}
                  colorPalette="teal"
                  onClick={() => patch({ promptMode: 'replace' })}
                >
                  Replace
                </Button>
              </HStack>
              {hint(draft.promptMode === 'append'
                ? 'Your instructions are added to the default analyst prompt.'
                : 'Your instructions replace the default ones (schema, context, and skills stay available).')}
            </Box>
            <Box minW="220px">
              {label('LLM grade')}
              <SelectRoot
                collection={GRADE_OPTIONS}
                value={[draft.gradeOverride ?? 'default']}
                onValueChange={(e) => patch({
                  gradeOverride: (e.value[0] === 'default' ? undefined : e.value[0]) as AgentDraft['gradeOverride'],
                })}
                size="md"
              >
                <SelectTrigger
                  aria-label="Agent grade"
                  bg="bg.panel"
                  fontFamily="mono"
                >
                  <SelectValueText placeholder="Workspace default" />
                </SelectTrigger>
                <Portal>
                  <SelectPositioner>
                    <SelectContent fontFamily="mono">
                      {GRADE_OPTIONS.items.map((item) => (
                        <SelectItem key={item.value} item={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </SelectPositioner>
                </Portal>
              </SelectRoot>
              {hint('Optional default — a grade the user picks in chat always wins.')}
            </Box>
          </HStack>
        </VStack>
      )}

      {step === 'skills' && (
        <VStack align="stretch" gap={5}>
          <HStack justify="space-between" align="start" gap={4} flexWrap="wrap">
            <Box>
              <Text fontSize="md" fontWeight="700">Skill access</Text>
              <Text fontSize="sm" color="fg.muted" mt={1}>
                Choose what the agent can fetch when needed and what it should know on every turn.
              </Text>
            </Box>
            <HStack gap={2} flexWrap="wrap">
              <Badge size="sm" variant="subtle" colorPalette="gray" borderRadius="full" px={2.5} py={1}>
                <Icon as={LuLibrary} boxSize={3} mr={1} />
                {draft.includeSkills.length === 0
                  ? 'Full catalog on demand'
                  : `${draft.includeSkills.length} on demand`}
              </Badge>
              <Badge size="sm" variant="subtle" colorPalette="teal" borderRadius="full" px={2.5} py={1}>
                <Icon as={LuZap} boxSize={3} mr={1} />
                {draft.preloadSkills.length} always loaded
              </Badge>
            </HStack>
          </HStack>

          <SimpleGrid columns={{ base: 1, md: 3 }} gap={3}>
            <HStack align="start" gap={2.5} py={2}>
              <Icon as={LuCircleOff} boxSize={4} color="fg.subtle" mt={0.5} flexShrink={0} />
              <Box>
                <Text fontSize="xs" fontWeight="700">Excluded</Text>
                <Text fontSize="2xs" color="fg.muted" mt={0.5}>
                  Unavailable to this agent.
                </Text>
              </Box>
            </HStack>
            <HStack align="start" gap={2.5} py={2}>
              <Icon as={LuCheck} boxSize={4} color="fg.muted" mt={0.5} flexShrink={0} />
              <Box>
                <Text fontSize="xs" fontWeight="700">On demand</Text>
                <Text fontSize="2xs" color="fg.muted" mt={0.5}>
                  Fetched only when useful.
                </Text>
              </Box>
            </HStack>
            <HStack align="start" gap={2.5} py={2}>
              <Icon as={LuCheckCheck} boxSize={4} color="accent.teal" mt={0.5} flexShrink={0} />
              <Box>
                <Text fontSize="xs" fontWeight="700">Always loaded</Text>
                <Text fontSize="2xs" color="fg.muted" mt={0.5}>
                  Added to every prompt.
                </Text>
              </Box>
            </HStack>
          </SimpleGrid>

          <Box position="relative">
            <Icon
              as={LuSearch}
              position="absolute"
              left={3}
              top="50%"
              transform="translateY(-50%)"
              boxSize={4}
              color="fg.subtle"
              pointerEvents="none"
            />
            <Input
              aria-label="Search skills"
              value={skillQuery}
              onChange={(event) => setSkillQuery(event.target.value)}
              placeholder="Search skills by name, description, or source…"
              pl={9}
              bg="bg.panel"
              fontFamily="mono"
            />
          </Box>

          <SimpleGrid columns={{ base: 1, xl: 2 }} gap={3}>
            {filteredSkills.map((skill) => {
              const isOnDemand = draft.includeSkills.includes(skill.name);
              const isAlwaysLoaded = draft.preloadSkills.includes(skill.name);
              const accessMode: SkillAccessMode = isAlwaysLoaded ? 'always' : isOnDemand ? 'demand' : 'excluded';
              return (
                <Box
                  key={`${skill.source}:${skill.name}`}
                  aria-label={`Skill ${skill.name}`}
                  display="flex"
                  flexDirection="column"
                  minH="132px"
                  p={3.5}
                  border="1px solid"
                  borderColor="border.muted"
                  borderRadius="lg"
                  bg="bg.panel"
                  transition="border-color 160ms ease, box-shadow 160ms ease"
                  _hover={{ borderColor: 'border.emphasized', boxShadow: 'xs' }}
                >
                  <HStack justify="space-between" align="start" gap={3}>
                    <Box minW={0}>
                      <Text fontSize="sm" fontFamily="mono" fontWeight="700" truncate>{skill.name}</Text>
                      <Text fontSize="xs" color="fg.muted" mt={1} lineClamp={2}>{skill.description}</Text>
                    </Box>
                    <Badge
                      size="xs"
                      flexShrink={0}
                      variant={skill.source === 'user' ? 'subtle' : 'outline'}
                      colorPalette={skill.source === 'user' ? 'teal' : 'gray'}
                    >
                      {skill.source === 'user' ? 'User skill' : 'System skill'}
                    </Badge>
                  </HStack>

                  <HStack justify="space-between" align="center" gap={3} mt="auto" pt={3}>
                    <Text fontSize="2xs" fontWeight="700" color="fg.subtle" textTransform="uppercase" letterSpacing="0.08em">
                      Access
                    </Text>
                    <HStack
                      role="radiogroup"
                      aria-label={`Skill access for ${skill.name}`}
                      gap={0.5}
                      p={0.5}
                      border="1px solid"
                      borderColor="border.muted"
                      borderRadius="md"
                      bg="bg.muted"
                    >
                      {([
                        { mode: 'excluded' as const, label: 'Excluded', ariaLabel: `Exclude skill ${skill.name}`, icon: LuCircleOff },
                        { mode: 'demand' as const, label: 'On demand', ariaLabel: `Include skill ${skill.name}`, icon: LuCheck },
                        { mode: 'always' as const, label: 'Always', ariaLabel: `Preload skill ${skill.name}`, icon: LuCheckCheck },
                      ]).map((option) => {
                        const selected = accessMode === option.mode;
                        return (
                          <Button
                            key={option.mode}
                            role="radio"
                            aria-label={option.ariaLabel}
                            aria-checked={selected}
                            size="xs"
                            variant="ghost"
                            h="26px"
                            minW="auto"
                            px={2}
                            gap={1}
                            borderRadius="sm"
                            border="1px solid"
                            borderColor={selected ? 'border.default' : 'transparent'}
                            bg={selected ? 'bg.panel' : 'transparent'}
                            color={selected && option.mode !== 'excluded' ? 'accent.teal' : selected ? 'fg.default' : 'fg.muted'}
                            boxShadow={selected ? 'xs' : 'none'}
                            _hover={{ bg: selected ? 'bg.panel' : 'bg.subtle', color: 'fg.default' }}
                            onClick={() => setSkillAccess(option.mode, skill.name)}
                          >
                            <Icon as={option.icon} boxSize={3} />
                            {option.label}
                          </Button>
                        );
                      })}
                    </HStack>
                  </HStack>
                </Box>
              );
            })}
          </SimpleGrid>
          {allSkills.length > 0 && filteredSkills.length === 0 && (
            <Box py={10} textAlign="center" border="1px dashed" borderColor="border.muted" borderRadius="lg">
              <Icon as={LuBookOpen} boxSize={5} color="fg.subtle" mb={2} />
              <Text fontSize="sm" fontWeight="600">No matching skills</Text>
              <Text fontSize="xs" color="fg.muted" mt={1}>Try a different name, description, or source.</Text>
            </Box>
          )}
          {allSkills.length === 0 && (
            <Text fontSize="sm" color="fg.muted">No skills available yet — the agent gets the full catalog.</Text>
          )}
        </VStack>
      )}

      {step === 'review' && (
        <Box aria-label="Agent review">
          <AgentReadView agent={draft} />
        </Box>
      )}

      <HStack justify="flex-end" gap={2} mt={6}>
        {stepIndex > 0 && (
          <Button aria-label="Builder back" size="xs" variant="outline" onClick={() => setStep(STEPS[stepIndex - 1])}>
            Back
          </Button>
        )}
        {step !== 'review' ? (
          <Button
            aria-label="Builder next"
            size="xs"
            colorPalette="teal"
            disabled={!canAdvance}
            onClick={() => setStep(STEPS[stepIndex + 1])}
          >
            Next
          </Button>
        ) : (
          <Button aria-label="Save agent" size="xs" colorPalette="teal" onClick={() => onSave(draft)}>
            Save agent
          </Button>
        )}
      </HStack>
    </Box>
  );
}
