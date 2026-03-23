import { defineDocs, defineConfig } from 'fumadocs-mdx/config';

export const docs = defineDocs({
  dir: 'content/docs',
});

export const guides = defineDocs({
  dir: 'content/guides',
});

export default defineConfig();
