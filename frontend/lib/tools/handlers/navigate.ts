/**
 * Navigate - Navigate user to a file, folder, or new file creation page
 */
import { UserInputException } from '../user-input-exception';
import { FilesAPI } from '@/lib/data/files';
import { getRouter } from '@/lib/navigation/use-navigation';
import { createDraftFile } from '@/lib/file-state/file-state';
import { canCreateFileType } from '@/lib/auth/access-rules.client';
import type { FrontendToolHandler } from './types';

export const navigateHandler: FrontendToolHandler = async (args, context) => {
  const { file_id, path, newFileType } = args;
  const { state, userInputs } = context;

  // Check if user confirmation is required
//   const askForConfirmation = state?.ui?.askForConfirmation ?? false;
// All navigation is always confirmed for now since it's a critical action and we don't want accidental navigations.
  const askForConfirmation = true;

  if (askForConfirmation) {
    // Check if user already confirmed
    const userConfirmed = userInputs?.[0]?.result;

    if (userConfirmed === undefined) {
      // Build description of where we're navigating
      let destination = '';
      if (file_id !== undefined) {
        destination = `file "${file_id}"`;
      } else if (newFileType !== undefined) {
        destination = path ? `"new ${newFileType}" in ${path}` : `"new ${newFileType}"`;
      } else if (path !== undefined) {
        destination = `folder ${path}`;
      }

      // First time - ask for confirmation
      throw new UserInputException({
        type: 'confirmation',
        title: 'Navigation request',
        message: `The agent wants to navigate to ${destination}. Allow it?`,
        confirmText: 'Go ahead',
        cancelText: 'Stay here'
      });
    }

    if (userConfirmed === false || userConfirmed?.declined) {
      // User cancelled — include their reason if provided
      const reason = userConfirmed?.reason;
      const msg = reason
        ? `Navigation cancelled by user. Reason: ${reason}`
        : 'Navigation cancelled by user';
      return { content: { success: false, message: msg }, details: { success: false, error: msg } };
    }

    // User confirmed - continue with navigation
  }

  const router = getRouter();
  if (!router) {
    const msg = 'Router not available';
    return { content: { success: false, message: msg }, details: { success: false, error: msg } };
  }

  // Navigate to existing file
  if (file_id !== undefined) {
    if (isNaN(parseInt(file_id))) {
      const msg = `Invalid file_id: ${file_id}. If you do not want to provide it, don't pass it at all.`;
      return { content: { success: false, message: msg }, details: { success: false, error: msg } };
    }

    router.push(`/f/${file_id}`);
    if (state) {
      const fileState = state.files.files[file_id]
      if (!fileState?.content) {
        await FilesAPI.loadFile(file_id)
      }
    }
    const debugMsg = newFileType !== undefined ? `;newFileType=${newFileType} is ignored since file_id provided` : ''
    const debugMsg2 = path !== undefined ? `;path=${path} is ignored since file_id provided` : ''
    const msg = `Navigated to file ${file_id}${debugMsg}${debugMsg2}`;
    return { content: { success: true, message: msg }, details: { success: true } };
  }

  // Create a draft file and navigate directly to it
  if (newFileType !== undefined) {
    const canCreate = canCreateFileType(newFileType);
    if (!canCreate) {
      const msg = `You don't have permission to create ${newFileType} files`;
      return { content: { success: false, message: msg }, details: { success: false, error: msg } };
    }

    const draftId = await createDraftFile(newFileType, path ? { folder: path } : {});
    router.push(`/f/${draftId}`);
    const msg = (path
      ? `Created new ${newFileType} in ${path}, navigating to /f/${draftId}`
      : `Created new ${newFileType}, navigating to /f/${draftId}`)
      // The nameless draft's path ends in a random placeholder token until the user saves —
      // warn the agent up front so it doesn't treat the token as a real path/name later.
      + `. Note: the draft's \`path\` ends in a random placeholder token (PROVISIONAL — rewritten to the title slug on save); refer to the file by id ${draftId} and give it a title via EditFile \`name\`.`;
    return { content: { success: true, message: msg }, details: { success: true } };
  }

  // Navigate to folder
  if (path !== undefined) {
    // Remove leading slash if present for the route
    const cleanPath = path.startsWith('/') ? path.slice(1) : path;
    router.push(`/p/${cleanPath}`);
    const msg = `Navigated to ${path}`;
    return { content: { success: true, message: msg }, details: { success: true } };
  }

  const msg = 'Must provide file_id, path, or newFileType';
  return { content: { success: false, message: msg }, details: { success: false, error: msg } };
};
