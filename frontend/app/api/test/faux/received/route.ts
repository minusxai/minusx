/**
 * E2E faux LLM channel — read recorded requests (Tests/QA/Evals Arch V2 — Phase 3).
 * Gated behind E2E_MODE. GET → { received: RecordedLLMCall[] } for assertions.
 */
import { NextResponse } from 'next/server';
import { E2E_MODE } from '@/lib/constants';
import { getReceived } from '@/lib/test/faux-llm-channel.server';

export async function GET() {
  if (!E2E_MODE) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ received: getReceived() });
}
