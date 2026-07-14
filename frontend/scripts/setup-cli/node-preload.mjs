// Preload for setup-cli entries (used via `node --import tsx --import <this>`),
// mapping the `server-only` guard package to an empty module. The usual
// `tsx --conditions react-server` trick breaks inside the Docker runtime image:
// the standalone-traced `react` package there lacks the react-server condition
// build (react.react-server.js) that transitive UI imports (react-icons) would
// then resolve. This shim neutralizes only `server-only`; everything else
// resolves under default conditions.
import { register } from 'node:module';

register(new URL('./server-only-shim.mjs', import.meta.url));
