/**
 * Watchdog for frontend-bridged tool execution.
 *
 * The chat bridge (store/chatListener.ts) awaits each tool handler and dispatches
 * `completeToolCall` with its result — if a handler never settles (a hung fetch with no timeout,
 * a query with timeouts disabled, a stuck upload), the completion never dispatches and the
 * conversation is stuck in "executing" forever. Racing every execution against this watchdog
 * bounds the damage: the tool completes with a truthful timeout error the agent can react to.
 *
 * The underlying work is NOT cancelled (the bridge owns cancellation via the conversation's
 * abort signal); a late settlement after the watchdog fired is swallowed so the tool is never
 * completed twice.
 */

export class ToolWatchdogTimeout extends Error {
  constructor(toolName: string, ms: number) {
    super(
      `Tool "${toolName}" did not finish within ${Math.round(ms / 1000)}s and was abandoned. `
      + 'It may still be running in the background; its result will be ignored. Retry, or take a smaller action.',
    );
    this.name = 'ToolWatchdogTimeout';
  }
}

/** Race `work` against a deadline; late settlements after the deadline are swallowed. */
export function withToolWatchdog<T>(work: Promise<T>, toolName: string, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new ToolWatchdogTimeout(toolName, ms));
    }, ms);
    work.then(
      (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } },
      (e) => { if (!settled) { settled = true; clearTimeout(timer); reject(e); } },
    );
  });
}
