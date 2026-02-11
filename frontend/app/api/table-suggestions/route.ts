/**
 * API route for table suggestions (GUI builder)
 * Returns list of available tables from connection schema
 */

import { withAuth } from '@/lib/api/with-auth';
import { NextRequest, NextResponse } from 'next/server';
import { CompletionsAPI } from '@/lib/data/completions/completions.server';
import { TableSuggestionsOptions } from '@/lib/data/completions/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = withAuth(async (request: NextRequest, user) => {
  try {
    const body: TableSuggestionsOptions = await request.json();
    const { databaseName, currentIR } = body;

    if (!databaseName) {
      return NextResponse.json(
        { success: false, error: 'databaseName is required' },
        { status: 400 }
      );
    }

    const result = await CompletionsAPI.getTableSuggestions(
      { databaseName, currentIR },
      user
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error('[API /table-suggestions] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
      },
      { status: 500 }
    );
  }
});
