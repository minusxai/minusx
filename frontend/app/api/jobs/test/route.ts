import { NextRequest, NextResponse } from 'next/server';
import { getEffectiveUser } from '@/lib/auth/auth-helpers';
import { handleApiError } from '@/lib/api/api-responses';
import { createServerRunner } from '@/lib/tests/server';
import type { Test, TestRunResult } from '@/lib/types';

export interface EvalRunRequest {
  test: Test;
  connection_id?: string;
}

/**
 * POST /api/jobs/test
 *
 * Run a single Test against the in-process v2 eval agent (EvalAnalystAgent) and
 * return a TestRunResult. No Python backend.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getEffectiveUser();
    if (!user) {
      return NextResponse.json({ passed: false, error: 'Unauthorized' } as Partial<TestRunResult>, { status: 401 });
    }

    const { test, connection_id }: EvalRunRequest = await request.json();
    if (!test) {
      return NextResponse.json({ passed: false, error: 'test is required' } as Partial<TestRunResult>, { status: 400 });
    }

    const runner = createServerRunner(user, connection_id || '');
    const result = await runner.execute(test);
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
