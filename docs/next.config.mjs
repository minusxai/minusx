import { createMDX } from 'fumadocs-mdx/next';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  output: 'export',
  images: { unoptimized: true },
  // The docs import the repo-root compatibility.json (shared with the app and
  // setup.sh) — widen the turbopack root so imports may cross above docs/.
  turbopack: {
    root: path.join(path.dirname(fileURLToPath(import.meta.url)), '..'),
  },
};

export default withMDX(config);
