/**
 * E2E faux LLM channel — register responses (Tests/QA/Evals Arch V2 — Phase 3).
 * Gated behind E2E_MODE; returns 404 in normal builds so it never exists in prod.
 *
 * POST body: { matches: FauxMatchDTO[] } → installs the content-keyed matcher on
 * the chat agents' faux providers.
 */
import { NextRequest, NextResponse } from 'next/server';
import { E2E_MODE } from '@/lib/constants';
import { handleApiError } from '@/lib/http/api-responses';
import { configureFauxFromDTO, type FauxMatchDTO } from '@/lib/test/faux-llm-channel.server';

export async function POST(req: NextRequest) {
  if (!E2E_MODE) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    const { matches } = (await req.json()) as { matches?: FauxMatchDTO[] };
    configureFauxFromDTO(matches ?? []);
    return NextResponse.json({ ok: true, count: matches?.length ?? 0 });
  } catch (error) {
    return handleApiError(error);
  }
}
