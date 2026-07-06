'use client';

import { useAppSelector } from '@/store/hooks';
import { shallowEqual } from 'react-redux';
import { resolveHomeFolderSync, isUnderSystemFolder } from '@/lib/mode/path-resolver';
import { isAdmin } from '@/lib/auth/role-helpers';
import { LuNotebookText } from 'react-icons/lu';
import { memo, useEffect, useMemo } from 'react';
import { ContextContent } from '@/lib/types';
import GenericSelector, { SelectorOption } from '@/components/selectors/GenericSelector';
import { useContexts } from '@/lib/hooks/useContexts';
import { useStableCallback, shallowEqualExcept } from '@/lib/hooks/use-stable-callback';

interface ContextSelectorProps {
  selectedContextPath: string | null;
  selectedVersion?: number;
  onSelectContext: (contextPath: string | null, version?: number) => void;
  compact?: boolean;
}

function ContextSelectorInner({ selectedContextPath, selectedVersion, onSelectContext, compact = false }: ContextSelectorProps) {
  // Stable identity for onSelectContext so the auto-select effect and the
  // inline onChange handler don't churn this component when the caller passes
  // a fresh closure each render.
  const stableOnSelectContext = useStableCallback(onSelectContext);
  const user = useAppSelector(state => state.auth.user);

  // Triggers context loading and provides accurate loading state.
  // Must be called before early returns to satisfy Rules of Hooks.
  const { loading: contextsLoading } = useContexts();
  // shallowEqual: avoid re-running the context-list useMemo when Immer rotates
  // the bag ref but no entry differs (i.e. unrelated file/dashboard writes).
  const filesState = useAppSelector(state => state.files.files, shallowEqual);

  const homeFolder = user ? resolveHomeFolderSync(user.mode, user.home_folder || '') : '';

  const mode = user?.mode || 'org';
  const allContexts = useMemo(() => {
    if (!user) return [];
    return Object.values(filesState)
      .filter(file => file.type === 'context' && file.path.startsWith(homeFolder) && file.id > 0
        && !isUnderSystemFolder(file.path, mode));
  }, [filesState, user, homeFolder, mode]);

  const contexts = useMemo(() => allContexts.map(file => ({
    id: file.id,
    path: file.path,
    name: file.name,
    displayName: file.path.split('/').filter(Boolean).slice(-2, -1)[0] || file.name,
    content: file.content as ContextContent
  })), [allContexts]);

  const homeContext = useMemo(() => allContexts.find(file => {
    const relativePath = file.path.substring(homeFolder.length);
    if (!relativePath.startsWith('/')) return false;
    return relativePath.split('/').filter(Boolean).length === 1;
  }), [allContexts, homeFolder]);
  const homeContextPath = homeContext?.path;

  // Auto-select home context only when nothing is selected yet (initial mount)
  useEffect(() => {
    if (!selectedContextPath && homeContextPath) {
      const content = homeContext?.content as ContextContent | undefined;
      const publishedVersion = content?.published?.all;
      if (publishedVersion) {
        stableOnSelectContext(homeContextPath, publishedVersion);
      }
    }
  }, [selectedContextPath, homeContextPath, homeContext, stableOnSelectContext]);

  // Build options for GenericSelector
  const options = useMemo((): SelectorOption[] => {
    const result: SelectorOption[] = [];

    for (const ctx of contexts) {
      const content = ctx.content;
      const versions = content?.versions || [];

      if (versions.length <= 1) {
        result.push({
          value: ctx.path,
          label: ctx.displayName,
        });
      } else {
        const publishedVersion = content?.published?.all;
        for (const v of versions) {
          result.push({
            value: `${ctx.path}:${v.version}`,
            label: ctx.displayName,
            subtitle: `v${v.version} - ${v.description}`,
            showCheckmark: v.version === publishedVersion,
          });
        }
      }
    }

    return result.sort((a, b) => a.label.localeCompare(b.label));
  }, [contexts]);

  // Build current value - find matching option
  // Must always resolve to an existing option value so GenericSelector doesn't fall back to options[0].
  // Problem: contexts load partially (no versions) → path-only options. Once full content loads,
  // options switch to versioned format (path:N). If we still hold path-only currentValue it won't
  // match any option and GenericSelector silently shows options[0] (the "unselect" bug).
  const currentValue = useMemo(() => {
    if (!selectedContextPath) return '';

    // 1. Prefer exact versioned match when a version is already pinned
    if (selectedVersion !== undefined) {
      const versionedKey = `${selectedContextPath}:${selectedVersion}`;
      if (options.find(opt => opt.value === versionedKey)) return versionedKey;
    }

    // 2. Exact path match (single-version contexts that have no version suffix in options)
    const exactMatch = options.find(opt => opt.value === selectedContextPath);
    if (exactMatch) return exactMatch.value;

    // 3. Context now has full versions loaded — prefer the published (checkmarked) version
    const publishedMatch = options.find(
      opt => opt.value.startsWith(selectedContextPath + ':') && opt.showCheckmark
    );
    if (publishedMatch) return publishedMatch.value;

    // 4. Any version of this context (last resort — avoids falling through to options[0])
    const anyVersionMatch = options.find(opt => opt.value.startsWith(selectedContextPath + ':'));
    if (anyVersionMatch) return anyVersionMatch.value;

    return '';
  }, [selectedContextPath, selectedVersion, options]);

  if (!user) return null;

  // Non-admins don't see selector (only home context)
  if (!isAdmin(user.role)) {
    return null;
  }

  return (
    <GenericSelector
      value={currentValue}
      onChange={(val) => {
        const [path, versionStr] = val.split(':');
        const version = versionStr ? parseInt(versionStr) : undefined;
        stableOnSelectContext(path, version);
      }}
      options={options}
      loading={contextsLoading}
      placeholder="Select context"
      emptyMessage="No knowledge base"
      singleOptionLabel="Context Loaded"
      defaultIcon={LuNotebookText}
      size="sm"
      color="accent.warning"
      compact={compact}
      compactLabel="Knowledge Base"
    />
  );
}

// `onSelectContext` is consumed through a ref so its identity doesn't matter
// for memoisation; other props are shallow-compared. Pre-fix this component
// was flagged as 100% wasted in the perf trace.
export const ContextSelector = memo(ContextSelectorInner, (prev, next) => shallowEqualExcept(prev, next, ['onSelectContext']));
