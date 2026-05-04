import type { Model } from '@mariozechner/pi-ai';

export interface RunContext {
  model?: Model<any>;
  contextArgs?: Record<string, unknown>;
  signal?: AbortSignal;
}
