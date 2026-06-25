// Node ESM customization hook: makes `import x from './x.yaml'` work under tsx/node.
//
// The app's prompts module (orchestrator/prompts/index.ts) does a native
// `import prompts from './prompts.yaml'`. The bundlers resolve that via yaml-loader
// (next.config.ts); Vitest via @rollup/plugin-yaml. Plain tsx/node scripts (e.g.
// prompt-visualizer) that transitively import that module need this equivalent.
//
// Registered AFTER tsx in the npm script (see register-yaml.mjs), so it claims .yaml
// first and defers everything else (.ts/.js) down the chain to tsx.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

export async function load(url, context, nextLoad) {
  if (url.endsWith('.yaml') || url.endsWith('.yml')) {
    const data = yaml.load(readFileSync(fileURLToPath(url), 'utf8'));
    return { format: 'module', source: `export default ${JSON.stringify(data)};`, shortCircuit: true };
  }
  return nextLoad(url, context);
}
