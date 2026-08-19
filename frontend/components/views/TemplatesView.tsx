'use client';

/**
 * Templates — the app's own vocabulary, browsable but not owned.
 *
 * Everything here ships with MinusX: it is code, not documents, so it lives on
 * a page rather than in the file tree (a folder implies a context, an owner,
 * edit/move/delete and a place in resolution — none of which is true of code).
 * The file system is where a workspace OVERRIDES or EXTENDS this: "Copy to my
 * workspace" writes a real `.viz` file, and the normal nearest-ancestor
 * shadowing rules take over from there.
 *
 * Master/detail rather than a grid of live charts: each preview builds a Vega
 * view, and eleven at once is a lot of main-thread work for a page most people
 * skim. Pure presentation — the container owns Redux and navigation.
 */
import { useMemo, useState } from 'react';
import VizRecipeView from '@/components/views/VizRecipeView';
import type { CatalogEntry } from '@/lib/viz/recipe-catalog';

export interface TemplatesViewProps {
  entries: CatalogEntry[];
  colorMode: 'light' | 'dark';
  /** Write an editable copy of this entry into the user's workspace. */
  onCopy?: (entry: CatalogEntry) => void | Promise<void>;
}

/**
 * Three groups, not two: a template mounted through TEMPLATE_DIR is listed
 * apart from the app's own, because an operator checking their mount worked
 * should be able to see it at a glance rather than by reading descriptions.
 */
const GROUPS = [
  { key: 'deployment', label: 'From your deployment', match: (e: CatalogEntry) => e.origin === 'deployment' },
  { key: 'builtin', label: 'Built-in', match: (e: CatalogEntry) => e.tier === 'builtin' && e.origin !== 'deployment' },
  { key: 'shipped', label: 'Shipped', match: (e: CatalogEntry) => e.tier === 'shipped' },
] as const;

export default function TemplatesView({ entries, colorMode, onCopy }: TemplatesViewProps) {
  // Selection keys on `key`, not `name`: a deployment template and a shipped
  // recipe may share a name, and selecting by name would silently pick whichever
  // came first.
  const [selectedKey, setSelectedKey] = useState<string>(entries[0]?.key ?? '');
  const selected = useMemo(
    () => entries.find((e) => e.key === selectedKey) ?? entries[0],
    [entries, selectedKey],
  );

  const groups = useMemo(
    () => GROUPS.map((g) => ({ ...g, items: entries.filter(g.match) })).filter((g) => g.items.length > 0),
    [entries],
  );

  if (!selected) return null;

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      <nav aria-label="Visualization templates" className="w-56 shrink-0 overflow-y-auto">
        {groups.map((group) => (
          <div key={group.key} className="mb-4">
            <div className="px-2 pb-1 text-[10px] font-bold uppercase tracking-[0.05em] text-muted-foreground">
              {group.label}
            </div>
            <ul>
              {group.items.map((entry) => (
                <li key={entry.key}>
                  <button
                    type="button"
                    aria-label={`Template ${entry.name}`}
                    aria-pressed={entry.key === selected.key}
                    onClick={() => setSelectedKey(entry.key)}
                    className={`w-full rounded-md px-2 py-1.5 text-left font-mono text-sm transition-colors ${
                      entry.key === selected.key
                        ? 'bg-accent text-foreground'
                        : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                    }`}
                  >
                    {entry.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div aria-label="Template detail" className="min-w-0 flex-1 overflow-y-auto">
        <h2 className="pb-1 font-mono text-xl font-bold text-foreground">{selected.name}</h2>
        <VizRecipeView
          key={selected.key}
          content={selected.content}
          colorMode={colorMode}
          catalog={{ tier: selected.tier, recipeId: selected.recipeId, copyable: selected.copyable, origin: selected.origin }}
          previewAssets={selected.assets ?? null}
          previewSample={selected.previewSample ?? null}
          onCopyToWorkspace={onCopy ? () => onCopy(selected) : undefined}
        />
      </div>
    </div>
  );
}
