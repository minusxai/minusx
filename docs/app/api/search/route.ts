import { createFromSource } from 'fumadocs-core/search/server';
import { docsSource } from '@/lib/source';

const searchAPI = createFromSource(docsSource);

export const dynamic = 'force-static';
export const revalidate = false;

export function GET() {
  return searchAPI.staticGET();
}
