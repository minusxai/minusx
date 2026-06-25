// Makes `import x from './x.yaml'` work under tsx/node — the tsx-runtime equivalent
// of yaml-loader (Turbopack/webpack) and @rollup/plugin-yaml (Vitest).
//
// Used only by the `prompt-visualizer` dev script (see package.json), which runs
// under tsx and transitively imports the prompts module (orchestrator/prompts →
// `import './prompts.yaml'`). tsx/esbuild has no built-in YAML support, so without
// this the script dies with ERR_UNKNOWN_FILE_EXTENSION ".yaml".
//
// `registerHooks` (Node 22.15+) is synchronous and same-thread, so the hook lives
// right here — no separate hook module needed. Loaded via `node --import` before
// the script runs; it claims .yaml and defers everything else down the chain.
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.yaml') || url.endsWith('.yml')) {
      const data = yaml.load(readFileSync(fileURLToPath(url), 'utf8'));
      return { format: 'module', source: `export default ${JSON.stringify(data)};`, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
