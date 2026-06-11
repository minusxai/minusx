/**
 * Deck (presentation) schema — DashboardContent carries `deck`, an array of
 * agent-authored HTML slides. The TypeBox schema is the agent-facing contract:
 * its descriptions must advertise the chart-embed placeholder.
 */
import { validateFileState } from '@/lib/validation/content-validators';
import { atlasSchemaNoViz } from '@/lib/validation/atlas-json-schemas';

const baseDashboard = { description: null, assets: [], layout: null, parameterValues: null };

describe('DashboardContent deck schema', () => {
  it('accepts a dashboard with HTML deck slides', () => {
    const error = validateFileState({
      type: 'dashboard',
      content: {
        ...baseDashboard,
        deck: [
          { id: 's1', html: '<h1 style="position:absolute;top:40px">Hi</h1>' },
          { id: 's2', html: '<div data-question-id="5" style="width:600px;height:340px"></div>' },
        ],
      },
    });
    expect(error).toBeNull();
  });

  it('accepts a dashboard with no deck / null deck', () => {
    expect(validateFileState({ type: 'dashboard', content: baseDashboard })).toBeNull();
    expect(validateFileState({ type: 'dashboard', content: { ...baseDashboard, deck: null } })).toBeNull();
  });

  it('rejects slides missing id or with non-string html', () => {
    expect(validateFileState({
      type: 'dashboard',
      content: { ...baseDashboard, deck: [{ html: '<h1>no id</h1>' }] },
    })).not.toBeNull();
    expect(validateFileState({
      type: 'dashboard',
      content: { ...baseDashboard, deck: [{ id: 's1', html: 1 }] },
    })).not.toBeNull();
  });

  it('advertises the chart placeholder contract in the agent-facing schema', () => {
    const serialized = JSON.stringify(atlasSchemaNoViz);
    expect(serialized).toContain('data-question-id');
    expect(serialized).toContain('1280x720');
  });
});
