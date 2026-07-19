'use client';

/**
 * Container for the /debug visualization: fetches the conversation log, the
 * recorded LLM calls (+catalog rates), and — per the logs-source toggle —
 * either the projected next-turn context (server preview) or the last
 * recorded raw request; builds the ConvoDebugModel and renders the view.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppSelector } from '@/store/hooks';
import { loadConversationDetail } from '@/store/conversation-log-cache';
import { getConversationLlmCalls, getDebugContext } from '@/lib/chat/llm-calls';
import { buildConvoDebugModel, requestJsonToInput, type CostMode } from '@/lib/convo-debug';
import type { ConvoDebugInput } from '@/lib/convo-debug/types';
import type { ChatRequest } from '@/lib/chat/chat-types';
import ConvoDebugModal, { type ConvoDebugViewState, type LogSource } from './ConvoDebugModal';

interface ConvoDebugContainerProps {
  conversationID: number;
  /** Builds the same probe body /view-context-size sends (screenshot included). */
  buildProbeBody: () => Promise<ChatRequest>;
  onClose: () => void;
}

export default function ConvoDebugContainer({ conversationID, buildProbeBody, onClose }: ConvoDebugContainerProps) {
  const colorMode = useAppSelector((s) => s.ui.colorMode);
  const [logSource, setLogSource] = useState<LogSource>('projected');
  const [costMode, setCostMode] = useState<CostMode>('expected');
  const [state, setState] = useState<ConvoDebugViewState>({ status: 'loading' });
  // Built models per logs-source, so toggling Projected↔Raw is instant after
  // the first load of each side (the projected side re-runs the server-side
  // orchestration preview — the expensive call).
  const modelCache = useRef(new Map<LogSource, ConvoDebugViewState>());

  const load = useCallback(async (source: LogSource, signal: { cancelled: boolean }) => {
    const cached = modelCache.current.get(source);
    if (cached) {
      setState(cached);
      return;
    }
    setState({ status: 'loading' });
    try {
      const [{ piLog }, { calls, rates }] = await Promise.all([
        loadConversationDetail(conversationID, 'full'),
        getConversationLlmCalls(conversationID),
      ]);
      let input: ConvoDebugInput;
      if (source === 'raw') {
        const lastWithRequest = [...calls].reverse().find((c) => c.requestJson);
        if (!lastWithRequest?.requestJson) {
          throw new Error('No recorded LLM requests for this conversation yet — try the projected view.');
        }
        // Append the request's recorded RESPONSE so the final assistant turn
        // shows (a request never contains its own response).
        input = requestJsonToInput(lastWithRequest.requestJson, piLog, rates, lastWithRequest.callId);
      } else {
        const context = await getDebugContext(await buildProbeBody());
        input = {
          systemPrompt: context.systemPrompt,
          toolDefsChars: context.toolDefsChars,
          messages: context.messages,
          log: piLog,
          rates,
        };
      }
      if (signal.cancelled) return;
      const ready: ConvoDebugViewState = { status: 'ready', model: buildConvoDebugModel(input) };
      modelCache.current.set(source, ready);
      setState(ready);
    } catch (err) {
      if (signal.cancelled) return;
      setState({ status: 'error', error: err instanceof Error ? err.message : 'Failed to build debug model' });
    }
  }, [conversationID, buildProbeBody]);

  useEffect(() => {
    const signal = { cancelled: false };
    void load(logSource, signal);
    return () => { signal.cancelled = true; };
  }, [load, logSource]);

  return (
    <ConvoDebugModal
      state={state}
      logSource={logSource}
      costMode={costMode}
      colorMode={colorMode}
      onLogSourceChange={setLogSource}
      onCostModeChange={setCostMode}
      onClose={onClose}
    />
  );
}
