/**
 * E2E faux LLM channel — reset (Tests/QA/Evals Arch V2 — Phase 3).
 * Gated behind E2E_MODE. POST → clears recordings + drains faux queues (beforeEach).
 */
import { NextResponse } from 'next/server';
import { E2E_MODE } from '@/lib/constants';
import { resetFaux } from '@/lib/test/faux-llm-channel.server';

export async function POST() {
  if (!E2E_MODE) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  resetFaux();
  return NextResponse.json({ ok: true });
}
