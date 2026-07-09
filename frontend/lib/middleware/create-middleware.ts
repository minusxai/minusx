import { auth } from '@/auth';
import { NextResponse, type NextRequest } from 'next/server';
import type { Session } from 'next-auth';
import { isAdmin } from '@/lib/auth/role-helpers';
import { CURRENT_TOKEN_VERSION } from '@/lib/auth/auth-constants';
import { isValidMode } from '@/lib/mode/mode-types';
import { isValidView, DEFAULT_VIEW } from '@/lib/view/view-types';
import { getModules } from '@/lib/modules/registry';
import { E2E_PARAM, E2E_COOKIE, E2E_HEADER, matchesE2ESecret } from '@/lib/auth/e2e-runtime';
import { EMBED_FRAME_ANCESTORS } from '@/lib/config';
import { GUEST_COOKIE, verifyGuestToken, isShareGuestPath } from '@/lib/auth/guest-session';

export type AuthReq = NextRequest & { auth: Session | null };


export function createMiddleware() {
  return auth(async (req) => {
    const response = await routeRequest(req as AuthReq);
    // Restrict who may iframe-embed the app, when configured (frame-ancestors).
    // Empty for the disabled / '*' cases, leaving the app embeddable from anywhere.
    if (EMBED_FRAME_ANCESTORS) {
      response.headers.set('Content-Security-Policy', `frame-ancestors ${EMBED_FRAME_ANCESTORS}`);
    }
    return response;
  });
}

