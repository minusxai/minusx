import { isUnderSystemFolder } from '@/lib/mode/path-resolver';
import type { Mode } from '@/lib/mode/mode-types';
import type { ContextContent } from '@/lib/types';

export interface ContextSourceFile {
  id: number;
  path: string;
  name: string;
  type: string;
  content?: unknown;
}

export interface ContextSelectorOption {
  value: string;
  label: string;
  subtitle?: string;
  showCheckmark?: boolean;
}

/** Canonical eligibility rules shared by compact and expanded context pickers. */
export function getSelectableContextFiles(
  files: ContextSourceFile[],
  homeFolder: string,
  mode: Mode,
): ContextSourceFile[] {
  return files.filter((file) => (
    file.type === 'context'
    && file.path.startsWith(homeFolder)
    && file.id > 0
    && !isUnderSystemFolder(file.path, mode)
  ));
}

export function findHomeContext(
  contexts: ContextSourceFile[],
  homeFolder: string,
): ContextSourceFile | undefined {
  return contexts.find((file) => {
    const relativePath = file.path.substring(homeFolder.length);
    if (!relativePath.startsWith('/')) return false;
    return relativePath.split('/').filter(Boolean).length === 1;
  });
}

export function buildContextSelectorOptions(
  contexts: ContextSourceFile[],
): ContextSelectorOption[] {
  const result: ContextSelectorOption[] = [];

  for (const context of contexts) {
    const content = context.content as ContextContent | undefined;
    const versions = content?.versions ?? [];
    const displayName = context.path.split('/').filter(Boolean).slice(-2, -1)[0] || context.name;

    if (versions.length <= 1) {
      result.push({ value: context.path, label: displayName });
      continue;
    }

    const publishedVersion = content?.published?.all;
    for (const version of versions) {
      result.push({
        value: `${context.path}:${version.version}`,
        label: displayName,
        subtitle: `v${version.version} - ${version.description}`,
        showCheckmark: version.version === publishedVersion,
      });
    }
  }

  return result.sort((a, b) => a.label.localeCompare(b.label));
}

/** Resolve only to a real option so partially loaded version data never shows a false selection. */
export function resolveContextSelectorValue(
  options: ContextSelectorOption[],
  selectedContextPath: string | null,
  selectedVersion?: number,
): string {
  if (!selectedContextPath) return '';

  if (selectedVersion !== undefined) {
    const versionedKey = `${selectedContextPath}:${selectedVersion}`;
    if (options.some((option) => option.value === versionedKey)) return versionedKey;
  }

  const pathMatch = options.find((option) => option.value === selectedContextPath);
  if (pathMatch) return pathMatch.value;

  const publishedMatch = options.find(
    (option) => option.value.startsWith(`${selectedContextPath}:`) && option.showCheckmark,
  );
  if (publishedMatch) return publishedMatch.value;

  return options.find((option) => option.value.startsWith(`${selectedContextPath}:`))?.value ?? '';
}

export function parseContextSelectorValue(value: string): { path: string; version?: number } {
  const [path, versionString] = value.split(':');
  return {
    path,
    version: versionString ? Number.parseInt(versionString, 10) : undefined,
  };
}
