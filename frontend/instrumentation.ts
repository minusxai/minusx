export async function register() {
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
  }
}