async function routeRequest(req: AuthReq): Promise<NextResponse> {
    const { pathname } = req.nextUrl;

    const hostname = req.headers.get('host') || '';
    console.log('[Middleware]', { hostname, pathname });

    const publicRoutes = ['/login', '/register'];
    const isPublicRoute = publicRoutes.some(route => pathname.startsWith(route));

    const requestId = crypto.randomUUID();

    // Public story shares: the `/l/...` page and the guest-session mint route are always
    // public (they establish the anonymous session). Once a valid `mx-guest` cookie exists,
    // admit the data/chat APIs the share page drives WITHOUT a NextAuth session — the guest's
    // scope is enforced downstream by getEffectiveUser (folder-scoped viewer) + canAccessFile,
    // and ?mode / ?as_user are ignored for guests, so there is no escalation via this admit.
    const isSharePublicPath =
      pathname.startsWith('/l/') || pathname.startsWith('/api/share/guest-session');
    // Remote Agent Sessions (`/s/<code>` skill doc + tool endpoints): public — the unguessable
    // code IS the credential, validated downstream by withRemoteSessionAuth / resolveRemoteSession
    // (hash compare + TTL/idle/revocation). No session cookie is ever minted for these.
    const isRemoteSessionPath = pathname.startsWith('/s/');
    // Honor the guest cookie ONLY on share pages + the APIs they call — never on the
    // main app pages, so a share link doesn't log the visitor into the app UI.
    const hasGuestSession =
      !req.auth &&
      isShareGuestPath(pathname) &&
      verifyGuestToken(req.cookies.get(GUEST_COOKIE)?.value) !== null;

    if (
      isPublicRoute ||
      isSharePublicPath ||
      isRemoteSessionPath ||
      hasGuestSession ||
      // Root metadata image route (generic OG card) — must be crawler-reachable.
      // The per-share `/l/<id>/opengraph-image` is already covered by `/l/` above.
      pathname.startsWith('/opengraph-image') ||
      pathname.startsWith('/api/auth') ||
      pathname.startsWith('/api/public/slack-chart') ||
      pathname.startsWith('/api/orgs/register') ||
      pathname.startsWith('/api/mcp') ||
      pathname.startsWith('/oauth') ||
      pathname.startsWith('/.well-known/oauth') ||
      pathname.startsWith('/api/integrations/slack/events') ||
      pathname.startsWith('/api/integrations/slack/interact') ||
      pathname === '/api/integrations/slack/oauth-callback' ||
      pathname.startsWith('/api/health') ||
      pathname === '/api/jobs/cron'
    ) {
      const requestHeaders = new Headers(req.headers);
      requestHeaders.set('x-request-id', requestId);
      requestHeaders.set('x-request-path', pathname);

      await getModules().auth.addHeaders(req as AuthReq, requestHeaders);

      return NextResponse.next({ request: { headers: requestHeaders } });
    }

    if (!req.auth) {
      const protocol = (req.headers.get('x-forwarded-proto') || 'https').split(',')[0].trim();
      const loginUrl = new URL(`${protocol}://${hostname}/login`);
      loginUrl.searchParams.set('callbackUrl', pathname + req.nextUrl.search);
      return NextResponse.redirect(loginUrl);
    }

    const tokenVersion = req.auth.user?.tokenVersion;
    if (!tokenVersion || tokenVersion < CURRENT_TOKEN_VERSION) {
      console.warn('[Middleware] Old token version detected - forcing re-login:', {
        tokenVersion,
        currentVersion: CURRENT_TOKEN_VERSION,
        email: req.auth.user?.email,
      });
      const protocol = (req.headers.get('x-forwarded-proto') || 'https').split(',')[0].trim();
      const loginUrl = new URL(`${protocol}://${hostname}/login`);
      loginUrl.searchParams.set('callbackUrl', pathname + req.nextUrl.search);
      return NextResponse.redirect(loginUrl);
    }

    const asUser = req.nextUrl.searchParams.get('as_user');
    const mode = req.nextUrl.searchParams.get('mode');

    const requestHeaders = new Headers(req.headers);
    requestHeaders.set('x-request-id', requestId);
    requestHeaders.set('x-request-path', pathname);

    if (req.auth.user?.userId) {
      requestHeaders.set('x-user-id', String(req.auth.user.userId));
    }


    if (asUser && req.auth.user?.role && isAdmin(req.auth.user.role)) {
      requestHeaders.set('x-impersonate-user', asUser);
    }

    if (mode && isValidMode(mode)) {
      const isInternalsAllowed = mode !== 'internals' || (req.auth.user?.role && isAdmin(req.auth.user.role));
      requestHeaders.set('x-mode', isInternalsAllowed ? mode : 'org');
    } else {
      requestHeaders.set('x-mode', 'org');
    }

    // Forward `view` (chrome-stripping for embedding) the same way as mode.
    const view = req.nextUrl.searchParams.get('view');
    requestHeaders.set('x-view', view && isValidView(view) ? view : DEFAULT_VIEW);

    const e2eParam = req.nextUrl.searchParams.get(E2E_PARAM);
    if (matchesE2ESecret(e2eParam)) {
      const protocol = (req.headers.get('x-forwarded-proto') || 'https').split(',')[0].trim();
      const target = new URL(`${protocol}://${hostname}${pathname}`);
      req.nextUrl.searchParams.forEach((value, key) => {
        if (key !== E2E_PARAM) target.searchParams.set(key, value);
      });
      const e2eRedirect = NextResponse.redirect(target);
      e2eRedirect.cookies.set(E2E_COOKIE, e2eParam as string, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24, // 1 day
      });
      return e2eRedirect;
    }
    if (matchesE2ESecret(req.cookies.get(E2E_COOKIE)?.value)) {
      requestHeaders.set(E2E_HEADER, '1');
    }

    const hasContext = await getModules().auth.addHeaders(req as AuthReq, requestHeaders);
    if (!hasContext) {
      const response = NextResponse.redirect(new URL('/login', req.url));
      for (const name of [
        'next-auth.session-token',
        '__Secure-next-auth.session-token',
        'next-auth.csrf-token',
        '__Host-next-auth.csrf-token',
      ]) {
        response.cookies.set(name, '', { maxAge: 0, path: '/' });
      }
      return response;
    }

    const effectiveMode = (mode && isValidMode(mode)) ? mode : 'org';

    // Redirect bare /p to /p/{mode} server-side (avoids client-side redirect delay)
    if (pathname === '/p' || pathname === '/p/') {
      const target = new URL(`/p/${effectiveMode}`, req.url);
      // Preserve query params (mode, as_user, etc.)
      req.nextUrl.searchParams.forEach((value, key) => target.searchParams.set(key, value));
      return NextResponse.redirect(target);
    }

    return NextResponse.next({ request: { headers: requestHeaders } });
}
