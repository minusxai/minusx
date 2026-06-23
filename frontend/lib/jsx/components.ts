/**
 * The component names allowed in `jsx` bodies (File Architecture v2). The client
 * render registry (components/jsx/registry.tsx) maps these names to React components;
 * the server uses just the names to validate-on-save. Keep this the single source of
 * the allowlist so server validation and client rendering never drift.
 */
export const JSX_COMPONENT_NAMES = ['Question'] as const;
