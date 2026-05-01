import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/api/with-auth';
import { pythonBackendFetch } from '@/lib/api/python-backend-client';

export interface SystemSkillCatalogItem {
  name: string;
  description: string;
}

export const GET = withAuth(async (_request, user) => {
  const response = await pythonBackendFetch('/api/skills/system', { method: 'GET' }, user);
  if (!response.ok) {
    return NextResponse.json({ success: false, error: 'Failed to load system skills' }, { status: response.status });
  }
  const data = await response.json() as SystemSkillCatalogItem[];
  return NextResponse.json({ success: true, data });
});
