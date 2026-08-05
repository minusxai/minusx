// install.sh lists the file-based connection types but cannot complete them —
// their config embeds an already-profiled schema only the app's upload pipeline
// can produce — so it deep-links to /new/connection?type=<type>. This maps that
// type onto the upload tab the wizard opens on. The last case is the one that
// matters over time: a new cli:false type with no tab would deep-link to a
// screen that cannot help, and nothing else would catch it.
import { describe, it, expect } from 'vitest';
import compatibility from '@/compatibility.json';
import { staticTabForConnectionType } from '../ConnectionWizardTypes';

describe('staticTabForConnectionType', () => {
  it('maps the file-based types onto their upload tab', () => {
    expect(staticTabForConnectionType('csv')).toBe('csv');
    // Excel rides the generic "Upload a data file" tab; there is no xlsx tab.
    expect(staticTabForConnectionType('xlsx')).toBe('csv');
    expect(staticTabForConnectionType('google-sheets')).toBe('sheets');
  });

  it('returns null for engines configured with plain fields', () => {
    expect(staticTabForConnectionType('postgresql')).toBeNull();
    expect(staticTabForConnectionType('bigquery')).toBeNull();
    expect(staticTabForConnectionType(undefined)).toBeNull();
    expect(staticTabForConnectionType('not-a-real-type')).toBeNull();
  });

  it('covers every connection type the installer defers to the app', () => {
    const types = compatibility.connections.types as Array<{ type: string; cli: boolean }>;
    const deferred = types.filter(t => !t.cli);
    expect(deferred.length).toBeGreaterThan(0);
    for (const t of deferred) {
      expect(
        staticTabForConnectionType(t.type),
        `${t.type} is deferred to the app but has no upload tab to open`
      ).not.toBeNull();
    }
  });
});
