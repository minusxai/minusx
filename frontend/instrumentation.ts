import * as Sentry from '@sentry/nextjs';

export async function register() {
  // eslint-disable-next-line no-restricted-syntax
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // eslint-disable-next-line no-restricted-syntax
    await import('./sentry.server.config');
  }

  // eslint-disable-next-line no-restricted-syntax
  if (process.env.NEXT_RUNTIME === 'edge') {
    // eslint-disable-next-line no-restricted-syntax
    await import('./sentry.edge.config');
  }
  // eslint-disable-next-line no-restricted-syntax
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NEXT_PHASE !== 'phase-production-build') {
    // eslint-disable-next-line no-restricted-syntax
    const { CUSTOM_MODULE } = await import('./lib/config');
    if (CUSTOM_MODULE) {
      // Static string required so Turbopack compiles this module.
      // @ts-ignore — module only present when local/ symlink is active
      // eslint-disable-next-line no-restricted-syntax
      const { register: registerModules } = await import('./local/instrumentation');
      return registerModules();
    }
    // Everything the app needs at boot now lives in registerWithModules, so a
    // deployment with its own module stack inherits it instead of re-implementing it.
    // eslint-disable-next-line no-restricted-syntax
    const { registerWithModules } = await import('./lib/instrumentation/register-modules');
    await registerWithModules();
  }
}

export const onRequestError = Sentry.captureRequestError;