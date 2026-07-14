// Drift guard: every `cli: true` connection type in the shared
// compatibility.json must expose EXACTLY its spec'd fields in the app's
// connection form — labeled `<type> <field key>` (aria-label) so the spec,
// the setup.sh interview, and the in-app form can never silently diverge.
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ChakraProvider, defaultSystem } from '@chakra-ui/react';
import compatibility from '@/compatibility.json';
import PostgreSQLConfig from '../views/connection-configs/PostgreSQLConfig';
import BigQueryConfig from '../views/connection-configs/BigQueryConfig';
import AthenaConfig from '../views/connection-configs/AthenaConfig';
import ClickHouseConfig from '../views/connection-configs/ClickHouseConfig';

interface FormProps { config: Record<string, never>; onChange: () => void; mode: 'create' }
const FORMS: Record<string, (props: FormProps) => React.ReactElement> = {
  postgresql: (p) => <PostgreSQLConfig {...p} />,
  bigquery: (p) => <BigQueryConfig {...p} />,
  athena: (p) => <AthenaConfig {...p} />,
  clickhouse: (p) => <ClickHouseConfig {...p} />,
};

// postgresql renders in two modes; connection_string only exists in string
// mode, the rest only in fields mode. bigquery derives project_id from the
// pasted JSON and only displays it once known.
const MODE_SPLIT: Record<string, { config: Record<string, unknown>; excludes: string[] }[]> = {
  postgresql: [
    { config: {}, excludes: ['connection_string'] },
    { config: { connection_string: 'postgresql://u@h/db' }, excludes: ['host', 'port', 'database', 'username', 'password'] },
  ],
  bigquery: [
    { config: { project_id: 'demo-project', service_account_json: '{}' }, excludes: [] },
  ],
};

function renderForm(type: string, config: Record<string, unknown>) {
  return render(
    <ChakraProvider value={defaultSystem}>
      {FORMS[type]({ config: config as Record<string, never>, onChange: () => {}, mode: 'create' })}
    </ChakraProvider>,
  );
}

describe('connection forms match compatibility.json field specs', () => {
  const cliTypes = (compatibility.connections.types as { type: string; fields: { key: string }[]; cli: boolean }[])
    .filter(t => t.cli);

  it('covers every cli-supported type with a form', () => {
    for (const t of cliTypes) {
      expect(FORMS[t.type], `no form registered for ${t.type}`).toBeTruthy();
    }
  });

  for (const t of cliTypes) {
    it(`${t.type}: form exposes each spec field as "<type> <key>"`, () => {
      const variants = MODE_SPLIT[t.type] ?? [{ config: {}, excludes: [] }];
      for (const variant of variants) {
        // Prefix regex: multi-option controls label each option
        // ("clickhouse protocol https") under the field's label prefix.
        const { queryAllByLabelText, unmount } = renderForm(t.type, variant.config);
        for (const field of t.fields) {
          if (variant.excludes.includes(field.key)) continue;
          expect(
            queryAllByLabelText(new RegExp(`^${t.type} ${field.key}( |$)`)).length,
            `${t.type} form is missing a control labeled "${t.type} ${field.key}"`,
          ).toBeGreaterThan(0);
        }
        unmount();
      }
    });
  }
});
