/**
 * Notebook schema — `notebook` is a top-level file type whose content is an
 * ordered list of `cells`. Each cell is either a `sql` cell (a full inline
 * question: query/vizSettings/connection_name/parameters/@-references) or a
 * `text` cell (rich text stored as markdown). The TypeBox schema is the single
 * source of truth + agent-facing contract.
 */
import { validateFileState } from '@/lib/validation/content-validators';
import { atlasSchemaNoViz } from '@/lib/validation/atlas-json-schemas';
import { getTemplateDefaults } from '@/lib/data/template-defaults';
import { extractReferencesFromContent } from '@/lib/data/helpers/extract-references';

const sqlCell = {
  type: 'sql',
  id: 'c1',
  name: 'revenue',
  query: 'SELECT 1',
  vizSettings: { type: 'table' },
  parameters: [],
  parameterValues: {},
  connection_name: 'duckdb',
  references: [],
};

const textCell = {
  type: 'text',
  id: 'c2',
  name: null,
  content: '# Notes\n\nsome **markdown**',
};

describe('NotebookContent schema', () => {
  it('accepts an empty notebook file', () => {
    expect(validateFileState({ type: 'notebook', content: { description: null, cells: [] } })).toBeNull();
  });

  it('accepts a notebook with one sql cell and one text cell', () => {
    expect(validateFileState({
      type: 'notebook',
      content: { description: 'mixed', cells: [sqlCell, textCell] },
    })).toBeNull();
  });

  it('rejects a cell missing its id', () => {
    const { id, ...noId } = sqlCell;
    expect(validateFileState({
      type: 'notebook',
      content: { description: null, cells: [noId] },
    })).not.toBeNull();
  });

  it('rejects an unknown cell type', () => {
    expect(validateFileState({
      type: 'notebook',
      content: { description: null, cells: [{ type: 'chart', id: 'x' }] },
    })).not.toBeNull();
  });

  it('rejects a sql cell missing its query', () => {
    const { query, ...noQuery } = sqlCell;
    expect(validateFileState({
      type: 'notebook',
      content: { description: null, cells: [noQuery] },
    })).not.toBeNull();
  });

  it('rejects a wrong-typed cell field', () => {
    expect(validateFileState({
      type: 'notebook',
      content: { description: null, cells: [{ ...sqlCell, query: 123 }] },
    })).not.toBeNull();
  });

  it('getTemplateDefaults("notebook") validates clean', () => {
    const content = getTemplateDefaults('notebook');
    expect(content).toBeDefined();
    expect(validateFileState({ type: 'notebook', content })).toBeNull();
  });

  it('accepts a sql cell with @-references and extractReferences returns the ids', () => {
    const content = {
      description: null,
      cells: [
        { ...sqlCell, references: [{ id: 7, alias: 'orders' }, { id: 9, alias: 'users' }] },
        textCell,
      ],
    };
    expect(validateFileState({ type: 'notebook', content })).toBeNull();
    expect(extractReferencesFromContent(content as any, 'notebook').sort()).toEqual([7, 9]);
  });

  it('advertises AtlasNotebookFile in the agent-facing schema', () => {
    expect(JSON.stringify(atlasSchemaNoViz)).toContain('AtlasNotebookFile');
  });
});
