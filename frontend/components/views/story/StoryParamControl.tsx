'use client';

/**
 * StoryParamControl — the reader-facing filter input a story's `<Param>` renders to (File
 * Architecture v2). It writes to the shared param context (AgentHtml `values`); every
 * embedded `<Question>` re-runs with the new value.
 *
 * v1 is a clean labelled text/number/date input. Autocomplete from the param's `source`
 * (a question column) is a follow-up — the source is already captured on the StoryParam, so
 * it can reuse the existing source-dropdown widget later without changing this contract.
 */
import { Box, Text, Input } from '@chakra-ui/react';
import type { StoryParam } from '@/lib/data/story-params';

interface Props {
  param: StoryParam;
  value: unknown;
  onChange: (value: string | null) => void;
}

export default function StoryParamControl({ param, value, onChange }: Props) {
  const inputType = param.type === 'number' ? 'number' : param.type === 'date' ? 'date' : 'text';
  return (
    <Box display="inline-flex" flexDirection="column" gap={1} minW="160px">
      <Text fontSize="xs" fontWeight={600} color="fg.muted" textTransform="capitalize">
        {param.name}
      </Text>
      <Input
        size="sm"
        type={inputType}
        aria-label={`param ${param.name}`}
        value={value == null ? '' : String(value)}
        placeholder={param.nullable ? 'Any' : `Enter ${param.name}`}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      />
    </Box>
  );
}
