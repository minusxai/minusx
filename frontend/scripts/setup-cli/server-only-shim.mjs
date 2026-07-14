// Module hook: resolve `server-only` to an empty module (see node-preload.mjs).
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'server-only') {
    return { shortCircuit: true, url: 'data:text/javascript,' };
  }
  return nextResolve(specifier, context);
}
