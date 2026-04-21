/**
 * Jest transform for @electric-sql/pglite/dist/index.cjs
 *
 * PGLite sets its base URL `A` at module load time via `ys()`. In JSDOM,
 * `document` is always defined (its property is a non-configurable getter),
 * so `ys()` returns an HTTP URL. When PGLite then calls fs.readFile with
 * that HTTP URL, Node.js throws "The URL must be of scheme file".
 *
 * Fix: replace `A=ys()` with `A=new URL('file:'+__filename).href` so the
 * base URL always points to PGLite's dist directory regardless of JSDOM.
 */
module.exports = {
  process(sourceText) {
    const patched = sourceText.replace(
      /\bA=ys\(\)/,
      "A=new URL('file:'+__filename).href"
    );
    return { code: patched };
  },
};
