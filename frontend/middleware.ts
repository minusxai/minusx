import { auth } from "@/auth"
import { NextResponse } from "next/server"
import { isAdmin } from "@/lib/auth/role-helpers"
import { CURRENT_TOKEN_VERSION } from "@/lib/auth/auth-constants"
import { isValidMode } from "@/lib/mode/mode-types"
import { extractSubdomain, isSubdomainRoutingEnabled } from "@/lib/utils/subdomain"
import { CompanyDB } from "@/lib/database/company-db"

export default auth((req) => {
  const { pathname } = req.nextUrl

  // Extract subdomain from hostname (no async lookup - keep middleware fast)
  const hostname = req.headers.get('host') || '';
  const subdomainEnabled = isSubdomainRoutingEnabled();
  const subdomain = subdomainEnabled ? extractSubdomain(hostname) : null;
  console.log('[Middleware]', {
    hostname,
    subdomainEnabled,
    subdomain,
    pathname,
    ALLOW_MULTIPLE_COMPANIES: process.env.ALLOW_MULTIPLE_COMPANIES
  });

  // Check if this is a public access token route (/t/{token})
  const tokenRouteMatch = pathname.match(/^\/t\/([a-f0-9-]+)$/);
  const isTokenRoute = tokenRouteMatch !== null;

  // Check for public access token in cookie
  const publicAccessTokenCookie = req.cookies.get('public-access-token');

  // Public routes that don't require authentication
  const publicRoutes = ['/login']
  const isPublicRoute = publicRoutes.some(route => pathname.startsWith(route)) || isTokenRoute

  // Block registration from subdomains (only allow from main domain)
  if (pathname.startsWith('/api/companies/register') && subdomain) {
    return NextResponse.json(
      { error: 'Registration is only available from the main domain' },
      { status: 403 }
    );
  }

  // Allow access to public routes, auth API, internal API (Python backend), registration API, and health check
  if (
    isPublicRoute ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/internal') ||
    pathname.startsWith('/api/companies/register') ||
    pathname === '/api/health'
  ) {
    // Create modified request headers with subdomain
    const requestHeaders = new Headers(req.headers);
    if (subdomain) {
      requestHeaders.set('x-subdomain', subdomain);
    }
    if (isTokenRoute && tokenRouteMatch) {
      const token = tokenRouteMatch[1];
      requestHeaders.set('x-public-access-token', token);
    }
    if (publicAccessTokenCookie?.value) {
      requestHeaders.set('x-public-access-token', publicAccessTokenCookie.value);
    }

    // Pass modified headers to next handler
    const response = NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });

    // Set cookie for token routes
    if (isTokenRoute && tokenRouteMatch) {
      const token = tokenRouteMatch[1];
      response.cookies.set('public-access-token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 // 24 hours
      });
    }

    return response;
  }

  // For authenticated API routes, if there's a public token cookie BUT also a valid session,
  // clear the token cookie to prevent interference with normal authenticated requests
  if (pathname.startsWith('/api/') && publicAccessTokenCookie?.value && req.auth) {
    const requestHeaders = new Headers(req.headers);
    if (subdomain) {
      requestHeaders.set('x-subdomain', subdomain);
    }
    const response = NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
    response.cookies.delete('public-access-token');
    return response;
  }

  // Check if user is authenticated
  if (!req.auth) {
    // Redirect to login with return URL (preserve subdomain from Host header)
    const protocol = req.headers.get('x-forwarded-proto') || 'https';
    const loginUrl = new URL(`${protocol}://${hostname}/login`);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Check token version - force re-login if outdated
  const tokenVersion = req.auth.user?.tokenVersion;
  if (!tokenVersion || tokenVersion < CURRENT_TOKEN_VERSION) {
    console.warn('[Middleware] Old token version detected - forcing re-login:', {
      tokenVersion,
      currentVersion: CURRENT_TOKEN_VERSION,
      email: req.auth.user?.email
    });
    const protocol = req.headers.get('x-forwarded-proto') || 'https';
    const loginUrl = new URL(`${protocol}://${hostname}/login`);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Extract as_user parameter for impersonation
  const asUser = req.nextUrl.searchParams.get('as_user');

  // Extract mode parameter for file system isolation
  const mode = req.nextUrl.searchParams.get('mode');

  // Create modified request headers
  const requestHeaders = new Headers(req.headers);

  // Add subdomain header if present
  if (subdomain) {
    requestHeaders.set('x-subdomain', subdomain);
  }

  // Set impersonation header if user is admin and as_user is present
  if (asUser && req.auth.user?.role && isAdmin(req.auth.user.role)) {
    requestHeaders.set('x-impersonate-user', asUser);
  }

  // Set mode header (always, default to 'org' if not present or invalid)
  if (mode && isValidMode(mode)) {
    requestHeaders.set('x-mode', mode);
  } else {
    requestHeaders.set('x-mode', 'org');
  }

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  // Optimize: Redirect home route to user's home folder (server-side)
  // This eliminates client-side redirect and saves 1 page load
  if (pathname === '/') {
    const user = req.auth.user
    const effectiveMode = (mode && isValidMode(mode)) ? mode : 'org';

    // Mode-aware home redirect
    const homeHref = user?.role && isAdmin(user.role)
      ? `/p/${effectiveMode}`  // Admin: mode root
      : (user?.home_folder ? `/p/${effectiveMode}/${user.home_folder}` : `/p/${effectiveMode}`)  // Non-admin: mode + relative path

    // Construct URL preserving subdomain from Host header
    const protocol = req.headers.get('x-forwarded-proto') || 'https';
    const homeUrl = new URL(`${protocol}://${hostname}${homeHref}`);

    // Preserve as_user parameter when redirecting to home
    if (asUser && user?.role && isAdmin(user.role)) {
      homeUrl.searchParams.set('as_user', asUser);
    }

    // Preserve mode parameter when redirecting to home
    if (mode && mode !== 'org') {
      homeUrl.searchParams.set('mode', mode);
    }

    return NextResponse.redirect(homeUrl)
  }

  return response
})

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico (favicon file)
     * - public files (images, etc.)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
  // Use Node.js runtime instead of Edge Runtime
  // Required because auth imports database code that uses Node.js APIs
  runtime: 'nodejs',
}
