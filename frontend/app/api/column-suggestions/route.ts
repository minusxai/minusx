/**
 * API route for column suggestions (GUI builder)
 * Returns list of columns for specified table
 */

import { withAuth } from '@/lib/api/with-auth';
import { NextRequest, NextResponse } from 'next/server';
import { CompletionsAPI } from '@/lib/data/completions/completions.server';
import { ColumnSuggestionsOptions } from '@/lib/data/completions/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = withAuth(async (request: NextRequest, user) => {
  try {
    const body: ColumnSuggestionsOptions = await request.json();
    const { databaseName, table, schema, currentIR } = body;

    if (!databaseName || !table) {
      return NextResponse.json(
        { success: false, error: 'databaseName and table are required' },
        { status: 400 }
      );
    }

    const result = await CompletionsAPI.getColumnSuggestions(
      { databaseName, table, schema, currentIR },
      user
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error('[API /column-suggestions] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
      },
      { status: 500 }
    );
  }
});
