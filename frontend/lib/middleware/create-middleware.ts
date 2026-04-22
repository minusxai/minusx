import { auth } from '@/auth';
import { NextResponse, type NextRequest } from 'next/server';
import type { Session } from 'next-auth';
import { isAdmin } from '@/lib/auth/role-helpers';
import { CURRENT_TOKEN_VERSION } from '@/lib/auth/auth-constants';
import { isValidMode, type Mode } from '@/lib/mode/mode-types';
import { logNetworkRequest } from '@/lib/network-logging';
import { getModules } from '@/lib/modules/registry';

export type AuthReq = NextRequest & { auth: Session | null };


export function createMiddleware() {
  return auth(async (req) => {
    const { pathname } = req.nextUrl;

    const hostname = req.headers.get('host') || '';
    console.log('[Middleware]', { hostname, pathname });

    const publicRoutes = ['/login', '/register'];
    const isPublicRoute = publicRoutes.some(route => pathname.startsWith(route));

    const requestId = crypto.randomUUID();
    const isApiPath = pathname.startsWith('/api/');

    const reqProtocol = (req.headers.get('x-forwarded-proto') || 'https').split(',')[0].trim();
    const reqHeaders: Record<string, string> = {};
    if (isApiPath) {
      req.headers.forEach((value, key) => { reqHeaders[key] = value; });
    }
    const reqInfo = { method: req.method, protocol: reqProtocol, domain: hostname, path: pathname, headers: reqHeaders };

    if (
      isPublicRoute ||
      pathname.startsWith('/api/auth') ||
      pathname.startsWith('/api/internal') ||
      pathname.startsWith('/api/public/slack-chart') ||
      pathname.startsWith('/api/orgs/register') ||
      pathname.startsWith('/api/mcp') ||
      pathname.startsWith('/oauth') ||
      pathname.startsWith('/.well-known/oauth') ||
      pathname.startsWith('/api/integrations/slack/events') ||
      pathname.startsWith('/api/integrations/slack/interact') ||
      pathname.startsWith('/api/integrations/slack/oauth-callback') ||
      pathname.startsWith('/api/health') ||
      pathname === '/api/jobs/cron' ||
      pathname.startsWith('/api/object-store/serve')
    ) {
      const requestHeaders = new Headers(req.headers);
      requestHeaders.set('x-request-id', requestId);
      requestHeaders.set('x-request-path', pathname);

      await getModules().auth.addHeaders(req as AuthReq, requestHeaders);

      const response = NextResponse.next({ request: { headers: requestHeaders } });
      if (isApiPath) void logNetworkRequest(requestId, reqInfo, null);
      return response;
    }

    if (!req.auth) {
      if (isApiPath) void logNetworkRequest(requestId, reqInfo, null);
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
      if (isApiPath) void logNetworkRequest(requestId, reqInfo, null);
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

    await getModules().auth.addHeaders(req as AuthReq, requestHeaders);

    const response = NextResponse.next({ request: { headers: requestHeaders } });

    const effectiveMode = (mode && isValidMode(mode)) ? mode : 'org';

    if (pathname === '/') {
      const user = req.auth.user;
      const homeHref = user?.role && isAdmin(user.role)
        ? `/p/${effectiveMode}`
        : (user?.home_folder ? `/p/${effectiveMode}/${user.home_folder}` : `/p/${effectiveMode}`);

      const protocol = (req.headers.get('x-forwarded-proto') || 'https').split(',')[0].trim();
      const homeUrl = new URL(`${protocol}://${hostname}${homeHref}`);

      if (asUser && user?.role && isAdmin(user.role)) {
        homeUrl.searchParams.set('as_user', asUser);
      }
      if (mode && mode !== 'org') {
        homeUrl.searchParams.set('mode', mode);
      }

      return NextResponse.redirect(homeUrl);
    }

    if (isApiPath) {
      void logNetworkRequest(requestId, reqInfo, {
        userId: req.auth.user?.userId,
        mode: effectiveMode,
      });
    }

    return response;
  });
}
