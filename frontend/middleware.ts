import { createMiddleware } from '@/lib/middleware/create-middleware';

export default createMiddleware();

// Must be a static literal — Next.js parses this at build time without executing imports.
// runtime: 'nodejs' is required; without it Next.js defaults to Edge which lacks Node.js APIs.
export const config = {
  // wasm/ttf: static engine + font assets (public/takumi, public/fonts) must load
  // for UNAUTHENTICATED guests (public share pages render stories on canvas) — the
  // auth middleware would otherwise answer them with an HTML login redirect, which
  // fails WebAssembly.instantiate with 'expected magic word … found 3c 21 44 4f' (<!DO).
  matcher: ['/((?!_next/static|_next/image|favicon.ico|(?!api/).*\\.(?:svg|png|jpg|jpeg|gif|webp|wasm|ttf|woff2?)$).*)'],
  runtime: 'nodejs',
};
