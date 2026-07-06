'use client';

import { Box, VStack, HStack, Text, Heading, Button, Collapsible, Icon, Progress } from '@chakra-ui/react';
import { LuSparkles, LuChevronRight } from 'react-icons/lu';
import { cursorBlinkKeyframes } from '@/lib/ui/animations';
import { selectAugmentedFiles } from '@/lib/store/file-selectors';
import { compressAugmentedFile } from '@/lib/chat/compress-augmented';
import ContextDocsEditor from '@/components/context/ContextDocsEditor';
import type { DocEntry } from '@/lib/types';
import type { RootState } from '@/store/store';
import { getProgressMessage } from '../useAgentProgress';
import AgentFeedCollapsible from './StepContextAgentFeed';
import SaveProgressBar from './StepContextSaveProgressBar';

interface StepContextDocsStepProps {
  isAgentRunning: boolean;
  docContent: string;
  hadExistingDocs: boolean;
  showAgentFeed: boolean;
  allDocs: DocEntry[];
  onDocsChange: (newDocs: DocEntry[]) => void;
  expandedDocIndices: number[];
  onExpandedChange: (indices: number[]) => void;
  knowledgeCounts: { metrics: number; annotations: number };
  error: string | null;
  agentProgress: number;
  onSkip: () => void;
  saving: boolean;
  onBack: () => void;
  onAgentDescribe: () => void;
  onSave: () => void;
  connectionName: string;
  contextPath: string;
  showDebug: boolean;
  realFileId: number | undefined;
  reduxState: RootState;
}

