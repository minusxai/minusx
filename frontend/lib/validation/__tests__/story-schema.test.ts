/**
 * Story schema — DashboardContent carries `story`, a single agent-authored
 * HTML document rendered as a scrolling data-story page. The TypeBox schema
 * is the agent-facing contract: its description must advertise the fixed
 * 1280px-wide canvas and the chart-embed placeholder.
 */
import { validateFileState } from '@/lib/validation/content-validators';
import { atlasSchemaNoViz } from '@/lib/validation/atlas-json-schemas';

const baseDashboard = { description: null, assets: [], layout: null, parameterValues: null };

describe('DashboardContent story schema', () => {
  it('accepts a dashboard with an HTML story', () => {
    const error = validateFileState({
      type: 'dashboard',
      content: {
        ...baseDashboard,
        story: '<div style="width:1280px"><h1>Growth</h1><div data-question-id="5" style="width:1100px;height:420px"></div></div>',
      },
    });
    expect(error).toBeNull();
  });

  it('accepts a dashboard with no story / null story', () => {
    expect(validateFileState({ type: 'dashboard', content: baseDashboard })).toBeNull();
    expect(validateFileState({ type: 'dashboard', content: { ...baseDashboard, story: null } })).toBeNull();
  });

  it('rejects a non-string story', () => {
    expect(validateFileState({
      type: 'dashboard',
      content: { ...baseDashboard, story: [{ html: '<h1>nope</h1>' }] },
    })).not.toBeNull();
  });

  it('advertises the story canvas contract in the agent-facing schema', () => {
    const serialized = JSON.stringify(atlasSchemaNoViz);
    expect(serialized).toContain('1280px-wide');
  });
});
