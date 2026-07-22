import { createMiddleware } from '@/lib/middleware/create-middleware';

export default createMiddleware();

// Must be a static literal — Next.js parses this at build time without executing imports.
// runtime: 'nodejs' is required; without it Next.js defaults to Edge which lacks Node.js APIs.
export const config = {
  // ttf/woff: static font assets (public/fonts — platform story fonts) must load for
  // UNAUTHENTICATED guests (public share pages render stories with them) — the auth
  // middleware would otherwise answer them with an HTML login redirect.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|(?!api/).*\\.(?:svg|png|jpg|jpeg|gif|webp|ttf|woff2?)$).*)'],
  runtime: 'nodejs',
};
