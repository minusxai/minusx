'use client';

import { Box, Text, Input } from '@chakra-ui/react';
import { BaseConfigProps } from './types';

export default function SqliteConfig({ config, onChange }: BaseConfigProps) {
  const filePath = config.file_path || '';

  return (
    <Box>
      <Text fontSize="sm" fontWeight="700" mb={2}>
        Database File Path
      </Text>
      <Input
        value={filePath}
        onChange={(e) => onChange({ ...config, file_path: e.target.value })}
        placeholder="./my-database.sqlite"
        fontFamily="mono"
      />
      <Text fontSize="xs" color="fg.muted" mt={1}>
        Relative to the project root
      </Text>
    </Box>
  );
}
