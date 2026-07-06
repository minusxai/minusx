/**
 * ClarifyFrontend - Ask user for clarification with options
 * Supports single or multi-select responses
 */
import type { ClarifyDetails } from '@/lib/types';
import { UserInputException } from '../user-input-exception';
import type { FrontendToolHandler } from './types';

export const clarifyFrontendHandler: FrontendToolHandler = async (args, context) => {
  const { question, options, multiSelect = false } = args;
  const { userInputs } = context;

  const userResponse = userInputs?.[0]?.result;

  if (userResponse === undefined) {
    throw new UserInputException({
      type: 'choice',
      title: 'Clarification needed',
      message: question,
      options: options.map((opt: any) => ({
        label: opt.label,
        description: opt.description
      })),
      multiSelect,
      cancellable: true
    });
  }

  // Handle cancellation
  if (userResponse?.cancelled) {
    const msg = 'User cancelled the clarification request';
    const content = { success: false, message: msg };
    return { content, details: { success: false, error: msg, message: msg } satisfies ClarifyDetails };
  }

  // Handle "Figure it out" option
  if (userResponse?.figureItOut) {
    const selection = { label: 'Figure it out', figureItOut: true };
    const msg = 'User chose: Figure it out (agent should decide based on context)';
    const content = { success: true, message: msg, selection };
    return { content, details: { success: true, message: msg, selection } satisfies ClarifyDetails };
  }

  // Handle "Other" option with custom text
  if (userResponse?.other) {
    const selection = { label: 'Other', other: true, text: userResponse.text };
    const msg = `User provided custom response: ${userResponse.text}`;
    const content = { success: true, message: msg, selection };
    return { content, details: { success: true, message: msg, selection } satisfies ClarifyDetails };
  }

  // Format response message for regular selections
  const formatSelection = (sel: any) => {
    if (Array.isArray(sel)) {
      return sel.map((s: any) => s.label).join(', ');
    }
    return sel?.label || sel;
  };

  const selection = userResponse;
  const msg = `User selected: ${formatSelection(userResponse)}`;
  const content = { success: true, message: msg, selection };
  return { content, details: { success: true, message: msg, selection } satisfies ClarifyDetails };
};
