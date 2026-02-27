import { NextRequest, NextResponse } from 'next/server';

const MX_API_BASE_URL = process.env.MX_API_BASE_URL || '';
const MX_API_KEY = process.env.MX_API_KEY || '';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ callId: string }> }
) {
  if (!MX_API_BASE_URL) {
    return NextResponse.json({});
  }

  const { callId } = await params;
  const headers: HeadersInit = MX_API_KEY ? { 'mx-api-key': MX_API_KEY } : {};
  const base = `${MX_API_BASE_URL}/calls/${callId}`;

  const [statsRes, logsRes] = await Promise.allSettled([
    fetch(base, { headers }),
    fetch(`${base}?mode=all`, { headers }),
  ]);

  const stats =
    statsRes.status === 'fulfilled' && statsRes.value.ok
      ? await statsRes.value.json()
      : null;
  const logs =
    logsRes.status === 'fulfilled' && logsRes.value.ok
      ? await logsRes.value.json()
      : null;

  return NextResponse.json({ stats, logs });
}
