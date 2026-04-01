'use client';

import { useMemo } from 'react';
import { useConnections } from '@/lib/hooks/useConnections';
import { useAppSelector } from '@/store/hooks';
import { selectConnectionsLoading } from '@/store/filesSlice';
import { LuDatabase } from 'react-icons/lu';
import GenericSelector, { SelectorOption } from './GenericSelector';

interface DatabaseSelectorProps {
  value: string;
  onChange: (database_name: string) => void;
  size?: 'sm' | 'md';
  allowedDatabaseNames?: string[];
}

export default function DatabaseSelector({
  value,
  onChange,
  size = 'sm',
  allowedDatabaseNames,
}: DatabaseSelectorProps) {
  // Get connections using hook (display-only component, so skip fetching)
  const { connections: connectionsMap } = useConnections({ skip: true });

  const options: SelectorOption[] = useMemo(() => {
    const allOptions = Object.values(connectionsMap).map(conn => ({
      value: conn.metadata.name,
      label: conn.metadata.name,
      subtitle: conn.metadata.type,
    }));
    if (!allowedDatabaseNames) return allOptions;
    const allowed = new Set(allowedDatabaseNames);
    return allOptions.filter(opt => allowed.has(opt.value));
  }, [connectionsMap, allowedDatabaseNames]);

  // Check if connections are loading from Redux (this fixes the "No connection" flash bug)
  const connectionsLoading = useAppSelector(selectConnectionsLoading);

  return (
    <GenericSelector
      value={value}
      onChange={onChange}
      options={options}
      loading={connectionsLoading}
      placeholder="No connection"
      emptyMessage="No databases available"
      singleOptionLabel="DB Connected"
      defaultIcon={LuDatabase}
      size={size}
      color="accent.primary"
      label="Database selector"
    />
  );
}
