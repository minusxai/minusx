import 'server-only';
import type { EffectiveUser } from '@/lib/auth/auth-helpers';
import { buildServerAgentArgs } from '@/lib/chat/agent-args.server';

export async function buildSlackAgentArgs(user: EffectiveUser): Promise<{
  connection_id?: string;
  selected_database_info?: { name: string; dialect: string };
  schema?: Array<{ schema: string; tables: string[] }>;
  context?: string;
  app_state: { type: 'slack' };
}> {
  const base = await buildServerAgentArgs(user);
  return {
    ...base,
    app_state: { type: 'slack' },
  };
}
