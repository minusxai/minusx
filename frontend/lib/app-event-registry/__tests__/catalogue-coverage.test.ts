// Every event declared in the AppEvents catalogue must have at least one real
// publisher in source (a declared-but-never-published event is catalogue drift —
// FOLDER_CREATED sat unpublished for months before being deleted). This scans
// the source tree for `publish(AppEvents.<KEY>` occurrences, so adding an event
// without wiring its publisher fails here rather than in an audit.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { AppEvents } from '@/lib/app-event-registry/events';

const ROOTS = ['app', 'lib', 'agents', 'components', 'store'];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__' || name === '__mocks__') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe('AppEvents catalogue coverage', () => {
  it('every declared event has at least one publisher in source', () => {
    const published = new Set<string>();
    for (const root of ROOTS) {
      for (const file of sourceFiles(join(process.cwd(), root))) {
        const text = readFileSync(file, 'utf8');
        for (const m of text.matchAll(/publish\(\s*AppEvents\.(\w+)/g)) published.add(m[1]);
      }
    }
    const unpublished = Object.keys(AppEvents).filter((k) => !published.has(k));
    expect(unpublished, `declared in events.ts but never published: ${unpublished.join(', ')}`).toEqual([]);
  });
});
