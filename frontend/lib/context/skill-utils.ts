import type { SkillEntry } from '@/lib/types';

/** Convert a user-facing custom-skill label into its stable internal key. */
export function canonicalizeUserSkillName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'skill';
}

/** Return a canonical key that does not collide with any existing skill key. */
export function uniqueUserSkillName(value: string, existingNames: Iterable<string>): string {
  const base = canonicalizeUserSkillName(value);
  const existing = new Set(Array.from(existingNames, (name) => name.toLowerCase()));
  let candidate = base;
  let suffix = 2;

  while (existing.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }

  return candidate;
}

/** Backward-compatible label for skills created before displayName existed. */
export function getUserSkillDisplayName(skill: Pick<SkillEntry, 'name' | 'displayName'>): string {
  if (skill.displayName?.trim()) return skill.displayName;
  return skill.name
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
