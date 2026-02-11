import { withAuth } from '@/lib/api/with-auth';
import { NextRequest, NextResponse } from 'next/server';
import { CompletionsAPI } from '@/lib/data/completions/completions.server';
import { SqlCompletionsOptions } from '@/lib/data/completions/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = withAuth(async (request: NextRequest, user) => {
  const body: SqlCompletionsOptions = await request.json();

  const result = await CompletionsAPI.getSqlCompletions(body, user);

  return NextResponse.json(result);
});
