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
    // eslint-disable-next-line no-restricted-syntax
    const { registerWithModules } = await import('./lib/instrumentation/register-modules');
    await registerWithModules();

    // Route orchestrator-tagged unhandled rejections to the conversation's
    // errors[] so the failure shows up in chat history (Cycle 8 wire).
    // Untagged rejections are ignored here (Sentry already captures them).
    // Best-effort: the handler swallows its own errors.
    // eslint-disable-next-line no-restricted-syntax
    const { logTaggedRejection } = await import('./lib/api/unhandled-rejection-logger');
    const systemUser = {
      userId: -1, email: 'system@minusx', name: 'System',
      role: 'admin', home_folder: '/org', mode: 'org',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    process.on('unhandledRejection', (reason) => {
      void logTaggedRejection(reason, systemUser);
    });
  }
}

export const onRequestError = Sentry.captureRequestError;