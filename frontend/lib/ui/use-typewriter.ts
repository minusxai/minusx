import { useState, useEffect, useCallback, useRef } from 'react';

/** ms per character. */
export const TYPEWRITER_SPEED = 35;

export interface Typewriter {
  /** The characters revealed so far. */
  displayed: string;
  /** True once the whole string is shown — callers hide their blinking cursor on this. */
  done: boolean;
  /** Reveal the rest immediately. Wired to document click/keydown for you; exposed for callers
   *  that want an explicit affordance too. */
  reveal: () => void;
}

/**
 * Types `text` out one character at a time, and lets the user cut it short.
 *
 * The animation is a flourish, and the second time someone sees it it is a wait. At 35ms/char a
 * heading like "Step 2: Let's create a Knowledge Base." runs ~13s, on every step of the setup
 * wizard — roughly a minute across the flow, with the controls underneath already live and
 * clickable the whole time. Nothing offered to skip it: the only "Skip" on screen abandoned setup.
 *
 * So any click or keypress anywhere completes it. The listeners are attached only while typing and
 * removed the moment it finishes, so they never sit between the user and the page afterwards.
 *
 * This exists as a hook because six components need the same effect — per-component copies drift,
 * and a fix applied to one copy is not a fix.
 */
export function useTypewriter(text: string | undefined, speed: number = TYPEWRITER_SPEED): Typewriter {
  const full = text ?? '';
  const [displayed, setDisplayed] = useState('');
  const [done, setDone] = useState(!full);

  // Read inside the document listener without making it a dependency — re-subscribing on every
  // character would tear down and re-add the listener ~30 times a second.
  const fullRef = useRef(full);
  fullRef.current = full;

  const reveal = useCallback(() => {
    setDisplayed(fullRef.current);
    setDone(true);
  }, []);

  useEffect(() => {
    if (!full) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDisplayed('');
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDone(true);
      return;
    }

    let i = 0;

    setDisplayed('');

    setDone(false);

    const interval = setInterval(() => {
      i++;
      setDisplayed(full.slice(0, i));
      if (i >= full.length) {
        clearInterval(interval);
        setDone(true);
      }
    }, speed);

    const skip = () => {
      clearInterval(interval);
      setDisplayed(full);
      setDone(true);
    };
    document.addEventListener('click', skip);
    document.addEventListener('keydown', skip);

    return () => {
      clearInterval(interval);
      document.removeEventListener('click', skip);
      document.removeEventListener('keydown', skip);
    };
  }, [full, speed]);

  return { displayed, done, reveal };
}
