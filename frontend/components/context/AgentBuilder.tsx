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
import { Box, Button, HStack, Input, NativeSelect, Text, Textarea, VStack } from '@chakra-ui/react';
import { AgentReadView, type AgentDraft } from './AgentReadView';

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

export function AgentBuilder({ initial, systemSkills, userSkills, onSave, onCancel }: AgentBuilderProps) {
  const [step, setStep] = useState<Step>('identity');
  const [draft, setDraft] = useState<AgentDraft>(initial ?? EMPTY_DRAFT);
  const stepIndex = STEPS.indexOf(step);

  const patch = (updates: Partial<AgentDraft>) => setDraft((d) => ({ ...d, ...updates }));
  const toggleName = (list: 'preloadSkills' | 'includeSkills', name: string) => {
    setDraft((d) => ({
      ...d,
      [list]: d[list].includes(name) ? d[list].filter((n) => n !== name) : [...d[list], name],
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
                size="sm"
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
        <Button aria-label="Cancel agent builder" size="sm" variant="ghost" onClick={onCancel}>
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
                  size="sm"
                  variant={draft.promptMode === 'append' ? 'solid' : 'outline'}
                  colorPalette="teal"
                  onClick={() => patch({ promptMode: 'append' })}
                >
                  Append
                </Button>
                <Button
                  aria-label="Prompt mode replace"
                  size="sm"
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
              <NativeSelect.Root size="md">
                <NativeSelect.Field
                  aria-label="Agent grade"
                  value={draft.gradeOverride ?? ''}
                  onChange={(e) => patch({ gradeOverride: (e.target.value || undefined) as AgentDraft['gradeOverride'] })}
                >
                  <option value="">Workspace default</option>
                  <option value="lite">Lite</option>
                  <option value="core">Core</option>
                  <option value="advanced">Advanced</option>
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
              {hint('Optional default — a grade the user picks in chat always wins.')}
            </Box>
          </HStack>
        </VStack>
      )}

      {step === 'skills' && (
        <VStack align="stretch" gap={3}>
          <Text fontSize="sm" color="fg.muted">
            <b>Preload</b> inlines a skill&apos;s full content into the agent&apos;s prompt every turn.{' '}
            <b>Available</b> lets the agent load it on demand — leave every &quot;Available&quot; box
            unchecked for the full catalog.
          </Text>
          {allSkills.map((skill) => (
            <HStack key={`${skill.source}:${skill.name}`} justify="space-between" p={3} border="1px solid" borderColor="border.muted" borderRadius="md">
              <Box minW={0}>
                <Text fontSize="sm" fontFamily="mono" fontWeight="600" truncate>{skill.name}</Text>
                <Text fontSize="xs" color="fg.muted" truncate>{skill.description}</Text>
              </Box>
              <HStack gap={2} flexShrink={0}>
                <Button
                  aria-label={`Preload skill ${skill.name}`}
                  aria-pressed={draft.preloadSkills.includes(skill.name)}
                  size="sm"
                  variant={draft.preloadSkills.includes(skill.name) ? 'solid' : 'outline'}
                  colorPalette="teal"
                  onClick={() => toggleName('preloadSkills', skill.name)}
                >
                  Preload
                </Button>
                <Button
                  aria-label={`Include skill ${skill.name}`}
                  aria-pressed={draft.includeSkills.includes(skill.name)}
                  size="sm"
                  variant={draft.includeSkills.includes(skill.name) ? 'solid' : 'outline'}
                  colorPalette="teal"
                  onClick={() => toggleName('includeSkills', skill.name)}
                >
                  Available
                </Button>
              </HStack>
            </HStack>
          ))}
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
          <Button aria-label="Builder back" size="sm" variant="outline" onClick={() => setStep(STEPS[stepIndex - 1])}>
            Back
          </Button>
        )}
        {step !== 'review' ? (
          <Button
            aria-label="Builder next"
            size="sm"
            colorPalette="teal"
            disabled={!canAdvance}
            onClick={() => setStep(STEPS[stepIndex + 1])}
          >
            Next
          </Button>
        ) : (
          <Button aria-label="Save agent" size="sm" colorPalette="teal" onClick={() => onSave(draft)}>
            Save agent
          </Button>
        )}
      </HStack>
    </Box>
  );
}
