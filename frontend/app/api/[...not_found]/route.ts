import { NextRequest } from 'next/server';
import { ApiErrors } from '@/lib/http/api-responses';

/**
 * API catch-all: any /api/* path with no real route returns a JSON 404. Without this,
 * unknown API paths fall through to the app-router HTML not-found page — the full app
 * shell — which reads as a broken "logged-in screen" to API consumers (health checks,
 * integrations, curl). Real routes always win over a catch-all, so this only fires for
 * paths that would otherwise 404.
 */
const notFound = (req: NextRequest) => ApiErrors.notFound(`API route ${req.nextUrl.pathname}`);

export async function GET(req: NextRequest) { return notFound(req); }
export async function POST(req: NextRequest) { return notFound(req); }
export async function PUT(req: NextRequest) { return notFound(req); }
export async function PATCH(req: NextRequest) { return notFound(req); }
export async function DELETE(req: NextRequest) { return notFound(req); }
