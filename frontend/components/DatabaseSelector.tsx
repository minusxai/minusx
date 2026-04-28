'use client';

import { useMemo } from 'react';
import { useConnections } from '@/lib/hooks/useConnections';
import { useAppSelector } from '@/store/hooks';
import { selectConnectionsLoading } from '@/store/filesSlice';
import { LuDatabase } from 'react-icons/lu';
import GenericSelector, { SelectorOption } from './GenericSelector';
import { connectionTypeToDialect, FullQuery } from '@/lib/types';

interface DatabaseSelectorProps {
  value: string;
  onChange: (connection: Pick<FullQuery, 'connection_name' | 'dialect'>) => void;
  size?: 'sm' | 'md';
  compact?: boolean;
}

export default function DatabaseSelector({
  value,
  onChange,
  size = 'sm',
  compact = false,
}: DatabaseSelectorProps) {
  // Get connections using hook (display-only component, so skip fetching)
  const { connections: connectionsMap } = useConnections({ skip: true });

  const options: SelectorOption[] = useMemo(() => {
    return Object.values(connectionsMap).map(conn => ({
      value: conn.metadata.name,
      label: conn.metadata.name,
      subtitle: conn.metadata.type,
    }));
  }, [connectionsMap]);

  // Check if connections are loading from Redux (this fixes the "No connection" flash bug)
  const connectionsLoading = useAppSelector(selectConnectionsLoading);

  const handleChange = (connection_name: string) => {
    const conn = connectionsMap[connection_name];
    const dialect = connectionTypeToDialect(conn?.metadata?.type ?? '');
    onChange({ connection_name, dialect });
  };

  return (
    <GenericSelector
      value={value}
      onChange={handleChange}
      options={options}
      loading={connectionsLoading}
      placeholder="No connection"
      emptyMessage="No databases available"
      singleOptionLabel="DB Connected"
      defaultIcon={LuDatabase}
      size={size}
      color="accent.primary"
      label="Database selector"
      compact={compact}
      compactLabel="Database"
    />
  );
}
