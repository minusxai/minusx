/**
 * Custom Jest resolver that falls back from .cjs to .js.
 *
 * Several @zag-js/* packages ship a dist/index.js that requires sibling
 * files with `.cjs` extensions (e.g. `require('./data-transfer.cjs')`),
 * but only `.js` equivalents are present in the installed package.
 * This resolver transparently retries with `.js` so those imports succeed.
 */
module.exports = (moduleName, options) => {
  try {
    return options.defaultResolver(moduleName, options);
  } catch (e) {
    if (moduleName.endsWith('.cjs')) {
      return options.defaultResolver(moduleName.replace(/\.cjs$/, '.js'), options);
    }
    throw e;
  }
};
