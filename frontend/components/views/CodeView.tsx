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
  /**
   * Content keys to HIDE from the JSON/XML view (e.g. context's loader-computed
   * `fullSchema`/`parentSchema`/`fullDocs` — derived, not authored). They're still
   * preserved on edit: the omitted values are merged back before saving, so editing
   * the trimmed JSON never drops them.
   */
  omitKeys?: readonly string[];
}

/** Shallow-copy `obj` without the given top-level keys. */
function omit(obj: unknown, keys: readonly string[]): unknown {
  if (!keys.length || !obj || typeof obj !== 'object') return obj;
  const rest: Record<string, unknown> = { ...(obj as Record<string, unknown>) };
  for (const k of keys) delete rest[k];
  return rest;
}

export default function CodeView({ fileId, fileType, editable = false, omitKeys = [] }: CodeViewProps) {
  const [tab, setTab] = useState<'json' | 'xml'>('json');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const persistableContent = useAppSelector(state => selectPersistableContent(state, fileId));
  const mergedContent = useAppSelector(state => selectMergedContent(state, fileId));

  const fullContent = (persistableContent ?? mergedContent ?? {}) as Record<string, unknown>;
  const displayContent = omit(fullContent, omitKeys);

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
          value={JSON.stringify(displayContent, null, 2)}
          readOnly={!editable}
          error={jsonError}
          onChange={(value) => {
            // Merge the hidden keys back so editing the trimmed JSON never drops them.
            let toApply = value;
            if (omitKeys.length) {
              try {
                const parsed = JSON.parse(value);
                if (parsed && typeof parsed === 'object') {
                  for (const k of omitKeys) {
                    if (k in fullContent) (parsed as Record<string, unknown>)[k] = fullContent[k];
                  }
                  toApply = JSON.stringify(parsed, null, 2);
                }
              } catch {
                // Leave `value` as-is; applyJsonContentEdit surfaces the parse error.
              }
            }
            const result = applyJsonContentEdit({ fileId, jsonString: toApply });
            setJsonError(result.success ? null : result.error ?? null);
          }}
        />
      ) : (
        // The agent-facing markup — read-only (it's a derived projection of content).
        <JsonEditor key="xml" language="xml" readOnly value={fileToMarkup(fileType, displayContent)} />
      )}
    </Box>
  );
}
