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
    const { logTaggedRejection } = await import('./lib/messaging/unhandled-rejection-logger');
    process.on('unhandledRejection', (reason) => {
      void logTaggedRejection(reason);
    });

    // Boot-warm the heavy chat runtime so the FIRST chat request doesn't pay the
    // module load + JIT-parse cost on a cold Node process (the DB is already
    // warmed by db.init() above). Non-blocking: the server starts serving
    // immediately and this loads concurrently. Best-effort — never crashes boot.
    // Opt out with BOOT_WARM_CHAT=false.
    // eslint-disable-next-line no-restricted-syntax
    if (process.env.BOOT_WARM_CHAT !== 'false') {
      void (async () => {
        try {
          const t0 = Date.now();
          // Pulls in the orchestrator engine, every agent/tool, and pi-ai, and
          // runs registrable registration — the bulk of the first-request cost.
          // eslint-disable-next-line no-restricted-syntax
          await import('./lib/chat/orchestration-core.server');
          console.log(`[boot-warm] chat runtime warmed in ${Date.now() - t0}ms`);
        } catch (e) {
          console.warn('[boot-warm] chat runtime warm skipped (non-fatal):', e);
        }
      })();
    }
  }
}

export const onRequestError = Sentry.captureRequestError;