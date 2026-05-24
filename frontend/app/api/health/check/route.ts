import { NextResponse } from 'next/server'
import { MX_API_BASE_URL } from '@/lib/config'

type ServiceStatus =
  | { status: 'ok' }
  | { status: 'error'; error: string }
  | { status: 'not_configured' }

async function checkService(url: string): Promise<ServiceStatus> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (res.ok) return { status: 'ok' }
    return { status: 'error', error: `HTTP ${res.status}` }
  } catch (err) {
    return { status: 'error', error: err instanceof Error ? err.message : String(err) }
  }
}

export async function GET() {
  const llmProvider: ServiceStatus = MX_API_BASE_URL
    ? await checkService(`${MX_API_BASE_URL}/health`)
    : { status: 'not_configured' }

  const overallStatus = llmProvider.status === 'error' ? 'degraded' : 'healthy'

  return NextResponse.json({
    status: overallStatus,
    services: {
      frontend: { status: 'ok' },
      llm_provider: llmProvider,
    },
  })
}
