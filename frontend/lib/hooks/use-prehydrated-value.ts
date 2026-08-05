'use client';

/**
 * Adopt what the browser already put in a server-rendered input, before hydration.
 *
 * A server-rendered form is interactive as plain HTML the moment it paints — sooner than the
 * bundle hydrates, and `autofocus` invites the user to type into it right then. Browser autofill
 * and password managers fill it in the same window. React keeps that text through hydration
 * itself, but the `useState` behind the controlled input is still `''`, so the first subsequent
 * render calls React's `updateInput`, sees `props.value !== element.value`, and writes the field
 * back to empty. On the login page that render is guaranteed (`useHtmlDark` reads the `.dark`
 * class in a mount effect), which is why the field reliably blanks a moment after load.
 *
 * Attach the returned ref to the input and the mount effect seeds state from the live DOM value,
 * so the controlled value agrees with what the user sees and no later render can wipe it.
 */
import { useEffect, useRef, type RefObject } from 'react';

export function usePrehydratedValue(
  adopt: (value: string) => void,
): RefObject<HTMLInputElement | null> {
  const ref = useRef<HTMLInputElement | null>(null);
  // The setter is read at mount only; keeping it in a ref means an inline arrow at the call site
  // does not need memoizing.
  const adoptRef = useRef(adopt);
  adoptRef.current = adopt;

  useEffect(() => {
    const value = ref.current?.value;
    if (value) adoptRef.current(value);
    // Mount only: after this, the input is a normal controlled input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return ref;
}
