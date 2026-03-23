import { docs, guides } from '@/.source/server';
import { loader } from 'fumadocs-core/source';

export const docsSource = loader(docs.toFumadocsSource(), {
  baseUrl: '/docs',
});

export const guidesSource = loader(guides.toFumadocsSource(), {
  baseUrl: '/guides',
});
