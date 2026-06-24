'use client';

/**
 * CodeView — the admin "Code view" body for any user file.
 *
 * Centralizes what every file view used to re-implement: an editable JSON view
 * of the file's persistable content. It additionally exposes the read-only XML
 * markup the agent actually reads/edits (File Architecture v2, `fileToMarkup`),
 * switchable via a JSON | XML sub-toggle.
 *
 * Rendered by FileView when the header's view mode is "Code" — the single place
 * the visual-vs-code decision now lives.
 */
import { useState } from 'react';
import { Box, HStack } from '@chakra-ui/react';
import { LuBraces, LuCode } from 'react-icons/lu';
import TabSwitcher from '../TabSwitcher';
import JsonEditor from '../slides/JsonEditor';
import { useAppSelector } from '@/store/hooks';
import { selectMergedContent, selectPersistableContent } from '@/store/filesSlice';
import { applyJsonContentEdit } from '@/lib/api/file-state';
import { fileToMarkup } from '@/lib/data/file-markup';
import type { FileType } from '@/lib/types';

interface CodeViewProps {
  fileId: number;
  fileType: FileType;
  /** When true the JSON tab is editable (writes back via applyJsonContentEdit). */
  editable?: boolean;
}

export default function CodeView({ fileId, fileType, editable = false }: CodeViewProps) {
  const [tab, setTab] = useState<'json' | 'xml'>('json');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const persistableContent = useAppSelector(state => selectPersistableContent(state, fileId));
  const mergedContent = useAppSelector(state => selectMergedContent(state, fileId));

  return (
    <Box p={4} data-file-id={fileId}>
      <HStack mb={3}>
        <TabSwitcher
          tabs={[
            { value: 'json', label: 'JSON', icon: LuBraces },
            { value: 'xml', label: 'XML', icon: LuCode },
          ]}
          activeTab={tab}
          onTabChange={(t) => setTab(t as 'json' | 'xml')}
        />
      </HStack>

      {tab === 'json' ? (
        // Distinct `key` per tab: the JSON editor is uncontrolled (Monaco keeps its own
        // buffer), so without a remount, switching tabs would leave the previous tab's
        // text (and language) in the editor. Distinct keys force a clean remount.
        <JsonEditor
          key="json"
          value={JSON.stringify(persistableContent ?? mergedContent ?? {}, null, 2)}
          readOnly={!editable}
          error={jsonError}
          onChange={(value) => {
            const result = applyJsonContentEdit({ fileId, jsonString: value });
            setJsonError(result.success ? null : result.error ?? null);
          }}
        />
      ) : (
        // The exact agent-facing markup — read-only (it's a derived projection of content).
        <JsonEditor key="xml" language="xml" readOnly value={fileToMarkup(fileType, mergedContent ?? {})} />
      )}
    </Box>
  );
}
