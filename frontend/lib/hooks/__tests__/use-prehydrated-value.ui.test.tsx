/**
 * The login form is server-rendered with `autofocus` on the email input, so the browser focuses
 * it and the user can type BEFORE the client bundle hydrates. React preserves that text through
 * hydration itself (`initInput` skips the value write while `isHydrating`), but the state behind
 * the controlled input is still `''` — so the very next re-render calls `updateInput`, which
 * resets `element.value` to `''` and the typing is gone. `LoginOrRegisterForm` guarantees such a
 * re-render on mount (`useHtmlDark` reads the `.dark` class in an effect).
 *
 * `usePrehydratedValue` closes that window by adopting whatever the DOM already holds into state.
 * The first test below fails without it — that is the point of the pair.
 */
import { describe, it, expect } from 'vitest';
import { useEffect, useState } from 'react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { act } from 'react';
import { ChakraProvider, Input } from '@chakra-ui/react';
import { system } from '@/lib/ui/theme';
import { usePrehydratedValue } from '../use-prehydrated-value';

/**
 * A miniature of the login form: server-rendered, controlled, and with the one guaranteed
 * post-hydration re-render (`useHtmlDark`'s effect) that does the wiping.
 */
function EmailForm({ adopt }: { adopt: boolean }) {
  const [email, setEmail] = useState('');
  const [, setIsDark] = useState(false);
  // Deliberately the shape of the real `useHtmlDark`: a mount effect that sets state, which is
  // the re-render that wipes the field. Reproducing the bug requires reproducing this.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setIsDark(true); }, []);
  const ref = usePrehydratedValue(setEmail);
  return (
    <input
      aria-label="Email"
      type="email"
      ref={adopt ? ref : undefined}
      value={email}
      onChange={(e) => setEmail(e.target.value)}
    />
  );
}

/** Server-render, let the user type before hydration, then hydrate. Returns the live input. */
async function typeBeforeHydration(adopt: boolean) {
  const container = document.createElement('div');
  container.innerHTML = renderToString(<EmailForm adopt={adopt} />);
  document.body.appendChild(container);

  const input = container.querySelector('input')!;
  expect(input.value).toBe('');
  // The pre-hydration keystrokes: no React listener exists yet, so this is a raw DOM value.
  input.value = 'sreejith@minusx.ai';

  await act(async () => {
    hydrateRoot(container, <EmailForm adopt={adopt} />);
  });
  return input;
}

describe('usePrehydratedValue', () => {
  it('keeps text typed before hydration (the login-screen bug)', async () => {
    const input = await typeBeforeHydration(true);
    expect(input.value).toBe('sreejith@minusx.ai');
  });

  it('without it, the first post-hydration render wipes the same text', async () => {
    const input = await typeBeforeHydration(false);
    expect(input.value).toBe('');
  });

  /**
   * The login form's fields are Chakra `Input`s, not bare `<input>`s. If Chakra did not forward
   * the ref to the DOM node the hook would find nothing and fail silently — no error, no test
   * failure anywhere else. This is the only assertion that covers that link.
   */
  it('works through a Chakra Input (the ref reaches the DOM node)', async () => {
    function ChakraEmailForm() {
      const [email, setEmail] = useState('');
      const [, setIsDark] = useState(false);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      useEffect(() => { setIsDark(true); }, []);
      const ref = usePrehydratedValue(setEmail);
      return (
        <ChakraProvider value={system}>
          <Input ref={ref} type="email" aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </ChakraProvider>
      );
    }

    const container = document.createElement('div');
    container.innerHTML = renderToString(<ChakraEmailForm />);
    document.body.appendChild(container);
    const input = container.querySelector('input')!;
    input.value = 'chakra@minusx.ai';

    await act(async () => {
      hydrateRoot(container, <ChakraEmailForm />);
    });

    expect(input.value).toBe('chakra@minusx.ai');
  });

  it('leaves an empty input alone', async () => {
    const container = document.createElement('div');
    container.innerHTML = renderToString(<EmailForm adopt />);
    document.body.appendChild(container);
    await act(async () => {
      hydrateRoot(container, <EmailForm adopt />);
    });
    expect(container.querySelector('input')!.value).toBe('');
  });
});
