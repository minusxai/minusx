'use client';

/**
 * Setup-wizard step 0: connect an AI model provider. Reuses the settings
 * `LlmModelsSection` (providers + test connection + optional assignments);
 * skippable — a deployment configured via env vars works without it.
 */

import { Box, Button, Flex, Text } from '@chakra-ui/react';
import { LuArrowRight } from 'react-icons/lu';
import { LlmModelsSection } from '@/components/settings/llm/LlmModelsSection';

export default function StepModels({ onComplete, greeting }: {
  onComplete: () => void;
  greeting?: string;
}) {
  return (
    <Box>
      <Text fontSize="lg" fontWeight="semibold" fontFamily="mono" mb={1}>
        {greeting ?? 'Connect an AI model'}
      </Text>
      <Text fontSize="sm" color="fg.muted" fontFamily="mono" mb={6}>
        Pick the LLM that powers your analyst. Choose MinusX for a fully managed setup, or bring your own API key.
      </Text>
      <LlmModelsSection variant="wizard" />
      <Flex justify="flex-end" mt={6}>
        <Button
          size="sm" bg="accent.teal" color="white" fontFamily="mono"
          onClick={onComplete}
          aria-label="Continue to data connection"
        >
          Continue <LuArrowRight />
        </Button>
      </Flex>
    </Box>
  );
}
