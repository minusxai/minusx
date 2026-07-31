/**
 * Browser-side entry point for the capture matrix (`npm run capture-matrix`).
 *
 * esbuild bundles THIS FILE into the `/bundle.js` the fixture pages load, exposing the
 * real shipped modules on `window` for the in-page drivers to exercise. Everything here
 * is production code — only the fixtures are synthetic.
 *
 * It is a real file rather than a string assembled at build time so that the imports are
 * visible to `tsc`, to ESLint and to `npm run knip`. A module reachable only through a
 * template literal looks dead to every tool that reads the repo, which is how the drivers
 * used to get reported as unused.
 *
 * Not shipped to users, and never imported by app code.
 */
import { serializeElementToSvg } from '@/lib/screenshot/serialize-element';
import { svgToImage, serializeStorySvg } from '@/lib/story-surface/serialize';
import { sanitizeCssText } from '@/lib/data/story/banned-css';
import { mountStorySurface, autoSizeStorySurface, STORY_FLUID_SHIM_CSS } from '@/lib/story-surface';
import { B2_DRIVER } from '@/scripts/b2-surface-drivers';

declare global {
  interface Window {
    __matrix: object;
    __story: object;
    __b2: object;
  }
}

// Serialization primitives — the capture path every surface shares.
window.__matrix = { serializeElementToSvg, svgToImage, sanitizeCssText };

// Story surface: fluid sizing + the story-tier capture path.
window.__story = {
  mountStorySurface,
  autoSizeStorySurface,
  STORY_FLUID_SHIM_CSS,
  serializeStorySvg,
  storySvgToImage: svgToImage,
};

// Dashboard (B2) surface drivers: iframe host, windowing, sticky/portal probes.
window.__b2 = B2_DRIVER;
