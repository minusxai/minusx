/**
 * ClarifyFrontend - Ask user for clarification with options
 * Supports single or multi-select responses, image-card options (options with `imageUrl`),
 * and the `type: 'design'` preset (app-supplied story design-theme options — §6a Layer B).
 */
import type { ClarifyDetails } from '@/lib/types';
import { getDesignThemeOptions } from '@/lib/branding/story-theme-options';
import { UserInputException } from '../user-input-exception';
import type { FrontendToolHandler } from './types';

export const clarifyFrontendHandler: FrontendToolHandler = async (args, context) => {
  const { question, options, multiSelect = false, type } = args;
  const { userInputs } = context;
  const isDesignPreset = type === 'design';

  const userResponse = userInputs?.[0]?.result;

  if (userResponse === undefined) {
    // The design preset ignores model-passed options: the app owns the theme list (with preview
    // images), so it can never drift from the registry. Theme picking is single-select.
    const effectiveOptions = isDesignPreset ? getDesignThemeOptions() : options;
    throw new UserInputException({
      type: 'choice',
      title: 'Clarification needed',
      message: question,
      options: effectiveOptions.map((opt: any) => ({
        label: opt.label,
        description: opt.description,
        value: opt.value,
        imageUrl: opt.imageUrl,
      })),
      multiSelect: isDesignPreset ? false : multiSelect,
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
    const msg = isDesignPreset
      ? 'User chose: Figure it out — pick the design theme yourself based on the story\'s content and audience'
      : 'User chose: Figure it out (agent should decide based on context)';
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

  // Design preset: return the chosen theme's `value` AND its description so the agent knows the
  // chosen design's personality (it writes `<theme>` and harmonizing custom CSS from this).
  if (isDesignPreset) {
    const selection = userResponse;
    const value = selection?.value ?? selection?.label;
    const description = selection?.description ?? '';
    const msg = `User selected design theme: ${value}${description ? ` — ${description}` : ''}`;
    const content = { success: true, message: msg, value, description, selection };
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
