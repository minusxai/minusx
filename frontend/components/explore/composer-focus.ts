/**
 * Elements a composer-background mousedown must NOT hijack focus from. The composer's outer box has an
 * `onMouseDown` that `preventDefault()`s and refocuses the editor so clicking empty space keeps the
 * caret in the chat input. That handler must skip interactive controls — AND anything inside a
 * portaled dialog: the screen-region annotator is a REACT child of ChatInput (DOM-portaled to
 * <body>), so React bubbles its clicks up to the composer's handler. `textarea` and `[role="dialog"]`
 * are essential here — without them, left-clicking the annotator's note field was hijacked
 * (preventDefault + editor.focus()), so it could never take focus and was un-typeable.
 */
const PASSTHROUGH_SELECTOR =
  'button, input, textarea, select, [contenteditable], [role="listbox"], [role="option"], [data-lexical-editor], [role="dialog"]';

/** True when the composer background mousedown should leave the target alone (not refocus the editor). */
export function isComposerFocusPassthrough(target: HTMLElement | null): boolean {
  return !!target?.closest(PASSTHROUGH_SELECTOR);
}
