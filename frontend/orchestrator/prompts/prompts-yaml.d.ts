// Native, typed import of the prompts YAML.
//
// The runtime VALUE comes from a yaml loader at build time — yaml-loader for
// Turbopack/webpack (next.config.ts) and @rollup/plugin-yaml for Vitest — which
// parse the YAML and inline the object into the bundle.
//
// The TYPE comes from here: TypeScript has no `resolveJsonModule` equivalent for
// YAML (it can't infer a YAML file's shape from content), so we bind the import to
// the canonical PromptTree interface. That gives `import prompts from './prompts.yaml'`
// real types instead of `unknown` — the thing a bare yaml import otherwise lacks.
declare module '*/prompts.yaml' {
  import type { PromptTree } from '@/orchestrator/prompts/prompt-loader';
  const prompts: PromptTree;
  export default prompts;
}
