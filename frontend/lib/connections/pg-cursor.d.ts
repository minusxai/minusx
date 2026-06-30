// pg-cursor ships no types; we use it via a small typed wrapper in
// postgres-connector.ts (read/close callbacks). An ambient `any` module is
// sufficient.
declare module 'pg-cursor';
