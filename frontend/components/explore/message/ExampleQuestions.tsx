'use client';

import { memo, useMemo } from 'react';
import { VStack, Grid, GridItem } from '@chakra-ui/react';
import { useAppSelector } from '@/store/hooks';
import { selectEffectiveUser } from '@/store/authSlice';
import { useConfigs } from '@/lib/hooks/useConfigs';
import {
  ExploreBrandHeader,
  SuggestedQuestionsList,
  DEFAULT_SUGGESTED_PROMPTS,
  toSuggestedPrompts,
} from './ExploreWelcome';

interface ExampleQuestionsProps {
  onPromptClick: (prompt: string) => void;
  container?: 'page' | 'sidebar';
  colSpan: any;
  colStart: any;
  /** Custom prompts (e.g. story-specific questions). Falls back to the generic defaults when empty. */
  customPrompts?: string[];
}

const greetings = [
  (name: string) => `Hi ${name}, what would you like to explore today?`,
  (name: string) => `Hey ${name}, ready to dig into some data?`,
  (name: string) => `Welcome back ${name}! What can I help you analyze?`,
  (name: string) => `What's on your mind today, ${name}?`,
];

function ExampleQuestionsImpl({ onPromptClick, colSpan, colStart, customPrompts }: ExampleQuestionsProps) {
  const colorMode = useAppSelector((state) => state.ui.colorMode);
  const user = useAppSelector(selectEffectiveUser);
  const { config } = useConfigs();
  const agentName = config.branding.agentName;
  const firstName = user?.name?.split(' ')[0].split('@')[0] || 'there';
  // greetings is module-level and stable; greeting is intentionally
  // re-randomised on firstName change only — Math.random() in useMemo is
  // the desired behaviour.
  const greeting = useMemo(() => {
    // eslint-disable-next-line react-hooks/purity
    const index = Math.floor(Math.random() * greetings.length);
    return greetings[index](firstName);
  }, [firstName]);

  const prompts = useMemo(
    () => (customPrompts && customPrompts.length > 0
      ? toSuggestedPrompts(customPrompts)
      : DEFAULT_SUGGESTED_PROMPTS),
    [customPrompts],
  );

  return (
    <Grid templateColumns={{ base: 'repeat(12, 1fr)', md: 'repeat(12, 1fr)' }} gap={2} w="100%">
      <GridItem colSpan={colSpan} colStart={colStart}>
        <VStack gap={6} align="center" justify="center" flex="1" py={6}>
          <ExploreBrandHeader agentName={agentName} colorMode={colorMode} subtitle={greeting} />
          <SuggestedQuestionsList prompts={prompts} onPromptClick={onPromptClick} />
        </VStack>
      </GridItem>
    </Grid>
  );
}

// Memoized: ChatInterface used to re-render on every streaming chunk (cascading
// down into ~15 Box renders here, 46+ times per 16s in the original trace).
// Even after the bag-selector fix in ChatInterface, this guards against future
// regressions where the parent re-renders for an internal reason (scroll state,
// container resize, …) — the props are stable, so React skips the subtree.
const ExampleQuestions = memo(ExampleQuestionsImpl);
export default ExampleQuestions;
