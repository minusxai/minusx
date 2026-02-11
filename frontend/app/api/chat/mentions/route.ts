import { withAuth } from '@/lib/api/with-auth';
import { NextRequest, NextResponse } from 'next/server';
import { CompletionsAPI } from '@/lib/data/completions/completions.server';
import { MentionsOptions } from '@/lib/data/completions/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = withAuth(async (request: NextRequest, user) => {
  const body: MentionsOptions = await request.json();

  const result = await CompletionsAPI.getMentions(body, user);

  return NextResponse.json(result);
});
