import { useCallback, useMemo } from 'react';
import { useRouter } from '@/lib/navigation/use-navigation';
import type { SlashCommand } from '@/lib/types';
import type { AppState } from '@/lib/appState';
import { publishFile } from '@/lib/file-state/file-state';
import { toaster } from '@/components/ui/toaster';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { interruptChat, setActiveConversation, selectActiveConversation, selectOptionalConversation } from '@/store/chatSlice';
import { clearChatAttachments, selectDevMode } from '@/store/uiSlice';
import { selectFile, selectIsDirty } from '@/store/filesSlice';
import { selectEffectiveUser } from '@/store/authSlice';
import { isAdmin } from '@/lib/auth/role-helpers';

/**
 * Hook that clears the current chat: stops the agent, deactivates the conversation,
 * and navigates to /explore when on the explore page.
 */
export function useClearChat(container?: 'page' | 'sidebar') {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const conversationID = useAppSelector(selectActiveConversation) ?? null;
  const conversation = useAppSelector(state => selectOptionalConversation(state, conversationID ?? undefined));
  const isAgentRunning = conversation?.executionState === 'WAITING' || conversation?.executionState === 'EXECUTING';

  return useCallback(() => {
    dispatch(clearChatAttachments());
    if (conversationID && isAgentRunning) {
      dispatch(interruptChat({ conversationID }));
    }
    dispatch(setActiveConversation(null));
    if (container === 'page') {
      router.push('/explore');
    }
  }, [dispatch, router, conversationID, isAgentRunning, container]);
}

/**
 * Hook that provides slash command definitions and execution handler.
 * Commands are context-aware: /save is disabled when no file is open.
 */
export function useSlashCommands({
  appState,
  container,
  onDebugViz,
}: {
  appState?: AppState | null;
  container?: 'page' | 'sidebar';
  onDebugViz?: () => void;
}) {
  const clearChat = useClearChat(container);
  const fileId = appState?.type === 'file' ? appState.state?.fileState?.id : null;
  const isDirty = useAppSelector(state => fileId != null ? selectIsDirty(state, fileId) : false);
  const isDraft = useAppSelector(state => fileId != null ? selectFile(state, fileId)?.draft === true : false);
  const effectiveUser = useAppSelector(selectEffectiveUser);
  const devMode = useAppSelector(selectDevMode);
  const showDebug = !!effectiveUser?.role && isAdmin(effectiveUser.role) && devMode;

  const availableCommands = useMemo((): SlashCommand[] => [
    { type: 'command', name: 'clear', label: '/clear', description: 'Start a new chat' },
    {
      type: 'command', name: 'save', label: '/save', description: 'Save current file',
      ...(fileId == null ? { disabled: true, disabledReason: 'No file to save' } :
          isDraft ? { disabled: true, disabledReason: 'Use the save button to name this file first' } :
          !isDirty ? { disabled: true, disabledReason: 'No unsaved changes' } : {}),
    },
    ...(showDebug ? [{
      type: 'command', name: 'debug', label: '/debug', description: 'Visualize conversation tokens & cost',
    } satisfies SlashCommand] : []),
  ], [fileId, isDirty, isDraft, showDebug]);

  const handleCommandExecute = useCallback((command: SlashCommand) => {
    switch (command.name) {
      case 'clear':
        clearChat();
        toaster.create({ title: 'Chat cleared', type: 'success', duration: 2000 });
        break;
      case 'save':
        if (fileId != null) {
          publishFile({ fileId }).then(() => {
            toaster.create({ title: 'Saved!', type: 'success', duration: 2000 });
          }).catch((err: Error) => {
            toaster.create({ title: err.message || 'Failed to save', type: 'error' });
          });
        }
        break;
      case 'debug':
        onDebugViz?.();
        break;
    }
  }, [clearChat, fileId, onDebugViz]);

  return { availableCommands, handleCommandExecute };
}

/**
 * Check if raw input text is a slash command and execute it.
 * Returns true if a command was matched and executed.
 */
export function tryExecuteSlashCommand(
  input: string,
  commands: SlashCommand[],
  execute: (cmd: SlashCommand) => void,
): boolean {
  const match = input.match(/^\/([\w-]+)$/);
  if (!match) return false;
  const name = match[1].toLowerCase();
  const cmd = commands.find(c => c.name === name);
  if (cmd && !cmd.disabled) {
    execute(cmd);
    return true;
  }
  return false;
}
