'use client';

import { memo, useCallback, useMemo } from 'react';
import { useConnections } from '@/lib/hooks/useConnections';
import { useAppSelector } from '@/store/hooks';
import { selectConnectionsLoading } from '@/store/filesSlice';
import { LuDatabase } from 'react-icons/lu';
import GenericSelector, { SelectorOption } from './GenericSelector';
import { connectionTypeToDialect, FullQuery } from '@/lib/types';
import { useStableCallback, shallowEqualExcept } from '@/lib/hooks/use-stable-callback';

interface DatabaseSelectorProps {
  value: string;
  onChange: (connection: Pick<FullQuery, 'connection_name' | 'dialect'>) => void;
  size?: 'sm' | 'md';
  compact?: boolean;
}

function DatabaseSelectorInner({
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

  // Compact mode is only for the unambiguous single-connection case (icon + check).
  // With MORE than one connection the active database must stay visible at all times —
  // a collapsed icon makes it easy to miss that a query is running against the wrong
  // connection — so fall back to the full labeled dropdown.
  const effectiveCompact = compact && options.length <= 1;

  // Wrap the caller's onChange in a stable identity so handleChange below is
  // also stable (it only depends on connectionsMap, which is already stable
  // through the hook's own memoisation).
  const stableOnChange = useStableCallback(onChange);
  const handleChange = useCallback((connection_name: string) => {
    const conn = connectionsMap[connection_name];
    const dialect = connectionTypeToDialect(conn?.metadata?.type ?? '');
    stableOnChange({ connection_name, dialect });
  }, [connectionsMap, stableOnChange]);

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
      compact={effectiveCompact}
      compactLabel="Database"
    />
  );
}

// `onChange` is consumed through a ref so its identity doesn't matter for
// memoisation. Other props are shallow-compared.
export default memo(DatabaseSelectorInner, (prev, next) => shallowEqualExcept(prev, next, ['onChange']));
