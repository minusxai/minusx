// Empty stand-in for the `server-only` guard package. The setup-cli entries are
// bundled ahead of time (see the Dockerfile's setup-cli build step) and run
// under plain `node`, outside Next — where `server-only` has no meaning and its
// real module would throw. esbuild aliases the import here.
export {};
