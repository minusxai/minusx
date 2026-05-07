// Public surface for the chat data source abstraction.
//
// `useChatData(conversationId)` is the recommended entry point for callers —
// it picks `useV2ChatData` when `?v=2` is present in the URL, otherwise the
// legacy adapter. Both adapters always run (React's rules-of-hooks forbid
// conditional hook calls), but the unused one is no-op-cheap.

'use client';

import { useUseChatV2 } from '@/lib/chat-v2/use-chat-v2';
import { useLegacyChatData } from './legacy';
import { useV2ChatData } from './v2';
import type { ChatDataSource } from './types';

export function useChatData(conversationId: number | undefined): ChatDataSource {
  const useV2 = useUseChatV2();
  // Both adapters are called (rules-of-hooks) but the inactive one is
  // disabled to prevent its side-effects from running.
  const legacy = useLegacyChatData(useV2 ? undefined : conversationId, { enabled: !useV2 });
  const v2 = useV2ChatData(useV2 ? conversationId : undefined, { enabled: useV2 });
  return useV2 ? v2 : legacy;
}

export { useLegacyChatData } from './legacy';
export { useV2ChatData } from './v2';
export type { ChatDataSource } from './types';
