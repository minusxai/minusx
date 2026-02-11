'use client';

import { Box, Text, Input } from '@chakra-ui/react';
import { BaseConfigProps } from './types';

export default function DuckDBConfig({ config, onChange }: BaseConfigProps) {
  const filePath = config.file_path || '';

  return (
    <Box>
      <Text fontSize="sm" fontWeight="700" mb={2}>
        Database File Path
      </Text>
      <Input
        value={filePath}
        onChange={(e) => onChange({ ...config, file_path: e.target.value })}
        placeholder="./my-database.duckdb"
        fontFamily="mono"
      />
      <Text fontSize="xs" color="fg.muted" mt={1}>
        Path to the DuckDB database file inside the <span style={{ fontFamily: 'mono', color: 'var(--chakra-colors-accent-danger)' }}>data/</span> directory in root.
      </Text>
    </Box>
  );
}
