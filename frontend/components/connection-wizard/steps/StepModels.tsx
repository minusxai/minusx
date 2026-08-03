'use client';

/**
 * Setup-wizard step 0: connect an AI model provider. Reuses the settings
 * `LlmModelsSection` (providers + test connection + optional grade mappings).
 *
 * NOT skippable. Every later step runs an agent — auto-documentation and dashboard generation both
 * call the LLM — so a workspace that leaves here without a provider that can authenticate finishes
 * setup unable to do the one thing it exists for, while the final screen says "You're all set!".
 * `Continue` therefore waits on {@link hasUsableLlmProvider}, which asks whether a provider can
 * AUTHENTICATE rather than whether a row exists: `Add provider` writes a `minusx` row, and an
 * install with no gateway shared secret never receives a key for it.
 */

import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { LuArrowRight } from 'react-icons/lu';
import { LlmModelsSection } from '@/components/settings/llm/LlmModelsSection';
import { useConfigs } from '@/lib/hooks/useConfigs';
import { hasUsableLlmProvider } from '@/lib/llm/llm-config-types';

export default function StepModels({ onComplete, greeting }: {
  onComplete: () => void;
  greeting?: string;
}) {
  const { config } = useConfigs();
  const ready = hasUsableLlmProvider(config.llm);

  return (
    <Box>
      <Text fontSize="lg" fontWeight="semibold" fontFamily="mono" mb={1}>
        {greeting ?? 'Connect an AI model'}
      </Text>
      <Text fontSize="sm" color="fg.muted" fontFamily="mono" mb={6}>
        MinusX needs an LLM to run. Add a provider and its API key, then save — the rest of setup
        uses it to document your data and build your first dashboard.
      </Text>
      <LlmModelsSection variant="wizard" />
      <Flex justify="flex-end" align="center" gap={3} mt={6}>
        {!ready && (
          <Text fontSize="xs" color="fg.muted" fontFamily="mono" aria-label="Provider required">
            Add a provider with an API key and save to continue.
          </Text>
        )}
        <Button
          size="sm" bg="accent.teal" color="white" fontFamily="mono"
          onClick={onComplete}
          disabled={!ready}
          aria-label="Continue to data connection"
        >
          Continue <LuArrowRight />
        </Button>
      </Flex>
    </Box>
  );
}
