/**
 * Custom Jest environment: JSDOM + Web Fetch API globals.
 *
 * jest-environment-jsdom (backed by jsdom 26) does not expose Request,
 * Response, Headers, or fetch. Node.js 18+ provides these as built-in
 * globals on the real Node.js globalThis.
 *
 * This environment extends JSDOMEnvironment and copies the missing
 * globals in before any test modules are evaluated.
 */
const { TestEnvironment } = require('jest-environment-jsdom');

class JSDOMWithFetchEnvironment extends TestEnvironment {
  async setup() {
    await super.setup();
    // Node.js 18+ exposes Request, Response, Headers, fetch on globalThis
    // (from undici). Copy them into the JSDOM window so modules that import
    // next/server (which does `class NextRequest extends Request`) don't fail.
    if (typeof this.global.Request === 'undefined') {
      this.global.Request = Request;
      this.global.Response = Response;
      this.global.Headers = Headers;
    }
    if (typeof this.global.fetch === 'undefined') {
      this.global.fetch = fetch;
    }
    if (typeof this.global.TextEncoder === 'undefined') {
      const { TextEncoder, TextDecoder } = require('util');
      this.global.TextEncoder = TextEncoder;
      this.global.TextDecoder = TextDecoder;
    }
    // JSDOM's Blob and File lack arrayBuffer() / text() / stream() which PGLite
    // (and other modern web APIs) require. Replace them with the Node.js globals
    // which implement the full Blob interface (Node 16+).
    if (typeof Blob !== 'undefined' && typeof Blob.prototype.arrayBuffer === 'function') {
      this.global.Blob = Blob;
    }
    if (typeof File !== 'undefined' && typeof File.prototype.arrayBuffer === 'function') {
      this.global.File = File;
    }
  }
}

module.exports = JSDOMWithFetchEnvironment;
