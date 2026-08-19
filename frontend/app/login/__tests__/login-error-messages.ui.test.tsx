/**
 * What the login form tells a user when sign-in is refused.
 *
 * The rate limiter only helps if the person hitting it can tell what happened. A locked
 * account reported as "invalid password" reads as "try again", which is the one thing
 * that cannot work — the lock refuses a CORRECT password too. So the 429's message has
 * to reach the card, while an ordinary wrong password keeps its friendlier wording.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/helpers/render-with-providers';

const h = vi.hoisted(() => ({ check2faError: null as string | null }));

vi.mock('next-auth/react', () => ({ signIn: vi.fn(async () => ({ error: null, ok: true })) }));

vi.mock('@/lib/http/fetch-wrapper', () => ({
  fetchWithCache: vi.fn(async (url: string) => {
    if (url.includes('check-2fa')) {
      // `fetchWithCache` unwraps the standard envelope's `error.message` into the throw.
      if (h.check2faError) throw new Error(h.check2faError);
      return { data: { requires2FA: false, email: 'u@example.com' } };
    }
    return { data: {} };
  }),
}));

vi.mock('@/components/ui/Dither', () => ({ Dither: () => null }));

import { LoginOrRegisterForm } from '../LoginOrRegisterForm';

async function submitLogin(screen: ReturnType<typeof renderWithProviders>) {
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'u@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'whatever' } });
  });
  await act(async () => { fireEvent.click(screen.getByLabelText('Sign in')); });
}

describe('login error messages', () => {
  beforeEach(() => { h.check2faError = null; });

  it('surfaces the rate-limit message instead of blaming the password', async () => {
    h.check2faError = 'Too many failed sign-in attempts. Please try again later.';
    const screen = renderWithProviders(<LoginOrRegisterForm />);
    await submitLogin(screen);

    expect(screen.getByText(/Too many failed sign-in attempts/i)).toBeTruthy();
  });

  it('still says the credentials are wrong for an ordinary refusal', async () => {
    h.check2faError = 'Invalid email or password';
    const screen = renderWithProviders(<LoginOrRegisterForm />);
    await submitLogin(screen);

    expect(screen.getByText(/Invalid email or password/i)).toBeTruthy();
  });

  it('falls back to a friendly message when the failure carries no envelope', async () => {
    // A transport-level failure has an `HTTP 502: …` message, which is not user-facing.
    h.check2faError = 'HTTP 502: Bad Gateway';
    const screen = renderWithProviders(<LoginOrRegisterForm />);
    await submitLogin(screen);

    expect(screen.getByText(/Invalid email or password/i)).toBeTruthy();
  });
});
