/**
 * LimitInput - Simple number input for LIMIT clause
 */

'use client';

import { Box, Text, HStack, Input } from '@chakra-ui/react';
import { LuHash } from 'react-icons/lu';

interface LimitInputProps {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
}

export function LimitInput({ value, onChange }: LimitInputProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const num = parseInt(e.target.value, 10);
    if (isNaN(num) || num <= 0) {
      onChange(undefined);
    } else {
      onChange(num);
    }
  };

  return (
    <Box>
      <Text fontSize="sm" fontWeight="medium" mb={2}>
        <HStack gap={1}>
          <LuHash />
          <span>LIMIT</span>
        </HStack>
      </Text>
      <Input
        type="number"
        value={value || ''}
        onChange={handleChange}
        min={1}
        size="sm"
        width="150px"
        placeholder="No limit"
      />
    </Box>
  );
}
