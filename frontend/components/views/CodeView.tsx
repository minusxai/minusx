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
import { LuBraces, LuCode } from 'react-icons/lu';
import TabSwitcher from '../selectors/TabSwitcher';
import JsonEditor from '../slides/JsonEditor';
import { applyJsonContentEdit } from '@/lib/file-state/file-state';
import { fileToMarkup } from '@/lib/data/story/file-markup';
import type { FileType } from '@/lib/types';

interface CodeViewProps {
  fileId: number;
  fileType: FileType;
  /** file.persistableChanges-merged content (selectPersistableContent), sourced by the caller. */
  persistableContent: unknown;
  /** Fully merged content incl. non-persistable fields (selectMergedContent), sourced by the caller. */
  mergedContent: unknown;
  /** When true the JSON tab is editable (writes back via applyJsonContentEdit). */
  editable?: boolean;
  /**
   * Content keys to HIDE from the JSON/XML view (e.g. context's loader-computed
   * `fullSchema`/`parentSchema`/`fullDocs` — derived, not authored). They're still
   * preserved on edit: the omitted values are merged back before saving, so editing
   * the trimmed JSON never drops them.
   */
  omitKeys?: readonly string[];
  /**
   * Optional transform mapping the saved content to the AGENT's view of it. Supply when the agent
   * sees a different shape than the saved file (context: `shapeContextForAgent` flattens the live
   * version). When given, the Code view shows three stages — "File JSON" (the saved content), "Agent
   * JSON" (the transformed view), and "Agent XML" (its markup) — both agent tabs read-only. When
   * omitted, the file IS the agent view, so just JSON | XML are shown.
   */
  xmlContentTransform?: (content: unknown) => unknown;
}

/** Shallow-copy `obj` without the given top-level keys. */
function omit(obj: unknown, keys: readonly string[]): unknown {
  if (!keys.length || !obj || typeof obj !== 'object') return obj;
  const rest: Record<string, unknown> = { ...(obj as Record<string, unknown>) };
  for (const k of keys) delete rest[k];
  return rest;
}

export default function CodeView({ fileId, fileType, persistableContent, mergedContent, editable = false, omitKeys = [], xmlContentTransform }: CodeViewProps) {
  const [tab, setTab] = useState<'json' | 'agentJson' | 'xml'>('json');
  const [jsonError, setJsonError] = useState<string | null>(null);

  const fullContent = (persistableContent ?? mergedContent ?? {}) as Record<string, unknown>;
  const displayContent = omit(fullContent, omitKeys);
  // The agent's view of the content. For most file types this is identical to the saved file, so we
  // show just JSON | XML. For context a transform is supplied (shapeContextForAgent) and the agent's
  // view DIFFERS from the file — so we expose three stages of the pipeline:
  //   File JSON  ──omitKeys──▶  (shown) │ ──xmlContentTransform──▶  Agent JSON │ ──fileToMarkup──▶  Agent XML
  const agentView = xmlContentTransform ? xmlContentTransform(fullContent) : displayContent;
  const tabs = xmlContentTransform
    ? [
        { value: 'json', label: 'File JSON', icon: LuBraces },
        { value: 'agentJson', label: 'Agent JSON', icon: LuBraces },
        { value: 'xml', label: 'Agent XML', icon: LuCode },
      ]
    : [
        { value: 'json', label: 'JSON', icon: LuBraces },
        { value: 'xml', label: 'XML', icon: LuCode },
      ];

  return (
    <div className="p-4" data-file-id={fileId}>
      <div className="mb-3 flex items-center gap-2">
        <TabSwitcher
          tabs={tabs}
          activeTab={tab}
          onTabChange={(t) => setTab(t as typeof tab)}
        />
      </div>

      {/* Distinct `key` per tab: the JSON editor is uncontrolled (Monaco keeps its own buffer), so
          without a remount, switching tabs would leave the previous tab's text (and language) in the
          editor. Distinct keys force a clean remount. */}
      {tab === 'json' ? (
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
      ) : tab === 'agentJson' ? (
        // The agent's view as JSON — read-only (derived from the file via xmlContentTransform).
        <JsonEditor key="agentJson" readOnly value={JSON.stringify(agentView, null, 2)} />
      ) : (
        // The agent-facing markup — read-only (fileToMarkup of the agent's view).
        <JsonEditor key="xml" language="xml" readOnly value={fileToMarkup(fileType, agentView)} />
      )}
    </div>
  );
}
