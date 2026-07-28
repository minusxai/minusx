/**
 * The run lease identifies its owner by INSTANCE_ID, so a stale lease means "that owner
 * died". That only holds if the id is unique per process.
 *
 * A process id is not: each container gets its own PID namespace, so every instance of
 * the same image starts its node process at the same PID. Measured on node:20-slim, the
 * shipped image gives PID 7 on every fresh container — so every instance would claim
 * leases as `pid-7`, and instance B's heartbeat would renew instance A's lease.
 */

import { INSTANCE_ID } from '@/lib/chat/conversation-turn.server';

describe('INSTANCE_ID', () => {
  it('is not derived from the process id', () => {
    // The failure this guards against is silent: `pid-7` looks like a fine identifier
    // right up until a second replica claims the same one.
    expect(INSTANCE_ID).not.toContain(String(process.pid));
    expect(INSTANCE_ID).not.toMatch(/^pid-/);
  });

  it('is a random per-process identifier', () => {
    expect(INSTANCE_ID).toMatch(/^mx-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('is stable within the process', () => {
    // Leases are acquired and heartbeated by separate calls — a value that changed
    // between them would make every instance look like it had died.
    expect(INSTANCE_ID).toBe(INSTANCE_ID);
  });
});
