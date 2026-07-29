import type { AgentEntry } from '@/lib/types';

/** Convert a user-facing custom-agent label into its stable internal key. */
export function canonicalizeUserAgentName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'agent';
}

/** Return a canonical key that does not collide with any existing agent key. */
export function uniqueUserAgentName(value: string, existingNames: Iterable<string>): string {
  const base = canonicalizeUserAgentName(value);
  const existing = new Set(Array.from(existingNames, (name) => name.toLowerCase()));
  let candidate = base;
  let suffix = 2;

  while (existing.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }

  return candidate;
}

/** Backward-compatible label for agents created before displayName existed. */
export function getUserAgentDisplayName(agent: Pick<AgentEntry, 'name' | 'displayName'>): string {
  if (agent.displayName?.trim()) return agent.displayName;
  return agent.name
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function buildAgentExploreHref({
  agentName,
  contextPath,
  contextVersion,
  currentSearchParams,
}: {
  agentName: string;
  contextPath?: string;
  contextVersion?: number;
  currentSearchParams?: Pick<URLSearchParams, 'get'>;
}): string {
  const params = new URLSearchParams();
  params.set('agent', agentName);
  if (contextPath) params.set('context', contextPath);
  if (contextVersion !== undefined) params.set('contextVersion', String(contextVersion));

  for (const key of ['as_user', 'mode', 'view']) {
    const value = currentSearchParams?.get(key);
    if (value) params.set(key, value);
  }

  return `/explore?${params.toString()}`;
}
