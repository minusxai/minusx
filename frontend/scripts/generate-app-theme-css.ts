/**
 * Generates `app/theme-tokens.css` — the shadcn token layer for the MAIN document
 * (Renderer_v2 Phase 3), so kit components (components/kit) render correctly on
 * dashboards/questions outside the story iframe:
 *
 *  - the `@theme inline` mapping registers the token utilities in the app's Tailwind build
 *    (globals.css already `@import "tailwindcss"`, so preflight/utilities exist app-wide);
 *  - the NEUTRAL token VALUES are SCOPED under `[data-mx-theme-host]` (stamped by FileLayout
 *    around file content) so the Chakra app shell never sees them;
 *  - all six design-theme `[data-theme]` blocks (the same storyThemeCss() stories compile in)
 *    apply wherever a theme attribute is stamped (dashboard roots — Phase 3 theme field).
 *
 * Run: npm run generate-app-theme-css   (a drift test keeps the output in sync)
 */
import { config } from 'dotenv';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAppThemeCss } from '../lib/data/story/story-css.server';

config();

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app', 'theme-tokens.css');
writeFileSync(out, buildAppThemeCss());
console.log(`wrote ${out}`);
