import { createMiddleware } from '@/lib/middleware/create-middleware';

export default createMiddleware();

// Must be a static literal — Next.js parses this at build time without executing imports.
// runtime: 'nodejs' is required; without it Next.js defaults to Edge which lacks Node.js APIs.
export const config = {
  // wasm/ttf: static engine + font assets (public/takumi, public/fonts) must load
  // for UNAUTHENTICATED guests (public share pages render stories on canvas). The
  // manifest + generated PWA icons must also remain public so browsers can evaluate
  // installability. Auth would otherwise answer these requests with login-page HTML.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|pwa-icon/|(?!api/).*\\.(?:svg|png|jpg|jpeg|gif|webp|wasm|ttf|woff2?)$).*)'],
  runtime: 'nodejs',
};