/** Sub-step 2: Add Data Context (text + agent) */
export default function StepContextDocsStep({
  isAgentRunning, docContent, hadExistingDocs, showAgentFeed, allDocs, onDocsChange,
  expandedDocIndices, onExpandedChange, knowledgeCounts, error, agentProgress, onSkip,
  saving, onBack, onAgentDescribe, onSave, connectionName, contextPath, showDebug,
  realFileId, reduxState,
}: StepContextDocsStepProps) {
  return (
    <VStack gap={6} align="stretch">
      <style>{cursorBlinkKeyframes}</style>

      {/* Header */}
      <Box>
        <Heading size="md" fontFamily="mono" fontWeight="500" mb={1}>
          Auto Documentation
        </Heading>
        <Text color="fg.muted" fontSize="sm">
          Documentation is where you describe your dataset, key metrics, and any other info the agent should know when querying this data.
        </Text>
      </Box>

      {/* Docs — hidden while agent is actively writing into an empty context */}
      {(!isAgentRunning || docContent.trim()) && <Box>
        <Text fontSize="sm" fontWeight="600" mb={2}>
          {hadExistingDocs ? 'Current Docs' : showAgentFeed ? 'Auto-generated context' : 'Data context'}
          <Text as="span" fontSize="xs" color="fg.subtle" ml={2}>
            {(hadExistingDocs || showAgentFeed) ? '(editable)' : '(optional, markdown)'}
          </Text>
        </Text>
        <ContextDocsEditor
          docs={allDocs.length ? allDocs : [{ content: '' }]}
          onDocsChange={onDocsChange}
          editorHeight="250px"
          entryLabel="Doc"
          showAddButton={false}
          showHelperText={false}
          showEmptyWarning={false}
          showDraftToggle={true}
          showAlwaysIncludeToggle={false}
          showChildPaths={false}
          showTitleDescription={true}
          expandedIndices={expandedDocIndices}
          onExpandedChange={onExpandedChange}
        />
      </Box>}

      {/* Structured-knowledge summary — metrics/annotations live in the Databases
          tab, not the docs editor above, so surface them here so they're visible. */}
      {(knowledgeCounts.metrics > 0 || knowledgeCounts.annotations > 0) && (
        <HStack
          gap={2}
          fontSize="xs"
          color="fg.muted"
          bg="bg.muted"
          borderRadius="md"
          px={3}
          py={2}
          flexWrap="wrap"
          aria-label="Added metrics and annotations summary"
        >
          <Icon as={LuSparkles} color="accent.teal" boxSize={3.5} />
          <Text>
            Also added
            {knowledgeCounts.metrics > 0 && <Text as="span" fontWeight="600" color="fg.default"> {knowledgeCounts.metrics} metric{knowledgeCounts.metrics === 1 ? '' : 's'}</Text>}
            {knowledgeCounts.metrics > 0 && knowledgeCounts.annotations > 0 && ' and'}
            {knowledgeCounts.annotations > 0 && <Text as="span" fontWeight="600" color="fg.default"> {knowledgeCounts.annotations} annotation{knowledgeCounts.annotations === 1 ? '' : 's'}</Text>}
            .
          </Text>
        </HStack>
      )}

      {/* Error */}
      {error && (
        <Text color="accent.danger" fontSize="sm">{error}</Text>
      )}

      {/* Progress bar + skip escape hatch */}
      <style>{`@keyframes shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }`}</style>
      {isAgentRunning && (
        <VStack gap={2} align="stretch" pt={2}>
          <Text fontSize="xs" fontFamily="mono" color="accent.teal">
            {getProgressMessage(agentProgress, [
              [0, 'Exploring your tables...'],
              [25, 'Reading column definitions...'],
              [50, 'Writing data documentation...'],
              [80, 'Finishing up...'],
              [100, 'Done!'],
            ])}
          </Text>
          <Progress.Root size="sm" value={agentProgress} flex={1} colorPalette="teal">
            <Progress.Track borderRadius="full" overflow="hidden">
              <Progress.Range
                style={{ transition: 'width 0.4s ease-out' }}
                css={{
                  position: 'relative',
                  '&::after': {
                    content: '""',
                    position: 'absolute',
                    inset: 0,
                    background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)',
                    animation: 'shimmer 1.5s ease-in-out infinite',
                  },
                }}
              />
            </Progress.Track>
          </Progress.Root>
          <HStack justify="flex-end">
            <Text
              as="button"
              fontSize="xs"
              color="fg.subtle"
              fontFamily="mono"
              cursor="pointer"
              _hover={{ color: 'fg.muted', textDecoration: 'underline' }}
              onClick={onSkip}
            >
              Skip & figure out later
            </Text>
          </HStack>
        </VStack>
      )}

      {/* Save progress bar */}
      {saving && (
        <SaveProgressBar />
      )}

      {/* Actions — hidden while agent is running or saving */}
      {!isAgentRunning && !saving && (
        <HStack justify="space-between" gap={3} pt={2}>
          <Button
            variant="ghost"
            size="sm"
            fontFamily="mono"
            onClick={onBack}
          >
            &larr; Back to tables
          </Button>
          <HStack gap={3}>
            {!showAgentFeed && (
              <Button
                bg="accent.teal"
                color="white"
                _hover={{ opacity: 0.9 }}
                size="sm"
                fontFamily="mono"
                onClick={onAgentDescribe}
                disabled={saving}
              >
                <LuSparkles size={14} />
                Let the agent figure it out
              </Button>
            )}
            <Button
              aria-label="Save context and continue"
              {...(showAgentFeed
                ? { bg: 'accent.teal', color: 'white', _hover: { opacity: 0.9 } }
                : { variant: 'outline' as const }
              )}
              size="sm"
              fontFamily="mono"
              onClick={onSave}
              disabled={saving}
            >
              {showAgentFeed ? 'Save & Continue' : 'Skip & Continue'}
            </Button>
          </HStack>
        </HStack>
      )}

      {/* Agent activity feed */}
      {showAgentFeed && (
        <AgentFeedCollapsible connectionName={connectionName} contextPath={contextPath} isRunning={isAgentRunning} />
      )}

      {/* Debug: appState */}
      {showDebug && realFileId && (
        <Collapsible.Root>
          <Collapsible.Trigger asChild>
            <HStack cursor="pointer" px={3} py={1.5} bg="bg.muted" borderRadius="md" gap={2}>
              <Text fontSize="xs" fontFamily="mono" color="fg.subtle">Debug: App State</Text>
              <Icon as={LuChevronRight} boxSize={3} color="fg.subtle" css={{ '[data-state=open] &': { transform: 'rotate(90deg)' }, transition: 'transform 0.15s' }} />
            </HStack>
          </Collapsible.Trigger>
          <Collapsible.Content>
            <Box mt={1} p={3} bg="bg.muted" borderRadius="md" maxH="200px" overflowY="auto">
              <Text fontSize="xs" fontFamily="mono" whiteSpace="pre-wrap">
                {JSON.stringify(
                  (() => {
                    const [aug] = selectAugmentedFiles(reduxState, [realFileId]);
                    return aug ? { type: 'file', state: compressAugmentedFile(aug) } : null;
                  })(),
                  null, 2
                )}
              </Text>
            </Box>
          </Collapsible.Content>
        </Collapsible.Root>
      )}
    </VStack>
  );
}
