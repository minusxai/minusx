export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    process.on('exit', (code) => {
      console.error('[process:exit] code=%d', code, new Error('exit stack').stack);
    });

    process.on('uncaughtException', (err) => {
      console.error('[process:uncaughtException]', err);
    });

    process.on('unhandledRejection', (reason) => {
      console.error('[process:unhandledRejection]', reason);
    });
  }
}
