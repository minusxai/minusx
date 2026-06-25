// Registers the .yaml ESM loader hook (yaml-loader-hook.mjs) for tsx/node scripts.
// Used via `node --import tsx --import ./scripts/register-yaml.mjs ...` so this hook
// is registered last → runs first → resolves native `import './x.yaml'`.
import { register } from 'node:module';

register('./yaml-loader-hook.mjs', import.meta.url);
