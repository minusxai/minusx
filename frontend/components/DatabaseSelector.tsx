'use client';

import { useMemo } from 'react';
import { useConnections } from '@/lib/hooks/useConnections';
import { useAppSelector } from '@/store/hooks';
import { LuDatabase } from 'react-icons/lu';
import GenericSelector, { SelectorOption } from './GenericSelector';

interface DatabaseSelectorProps {
  value: string;
  onChange: (database_name: string) => void;
  size?: 'sm' | 'md';
}

export default function DatabaseSelector({
  value,
  onChange,
  size = 'sm',
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
  const connectionsLoading = useAppSelector(state =>
    Object.values(state.files.files).some(f => f.type === 'connection' && f.loading === true)
  );

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
    />
  );
}
