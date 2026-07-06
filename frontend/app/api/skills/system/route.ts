import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/http/with-auth';
import { listSkills } from '@/orchestrator/prompts';

export interface SystemSkillCatalogItem {
  name: string;
  description: string;
}

// Serve the system-skill catalog from the TS prompt tree (orchestrator/prompts),
// matching the v2 orchestrator's own skill set.
export const GET = withAuth(async () => {
  const skills = listSkills({ skipHidden: true });
  const data: SystemSkillCatalogItem[] = Object.entries(skills).map(([name, description]) => ({
    name,
    description,
  }));
  return NextResponse.json({ success: true, data });
});
