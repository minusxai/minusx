/**
 * The passwordless email-code login, for an account that ALSO has a second factor.
 *
 * A code is one factor, so `evaluateCredentials` refuses it alone. Before this step
 * existed, that meant the Email Code tab dead-ended: a correct code produced a generic
 * sign-in failure with nothing the user could act on. `verify-otp` reports
 * `passwordRequired`, and the form must answer it by collecting the password and
 * submitting BOTH — the assertion that matters is the shape of the `signIn` call.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { waitFor, act, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';

const h = vi.hoisted(() => ({
  signInCalls: [] as Record<string, unknown>[],
  passwordRequired: false,
}));

vi.mock('next-auth/react', () => ({
  signIn: vi.fn(async (_provider: string, opts: Record<string, unknown>) => {
    h.signInCalls.push(opts);
    return { error: null, ok: true };
  }),
}));

vi.mock('@/lib/http/fetch-wrapper', () => ({
  fetchWithCache: vi.fn(async (url: string) => {
    if (url.includes('send-otp')) return { data: { token: 'a'.repeat(64) } };
    if (url.includes('verify-otp')) {
      return { data: { verifiedToken: 'VERIFIED-TOKEN', passwordRequired: h.passwordRequired, email: 'u@example.com' } };
    }
    // Anything else (e.g. /api/configs from useConfigs) is incidental to this flow.
    return { data: {} };
  }),
}));

// Canvas-backed decoration; jsdom has no 2d context and the flow does not need it.
vi.mock('@/components/ui/Dither', () => ({ Dither: () => null }));

import { LoginOrRegisterForm } from '../LoginOrRegisterForm';

/** Walk the Email Code entry point as far as a verified code. */
async function reachVerifiedCode(screen: ReturnType<typeof renderWithProviders>) {
  await act(async () => { fireEvent.click(screen.getByLabelText('Email code login')); });
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'u@example.com' } });
  });
  await act(async () => { fireEvent.click(screen.getByLabelText('Send login code')); });

  // One field per digit; the last one submits on its own via `onComplete`, so there is
  // no button press here. The explicit-button path is covered by the `verify-otp` route
  // tests and by the dedicated auto-submit case below.
  const digits = await screen.findAllByLabelText(/Login code digit/i);
  for (let i = 0; i < digits.length; i++) {
    await act(async () => { fireEvent.change(digits[i], { target: { value: String(i + 1) } }); });
  }
}

describe('completing the code submits it', () => {
  beforeEach(() => {
    h.signInCalls.length = 0;
    h.passwordRequired = false;
  });

  it('verifies as soon as the sixth digit is entered, with no button press', async () => {
    // `OTPInput` calls `onComplete(newValue)` on the last digit, but the handler used to
    // read `otp` from state — which, in that same render, still holds five digits. The
    // guard therefore rejected every auto-submit and the affordance did nothing.
    const screen = renderWithProviders(<LoginOrRegisterForm hasEmailOTP />);
    await act(async () => { fireEvent.click(screen.getByLabelText('Email code login')); });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'u@example.com' } });
    });
    await act(async () => { fireEvent.click(screen.getByLabelText('Send login code')); });

    const digits = await screen.findAllByLabelText(/Login code digit/i);
    for (let i = 0; i < digits.length; i++) {
      await act(async () => { fireEvent.change(digits[i], { target: { value: String(i + 1) } }); });
    }

    await waitFor(() => expect(h.signInCalls).toHaveLength(1));
  });
});

describe('email-code login for a 2FA account', () => {
  beforeEach(() => {
    h.signInCalls.length = 0;
    h.passwordRequired = false;
  });

  it('signs in on the code alone when the account has no second factor', async () => {
    const screen = renderWithProviders(<LoginOrRegisterForm hasEmailOTP />);
    await reachVerifiedCode(screen);

    await waitFor(() => expect(h.signInCalls).toHaveLength(1));
    expect(h.signInCalls[0]).toMatchObject({
      email: 'u@example.com',
      otp_verified_token: 'VERIFIED-TOKEN',
    });
    expect(h.signInCalls[0].password).toBeFalsy();
  });

  it('asks for the password instead of signing in when the account owes a second factor', async () => {
    h.passwordRequired = true;
    const screen = renderWithProviders(<LoginOrRegisterForm hasEmailOTP />);
    await reachVerifiedCode(screen);

    // The dead-end this step exists to prevent: no sign-in attempt on the code alone.
    await waitFor(() => expect(screen.getByLabelText('Finish sign in')).toBeTruthy());
    expect(h.signInCalls).toHaveLength(0);
  });

  it('submits BOTH factors together once the password is given', async () => {
    h.passwordRequired = true;
    const screen = renderWithProviders(<LoginOrRegisterForm hasEmailOTP />);
    await reachVerifiedCode(screen);

    const password = await screen.findByLabelText('Password');
    await act(async () => { fireEvent.change(password, { target: { value: 'correct-horse' } }); });
    await act(async () => { fireEvent.click(screen.getByLabelText('Finish sign in')); });

    await waitFor(() => expect(h.signInCalls).toHaveLength(1));
    expect(h.signInCalls[0]).toMatchObject({
      email: 'u@example.com',
      password: 'correct-horse',
      otp_verified_token: 'VERIFIED-TOKEN',
    });
  });
});
