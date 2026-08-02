'use client';

import { memo, useMemo, useSyncExternalStore } from 'react';
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

// A "has React finished hydrating?" probe. There is no external store to watch, so `subscribe`
// never fires; the value comes purely from React using getServerSnapshot for the server render AND
// the hydrating client render, then switching to getSnapshot. All three are module-level so their
// identities stay stable across renders.
const subscribeNever = () => () => {};
const getHydratedTrue = () => true;
const getHydratedFalse = () => false;

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
  // A random greeting per visit is the intent, but picking it DURING RENDER is not: the server
  // renders one string and the hydrating client renders another, which React reports as
  // "Text content does not match server-rendered HTML" (minified #418) in production. So the
  // server render and the client's FIRST render both use greetings[0], and the re-roll happens
  // only once `hydrated` flips after mount — by which point React is no longer matching trees.
  const hydrated = useSyncExternalStore(subscribeNever, getHydratedTrue, getHydratedFalse);
  const greeting = useMemo(() => {
    // eslint-disable-next-line react-hooks/purity -- guarded by `hydrated`; see above
    const index = hydrated ? Math.floor(Math.random() * greetings.length) : 0;
    return greetings[index](firstName);
  }, [firstName, hydrated]);

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

// Memoized because this subtree is ~15 Boxes deep and its props are stable: a parent re-render for
// an internal reason (streaming chunk, scroll state, container resize, …) would otherwise cascade
// through all of them, and this sits under a component that re-renders often.
const ExampleQuestions = memo(ExampleQuestionsImpl);
export default ExampleQuestions;
