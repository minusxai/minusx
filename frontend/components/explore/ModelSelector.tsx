'use client';

import { useEffect, useMemo, useState } from 'react';
import { Box } from '@chakra-ui/react';
import { SearchableSelect, type SearchableOption } from '@/components/selectors/SearchableSelect';
import type { ChatModelCatalog, ChatModelSelection } from '@/lib/llm/llm-config-types';

const DEFAULT_VALUE = '__configured_default__';

function selectionValue(selection: ChatModelSelection): string {
  return JSON.stringify([selection.providerName, selection.model ?? null]);
}

export function ModelSelector({
  value,
  onChange,
  disabled = false,
}: {
  value: ChatModelSelection | null;
  onChange: (value: ChatModelSelection | null) => void;
  disabled?: boolean;
}) {
  const [catalog, setCatalog] = useState<ChatModelCatalog | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/llm/chat-models', { credentials: 'include' })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (!cancelled && body?.data?.defaultModel && Array.isArray(body.data.models)) {
          setCatalog(body.data as ChatModelCatalog);
        }
      })
      .catch(() => { /* The configured default still works when metadata is unavailable. */ });
    return () => { cancelled = true; };
  }, []);

  const { options, selections } = useMemo(() => {
    const nextSelections = new Map<string, ChatModelSelection | null>();
    nextSelections.set(DEFAULT_VALUE, null);
    const nextOptions: SearchableOption[] = [{
      value: DEFAULT_VALUE,
      label: catalog ? `Default · ${catalog.defaultModel.modelLabel}` : 'Default model',
      subtitle: catalog?.defaultModel.providerLabel,
      group: 'Configured default',
    }];
    for (const model of catalog?.models ?? []) {
      const key = selectionValue(model);
      nextSelections.set(key, { providerName: model.providerName, ...(model.model ? { model: model.model } : {}) });
      nextOptions.push({
        value: key,
        label: model.modelLabel,
        subtitle: model.model && model.model !== model.modelLabel ? model.model : undefined,
        group: model.providerLabel,
      });
    }
    return { options: nextOptions, selections: nextSelections };
  }, [catalog]);

  return (
    <Box w={{ base: '120px', md: '170px' }} minW="0">
      <SearchableSelect
        value={value ? selectionValue(value) : DEFAULT_VALUE}
        onChange={(next) => onChange(selections.get(next) ?? null)}
        options={options}
        label="Chat model"
        emptyMessage="No chat models configured"
        size="sm"
        disabled={disabled}
      />
    </Box>
  );
}
