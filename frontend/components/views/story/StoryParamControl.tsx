'use client';

/**
 * StoryParamControl — the reader-facing filter input a story's `<Param>` renders to (File
 * Architecture v2). It writes to the shared param context (AgentHtml `values`); every
 * embedded `<Question>` re-runs with the new value.
 *
 * A source-less `<Param>` renders a labelled text/number/date input. A `<Param id={N} column>`
 * (one that imports a question column) instead renders the shared SourceDropdownWidget for
 * autocomplete from that column's distinct values.
 */
import { Box, Text, Input } from '@chakra-ui/react';
import type { StoryParam } from '@/lib/data/story-params';
import { SourceDropdownWidget } from '@/components/ParameterInput';

interface Props {
  param: StoryParam;
  value: unknown;
  onChange: (value: string | null) => void;
}

export default function StoryParamControl({ param, value, onChange }: Props) {
  // When the param imports a question column (<Param id={N} column="c">), offer autocomplete
  // from that column's distinct values; otherwise a plain typed input.
  const useDropdown = !!param.source && param.type !== 'date';
  return (
    <Box display="inline-flex" flexDirection="column" gap={1} minW="160px">
      {/* Inherit the story's own text color (with slight muting) so the label stays legible on
          any story surface — an app `fg.muted` token would resolve to the host app's color mode
          across the shadow boundary and can vanish on a contrasting story background. */}
      <Text fontSize="xs" fontWeight={600} color="inherit" opacity={0.7} textTransform="capitalize">
        {param.name}
      </Text>
      {useDropdown && param.source ? (
        <SourceDropdownWidget
          key={String(value ?? '')}
          source={{ type: 'question', id: param.source.questionId, column: param.source.column }}
          paramType={param.type === 'number' ? 'number' : 'text'}
          currentValue={value == null ? undefined : (value as string | number)}
          paramName={param.name}
          onChange={(v) => onChange(v === '' || v == null ? null : String(v))}
        />
      ) : (
        <Input
          size="sm"
          type={param.type === 'number' ? 'number' : param.type === 'date' ? 'date' : 'text'}
          aria-label={`param ${param.name}`}
          value={value == null ? '' : String(value)}
          placeholder={param.nullable ? 'Any' : `Enter ${param.name}`}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
          // Explicit light colors: Chakra surface/fg tokens resolve against the host app's color
          // mode across the story shadow boundary, painting this black on a light story. A
          // self-contained light form control stays legible on any story surface (see SourceDropdownWidget).
          bg="white"
          color="gray.900"
          borderColor="gray.300"
          _placeholder={{ color: 'gray.500' }}
        />
      )}
    </Box>
  );
}
