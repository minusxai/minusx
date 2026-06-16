import { NextResponse } from 'next/server'

// Liveness check. The AI orchestration runs in-process (no external LLM-provider
// service to probe), so this just reports that the app is up.
export async function GET() {
  return NextResponse.json({
    status: 'healthy',
    services: {
      frontend: { status: 'ok' },
    },
  })
}
