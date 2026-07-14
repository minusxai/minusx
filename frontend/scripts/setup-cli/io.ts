// Shared plumbing for setup-cli entries (`scripts/setup-cli/*.ts`) — invoked
// by setup.sh inside the app image:
//   docker run --rm -i <image> node --import tsx --import ./scripts/setup-cli/node-preload.mjs scripts/setup-cli/<entry>.ts
// Input arrives as JSON on STDIN (never argv — argv leaks secrets to `ps`);
// the result is a single JSON object on stdout. Exit codes: 0 = ok,
// 1 = validation ran and failed, 2 = malformed input.
import { pathToFileURL } from 'node:url';

export interface CliOutcome<T> {
  result: T;
  exitCode: 0 | 1 | 2;
}

/** Read all of stdin and parse it as JSON (null on parse failure). */
export async function readStdinJson(): Promise<unknown | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

/** True when `moduleUrl` is the entrypoint (vs imported by a test). */
export function isMain(moduleUrl: string): boolean {
  return !!process.argv[1] && moduleUrl === pathToFileURL(process.argv[1]).href;
}

/** Print the outcome as JSON and exit with its code. */
export async function emit<T>(outcome: Promise<CliOutcome<T>> | CliOutcome<T>): Promise<never> {
  const { result, exitCode } = await outcome;
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exit(exitCode);
}
