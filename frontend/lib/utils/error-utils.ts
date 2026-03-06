/**
 * Returns true if the message looks like a React hydration error.
 * These errors are typically browser-recoverable (React re-renders on the client)
 * and often triggered by browser extensions injecting DOM attributes.
 */
export function isHydrationError(msg: string): boolean {
  if (!msg) return false;
  return (
    msg.includes('Hydration failed') ||
    msg.includes('hydrating') ||
    msg.includes('There was an error while hydrating') ||
    msg.includes('An error occurred during hydration') ||
    msg.includes('Suspense boundary received an update before it finished hydrating') ||
    msg.includes('Expected server HTML to contain a matching') ||
    /Minified React error #4(1[89]|2[0-7])/.test(msg)
  );
}
