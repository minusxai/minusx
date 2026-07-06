/**
 * PublishAll - Open PublishModal for user to review and publish all unsaved changes
 */
import { selectDirtyFiles } from '@/store/filesSlice';
import { getStore } from '@/store/store';
import { UserInputException } from '../user-input-exception';
import type { FrontendToolHandler } from './types';

export const publishAllHandler: FrontendToolHandler = async (_args, context) => {
  const { userInputs, state } = context;

  const userResponse = userInputs?.[0]?.result;

  // First invocation: check dirty files and show modal if needed
  if (userResponse === undefined) {
    const reduxState = state || getStore().getState();
    const dirtyFiles = selectDirtyFiles(reduxState);

    if (dirtyFiles.length === 0) {
      return { content: { success: true, message: 'No unsaved changes' }, details: { success: true } };
    }

    throw new UserInputException({
      type: 'publish',
      title: 'Unsaved Changes',
      fileCount: dirtyFiles.length,
    });
  }

  // Resume: user closed the modal — use their response directly.
  // Do NOT re-read dirtyFiles here: publishAll() already cleared them in Redux,
  // so re-reading would incorrectly return 'No unsaved changes'.
  if (userResponse.cancelled) {
    const msg = `Publish cancelled. ${userResponse.remaining} file${userResponse.remaining === 1 ? '' : 's'} still have unsaved changes.`;
    return { content: { success: false, message: msg }, details: { success: false, error: msg, message: msg } };
  }

  const fileCount = userInputs?.[0]?.props?.fileCount ?? 0;
  const msg = `Published ${fileCount} file${fileCount === 1 ? '' : 's'} successfully.`;
  return { content: { success: true, message: msg }, details: { success: true, message: msg } };
};
