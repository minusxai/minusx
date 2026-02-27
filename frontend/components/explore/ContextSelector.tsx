'use client';

import { useAppSelector } from '@/store/hooks';
import { resolveHomeFolderSync } from '@/lib/mode/path-resolver';
import { isAdmin } from '@/lib/auth/role-helpers';
import { LuNotebookText } from 'react-icons/lu';
import { useEffect, useMemo } from 'react';
import { ContextContent } from '@/lib/types';
import GenericSelector, { SelectorOption } from '@/components/GenericSelector';
import { useContexts } from '@/lib/hooks/useContexts';

interface ContextSelectorProps {
  selectedContextPath: string | null;
  selectedVersion?: number;
  onSelectContext: (contextPath: string | null, version?: number) => void;
}

export function ContextSelector({ selectedContextPath, selectedVersion, onSelectContext }: ContextSelectorProps) {
  const user = useAppSelector(state => state.auth.user);

  // Triggers context loading and provides accurate loading state.
  // Must be called before early returns to satisfy Rules of Hooks.
  const { loading: contextsLoading } = useContexts();

  if (!user) return null;

  const homeFolder = resolveHomeFolderSync(user.mode, user.home_folder || '');
  const filesState = useAppSelector(state => state.files.files);

  const allContexts = Object.values(filesState)
    .filter(file => file.type === 'context')
    .filter(file => file.path.startsWith(homeFolder))
    .filter(file => file.id > 0);

  const contexts = allContexts.map(file => ({
    id: file.id,
    path: file.path,
    name: file.name,
    displayName: file.path.split('/').filter(Boolean).slice(-2, -1)[0] || file.name,
    content: file.content as ContextContent
  }));

  const homeContext = allContexts.find(file => {
    const relativePath = file.path.substring(homeFolder.length);
    if (!relativePath.startsWith('/')) return false;
    const remainingSegments = relativePath.split('/').filter(Boolean);
    return remainingSegments.length === 1;
  });
  const homeContextPath = homeContext?.path;

  // Auto-select home context only when nothing is selected yet (initial mount)
  useEffect(() => {
    if (!selectedContextPath && homeContextPath) {
      const content = homeContext?.content as ContextContent | undefined;
      const publishedVersion = content?.published?.all;
      if (publishedVersion) {
        onSelectContext(homeContextPath, publishedVersion);
      }
    }
  }, [selectedContextPath, homeContextPath, homeContext, onSelectContext]);

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

  // Non-admins don't see selector (only home context)
  if (!isAdmin(user.role)) {
    return null;
  }

  // Build current value - find matching option
  // When selectedVersion is undefined, find the first option matching the path (published version)
  const currentValue = useMemo(() => {
    if (selectedVersion) {
      return `${selectedContextPath}:${selectedVersion}`;
    }
    // Find option matching path (could be path alone or path:version for published)
    const exactMatch = options.find(opt => opt.value === selectedContextPath);
    if (exactMatch) return exactMatch.value;

    // For multi-version contexts, find the published version (first one matching path)
    const pathMatch = options.find(opt => opt.value.startsWith(selectedContextPath + ':'));
    if (pathMatch) return pathMatch.value;

    return selectedContextPath || '';
  }, [selectedContextPath, selectedVersion, options]);

  return (
    <GenericSelector
      value={currentValue}
      onChange={(val) => {
        const [path, versionStr] = val.split(':');
        const version = versionStr ? parseInt(versionStr) : undefined;
        onSelectContext(path, version);
      }}
      options={options}
      loading={contextsLoading}
      placeholder="Select context"
      emptyMessage="No knowledge base"
      singleOptionLabel="Context Loaded"
      defaultIcon={LuNotebookText}
      size="sm"
      color="accent.warning"
    />
  );
}
