// Tables rendered from the repo-root compatibility.json — the same shared
// contract the app (connection form specs) and setup.sh (CLI interview)
// consume, so these docs never drift from what the product actually supports.
import compatibility from '../../compatibility.json';

interface CompatModel { id: string; name: string }
interface CompatProvider {
  id: string; name: string; kind: string; description?: string;
  models?: CompatModel[];
  defaults?: Record<string, string>;
}
interface CompatConnectionType { type: string; name: string; cli: boolean }

/** Recommended providers + curated models table (llm-providers.mdx). */
export function SupportedModels() {
  const providers = compatibility.llm.providers as CompatProvider[];
  return (
    <table>
      <thead>
        <tr>
          <th>Provider</th>
          <th>Recommended models</th>
          <th>Default (Analyst / Micro)</th>
        </tr>
      </thead>
      <tbody>
        {providers.map((p) => (
          <tr key={p.id}>
            <td>
              <code>{p.id}</code>
              {p.description ? <> — {p.description}</> : null}
            </td>
            <td>{p.models ? p.models.map((m) => m.id).join(', ') : p.kind === 'managed' ? 'managed by the gateway' : 'any model your endpoint serves'}</td>
            <td>{p.defaults ? `${p.defaults.analyst} / ${p.defaults.micro}` : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Supported database connections table (installation/configuration docs). */
export function SupportedDatabases() {
  const types = compatibility.connections.types as CompatConnectionType[];
  return (
    <table>
      <thead>
        <tr>
          <th>Database</th>
          <th>Type</th>
          <th>Configurable in setup.sh</th>
        </tr>
      </thead>
      <tbody>
        {types.map((t) => (
          <tr key={t.type}>
            <td>{t.name}</td>
            <td><code>{t.type}</code></td>
            <td>{t.cli ? 'yes' : 'in-app only'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
