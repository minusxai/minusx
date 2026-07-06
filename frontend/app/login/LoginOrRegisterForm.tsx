'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Box, VStack, HStack, Input, Button, Heading, Text } from '@chakra-ui/react';
import { Checkbox } from '@/components/ui/checkbox';
import { LuLogIn, LuBuilding2 } from 'react-icons/lu';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Dither } from '@/components/Dither';
import { ColorModeSwitch } from '@/components/ui/color-mode';
import { useConfigs } from '@/lib/hooks/useConfigs';
import { OrgConfig } from '@/lib/branding/whitelabel';
import { OTPInput } from '@/components/auth/OTPInput';
import { fetchWithCache } from '@/lib/http/fetch-wrapper';
import { API } from '@/lib/http/declarations';
import {
  validateWorkspaceName,
  validateEmail,
  validatePassword,
  validateFullName,
} from '@/lib/validation/validators';

interface LoginFormProps {
  orgConfig?: OrgConfig | null;
  hasEmailOTP?: boolean;
  loginText?: string;
  registerText?: string;
  initialMode?: 'login' | 'register';
  landingHtml?: string;
  enableOrgCreation?: boolean;
}

/**
 * Reactive read of the `.dark` class on <html>. That class is set synchronously by the inline
 * theme script in layout.tsx (before first paint) and kept current by ColorModeSync on toggle,
 * making it the single authoritative color-mode signal — unlike Redux `state.ui.colorMode`,
 * which lags by a mount effect. A MutationObserver keeps it in sync when the user toggles.
 */
function useHtmlDark(): boolean {
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const html = document.documentElement;
    const read = () => setIsDark(html.classList.contains('dark'));
    read();
    const obs = new MutationObserver(read);
    obs.observe(html, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return isDark;
}

export function LoginOrRegisterForm({
  orgConfig,
  hasEmailOTP = false,
  loginText,
  registerText,
  initialMode = 'login',
  landingHtml,
  enableOrgCreation = true,
}: LoginFormProps) {
  const searchParams = useSearchParams();
  const { config: reduxConfig } = useConfigs();
  const config = orgConfig || reduxConfig;
  const displayName = config.branding.agentName;

  // Drives the dither dot color. Read from the `.dark` class on <html> — the SAME signal the
  // photo/fade/card CSS use — so every layer stays in lockstep. Redux `colorMode` is NOT used
  // here: it initializes to 'dark' and only syncs after a mount effect, which previously left
  // the JS-styled layers (dark) mismatched against the CSS-styled ones (light) until a toggle.
  const isDark = useHtmlDark();

  // `?register` (any value, incl. empty) forces the "Set Up Your Workspace" form — handy for
  // viewing/iterating on it when there's no landing-page button to reach it.
  const [mode, setMode] = useState<'login' | 'register'>(
    searchParams.get('register') !== null ? 'register' : initialMode,
  );
  const [justCreatedOrg, setJustCreatedOrg] = useState<string | null>(null);

  // Login state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginMethod, setLoginMethod] = useState<'password' | 'emailOtp'>('password');
  const [showOTPInput, setShowOTPInput] = useState(false);
  const [otpToken, setOtpToken] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);

  // Register state
  const [workspaceName, setWorkspaceName] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [workspaceNameError, setWorkspaceNameError] = useState<string | null>(null);
  const [adminNameError, setAdminNameError] = useState<string | null>(null);
  const [adminEmailError, setAdminEmailError] = useState<string | null>(null);
  const [adminPasswordError, setAdminPasswordError] = useState<string | null>(null);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registerLoading, setRegisterLoading] = useState(false);
  const [tosAccepted, setTosAccepted] = useState(false);
  const [tosError, setTosError] = useState<string | null>(null);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setLoginLoading(true);
    try {
      let check2FAData;
      try {
        check2FAData = await fetchWithCache('/api/auth/check-2fa', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
          cacheStrategy: API.auth.check2FA.cache,
        });
      } catch {
        setLoginError('Invalid email or password');
        setLoginLoading(false);
        return;
      }
      if (check2FAData.data.requires2FA) {
        setLoginLoading(false);
        setShowOTPInput(true);
        await handleSendOTP();
        return;
      }
      const result = await signIn('credentials', { email, password, redirect: false });
      if (result?.error) {
        setLoginError('Invalid email or password');
        setLoginLoading(false);
        return;
      }
      window.location.href = searchParams.get('callbackUrl') || '/';
    } catch (err) {
      console.error('Login error:', err);
      setLoginError('An unexpected error occurred');
      setLoginLoading(false);
    }
  };

  const handleSendOTP = async () => {
    setLoginError(null);
    setOtpLoading(true);
    try {
      const data = await fetchWithCache('/api/auth/send-otp', {
        method: 'POST',
        body: JSON.stringify({ email }),
        cacheStrategy: API.auth.sendOTP.cache,
      });
      setOtpToken(data.data.token);
      setResendCooldown(30);
      const interval = setInterval(() => {
        setResendCooldown((prev) => {
          if (prev <= 1) { clearInterval(interval); return 0; }
          return prev - 1;
        });
      }, 1000);
    } catch (err) {
      console.error('Send OTP error:', err);
      setLoginError('Failed to send OTP');
    } finally {
      setOtpLoading(false);
    }
  };

  const handleVerifyOTP = async () => {
    if (!otpToken || otp.length !== 6) return;
    setLoginError(null);
    setOtpLoading(true);
    try {
      try {
        await fetchWithCache('/api/auth/verify-otp', {
          method: 'POST',
          body: JSON.stringify({ token: otpToken, otp }),
          cacheStrategy: API.auth.verifyOTP.cache,
        });
      } catch {
        setLoginError('Invalid OTP. Please try again.');
        setOtpLoading(false);
        return;
      }
      const result = await signIn('credentials', { email, password, redirect: false });
      if (result?.error) {
        setLoginError('Sign-in failed after OTP verification');
        setOtpLoading(false);
        return;
      }
      window.location.href = searchParams.get('callbackUrl') || '/';
    } catch (err) {
      console.error('Verify OTP error:', err);
      setLoginError('Failed to verify OTP');
      setOtpLoading(false);
    }
  };

  const handleSendEmailOTP = async () => {
    if (!email) { setLoginError('Please enter your email address'); return; }
    setLoginError(null);
    setOtpLoading(true);
    try {
      const data = await fetchWithCache('/api/auth/send-otp', {
        method: 'POST',
        body: JSON.stringify({ email, channel: 'email' }),
        cacheStrategy: API.auth.sendOTP.cache,
      });
      setOtpToken(data.data.token);
      setShowOTPInput(true);
      setResendCooldown(30);
      const interval = setInterval(() => {
        setResendCooldown((prev) => {
          if (prev <= 1) { clearInterval(interval); return 0; }
          return prev - 1;
        });
      }, 1000);
    } catch (err) {
      console.error('Send email OTP error:', err);
      setLoginError('Failed to send login code. Please check your email and try again.');
    } finally {
      setOtpLoading(false);
    }
  };

  const handleVerifyEmailOTP = async () => {
    if (!otpToken || otp.length !== 6) return;
    setLoginError(null);
    setOtpLoading(true);
    try {
      let verifyData;
      try {
        verifyData = await fetchWithCache('/api/auth/verify-otp', {
          method: 'POST',
          body: JSON.stringify({ token: otpToken, otp }),
          cacheStrategy: API.auth.verifyOTP.cache,
        });
      } catch {
        setLoginError('Invalid or expired code. Please try again.');
        setOtpLoading(false);
        return;
      }
      const result = await signIn('credentials', {
        email,
        otp_verified_token: verifyData.data.verifiedToken,
        redirect: false,
      });
      if (result?.error) {
        setLoginError('Sign-in failed. Please try again.');
        setOtpLoading(false);
        return;
      }
      window.location.href = searchParams.get('callbackUrl') || '/';
    } catch (err) {
      console.error('Verify email OTP error:', err);
      setLoginError('Failed to verify code');
      setOtpLoading(false);
    }
  };

  const handleRegister = async (e: FormEvent) => {
    e.preventDefault();
    setRegisterError(null);

    const nameVal = validateWorkspaceName(workspaceName);
    const adminNameVal = validateFullName(adminName);
    const emailVal = validateEmail(adminEmail);
    const passwordVal = validatePassword(adminPassword);

    setWorkspaceNameError(nameVal.valid ? null : nameVal.error!);
    setAdminNameError(adminNameVal.valid ? null : adminNameVal.error!);
    setAdminEmailError(emailVal.valid ? null : emailVal.error!);
    setAdminPasswordError(passwordVal.valid ? null : passwordVal.error!);

    if (!tosAccepted) setTosError('You must accept the Terms of Service to continue.');
    if (!nameVal.valid || !adminNameVal.valid || !emailVal.valid || !passwordVal.valid || !tosAccepted) return;

    setRegisterLoading(true);
    try {
      const result = await fetchWithCache(API.orgs.register.url as string, {
        method: 'POST',
        body: JSON.stringify({ workspaceName, adminName, adminEmail, adminPassword }),
        cacheStrategy: API.orgs.register.cache,
      });
      const redirectUrl: string | undefined = result?.data?.redirectUrl;
      if (redirectUrl?.startsWith('http')) {
        window.location.href = redirectUrl;
        return;
      }
      setJustCreatedOrg(workspaceName);
      setEmail(adminEmail);
      setWorkspaceName('');
      setAdminName('');
      setAdminEmail('');
      setAdminPassword('');
      setTosAccepted(false);
      setMode('login');
    } catch (err: any) {
      setRegisterError(err.message || 'Registration failed. Please try again.');
      setRegisterLoading(false);
    }
  };

  return (
    <Box
      minH="100vh"
      display="flex"
      alignItems="center"
      justifyContent="center"
      bg="bg.canvas"
      position="relative"
      overflow="hidden"
    >
      <Box position="absolute" top={4} right={4} zIndex={20}>
        <ColorModeSwitch />
      </Box>

      {/* ── Layered backdrop: photo → dither → paper/dark fade ── */}
      {/* Layer 0: hero photo, full-bleed (webp). Variant + responsive crop are chosen in CSS
          (.login-hero-bg, keyed off html.dark) so it's correct on the first paint with no
          colorMode-resolution flash. */}
      <Box
        className="login-hero-bg"
        position="absolute"
        inset={0}
        zIndex={0}
        pointerEvents="none"
        backgroundSize="cover"
        backgroundPosition="center"
      />
      {/* Layer 1: transparent dither dots — only the dots paint, photo shows through the gaps. */}
      <Box position="absolute" inset={0} zIndex={1} pointerEvents="none">
        <Dither
          waveColor={isDark ? [0.82, 0.84, 0.82] : [0.28, 0.31, 0.29]}
          colorNum={2}
          pixelSize={2}
          waveAmplitude={0.7}
          waveFrequency={2}
          waveSpeed={0.45}
          disableAnimation={false}
          enableMouseInteraction={false}
          opacity={isDark ? 0.25 : 0.3}
          transparent
        />
      </Box>
      {/* Layer 2: paper (light) / dark fade for card readability — lower opacity = more visible
          photo. Variant chosen in CSS (.login-hero-fade, keyed off html.dark) to match the photo. */}
      <Box
        className="login-hero-fade"
        position="absolute"
        inset={0}
        zIndex={2}
        pointerEvents="none"
      />

      {/* Warm "frosted paper" card. Color/border/shadow live in CSS (.login-card, keyed off
          html.dark) so the card stays in lockstep with the photo/fade and never mismatches
          on first paint. */}
      <Box
        className="login-card"
        w="full"
        maxW="400px"
        p={8}
        borderRadius="xl"
        position="relative"
        zIndex={10}
      >
        <VStack align="stretch" gap={6}>
          <Box display="flex" justifyContent="center" mb={2}>
            <Box aria-label="Workspace logo" role="img" width={12} height={12} flexShrink={0} />
          </Box>

          <Heading size="xl" textAlign="center" fontFamily="mono">
            {mode === 'register' ? 'Set Up Your Workspace' : `Welcome to ${displayName}`}
          </Heading>

          {landingHtml && mode === 'login' && (
            <Box>
              <Box
                fontSize="sm"
                color="fg.muted"
                mb={enableOrgCreation ? 4 : 0}
                dangerouslySetInnerHTML={{ __html: landingHtml }}
              />
              {enableOrgCreation && (
                <Button
                  w="full"
                  variant="outline"
                  size="lg"
                  onClick={() => setMode('register')}
                >
                  <LuBuilding2 />
                  Set up workspace
                </Button>
              )}
            </Box>
          )}

          {!landingHtml && mode === 'login' && loginText && (
            <Box fontSize="sm" color="fg.muted">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{loginText}</ReactMarkdown>
            </Box>
          )}

          {mode === 'register' && registerText && (
            <Box fontSize="sm" color="fg.muted">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{registerText}</ReactMarkdown>
            </Box>
          )}

          {justCreatedOrg && (
            <Box p={3} bg="accent.success/10" borderRadius="md" border="1px solid" borderColor="accent.success">
              <Text fontSize="sm" color="accent.success">
                Workspace &quot;{justCreatedOrg}&quot; created successfully! You can now sign in.
              </Text>
            </Box>
          )}

          {mode === 'register' ? (
            <VStack align="stretch" gap={4}>
              {registerError && (
                <Box p={3} bg="accent.danger/10" borderRadius="md" border="1px solid" borderColor="accent.danger">
                  <Text fontSize="sm" color="accent.danger">{registerError}</Text>
                </Box>
              )}
              <form onSubmit={handleRegister}>
                <VStack gap={4}>
                  <Box w="full">
                    <Input
                      type="text"
                      placeholder="Workspace Name"
                      value={workspaceName}
                      onChange={(e) => { const v = e.target.value; setWorkspaceName(v); if (workspaceNameError) { const r = validateWorkspaceName(v); setWorkspaceNameError(r.valid ? null : r.error!); } }}
                      onBlur={() => { const r = validateWorkspaceName(workspaceName); setWorkspaceNameError(r.valid ? null : r.error!); }}
                      required
                      autoFocus
                      size="lg"
                      borderColor={workspaceNameError ? 'accent.danger' : undefined}
                    />
                    {workspaceNameError
                      ? <Text fontSize="xs" color="accent.danger" mt={1}>{workspaceNameError}</Text>
                      : <Text fontSize="xs" color="fg.muted" mt={1}>Letters, numbers, hyphens, and underscores — no spaces.</Text>}
                  </Box>
                  <Box w="full">
                    <Input
                      type="text"
                      placeholder="Your Name"
                      value={adminName}
                      onChange={(e) => { const v = e.target.value; setAdminName(v); if (adminNameError) { const r = validateFullName(v); setAdminNameError(r.valid ? null : r.error!); } }}
                      onBlur={() => { const r = validateFullName(adminName); setAdminNameError(r.valid ? null : r.error!); }}
                      required
                      size="lg"
                      borderColor={adminNameError ? 'accent.danger' : undefined}
                    />
                    {adminNameError && <Text fontSize="xs" color="accent.danger" mt={1}>{adminNameError}</Text>}
                  </Box>
                  <Box w="full">
                    <Input
                      type="email"
                      placeholder="Email"
                      value={adminEmail}
                      onChange={(e) => { const v = e.target.value; setAdminEmail(v); if (adminEmailError) { const r = validateEmail(v); setAdminEmailError(r.valid ? null : r.error!); } }}
                      onBlur={() => { const r = validateEmail(adminEmail); setAdminEmailError(r.valid ? null : r.error!); }}
                      required
                      size="lg"
                      borderColor={adminEmailError ? 'accent.danger' : undefined}
                    />
                    {adminEmailError && <Text fontSize="xs" color="accent.danger" mt={1}>{adminEmailError}</Text>}
                  </Box>
                  <Box w="full">
                    <Input
                      type="password"
                      placeholder="Password"
                      value={adminPassword}
                      onChange={(e) => { const v = e.target.value; setAdminPassword(v); if (adminPasswordError) { const r = validatePassword(v); setAdminPasswordError(r.valid ? null : r.error!); } }}
                      onBlur={() => { const r = validatePassword(adminPassword); setAdminPasswordError(r.valid ? null : r.error!); }}
                      required
                      size="lg"
                      borderColor={adminPasswordError ? 'accent.danger' : undefined}
                    />
                    {adminPasswordError && <Text fontSize="xs" color="accent.danger" mt={1}>{adminPasswordError}</Text>}
                  </Box>
                  <Box>
                    <HStack gap={2} alignItems="center">
                      <Checkbox
                        checked={tosAccepted}
                        onCheckedChange={(e) => { setTosAccepted(!!e.checked); setTosError(null); }}
                      />
                      <Text fontSize="sm" color="fg.muted">
                        I agree to the{' '}
                        <a href={config.links.termsUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--chakra-colors-accent-teal)', textDecoration: 'underline' }}>
                          Terms of Service
                        </a>
                      </Text>
                    </HStack>
                    {tosError && <Text fontSize="xs" color="accent.danger" mt={1}>{tosError}</Text>}
                  </Box>
                  <Button
                    type="submit"
                    w="full"
                    bg="accent.teal"
                    color="white"
                    size="lg"
                    loading={registerLoading}
                    disabled={registerLoading}
                    _hover={{ bg: 'accent.teal', opacity: 0.9 }}
                  >
                    <LuBuilding2 />
                    Create Workspace
                  </Button>
                </VStack>
              </form>
              <Text fontSize="sm" textAlign="center" color="fg.muted">
                Already have an account?{' '}
                <Box
                  as="span"
                  color="accent.teal"
                  cursor="pointer"
                  _hover={{ textDecoration: 'underline' }}
                  onClick={() => setMode('login')}
                >
                  Sign In
                </Box>
              </Text>
            </VStack>
          ) : !landingHtml ? (
            <VStack gap={4}>
              {loginError && (
                <Box p={3} bg="accent.danger/10" borderRadius="md" border="1px solid" borderColor="accent.danger">
                  <Text fontSize="sm" color="accent.danger">{loginError}</Text>
                </Box>
              )}

              {hasEmailOTP && (
                <Box w="full" display="grid" gridTemplateColumns="1fr 1fr" bg="bg.muted" borderRadius="md" p={1} gap={1}>
                  <Button
                    type="button" size="sm" variant="ghost" borderRadius="sm"
                    bg={loginMethod === 'password' ? 'bg.surface' : 'transparent'}
                    color={loginMethod === 'password' ? 'fg.default' : 'fg.muted'}
                    fontWeight={loginMethod === 'password' ? 600 : 400}
                    onClick={() => { setLoginMethod('password'); setShowOTPInput(false); setOtp(''); setOtpToken(null); setLoginError(null); }}
                  >Password</Button>
                  <Button
                    type="button" size="sm" variant="ghost" borderRadius="sm"
                    bg={loginMethod === 'emailOtp' ? 'bg.surface' : 'transparent'}
                    color={loginMethod === 'emailOtp' ? 'fg.default' : 'fg.muted'}
                    fontWeight={loginMethod === 'emailOtp' ? 600 : 400}
                    onClick={() => { setLoginMethod('emailOtp'); setShowOTPInput(false); setOtp(''); setOtpToken(null); setLoginError(null); }}
                  >Email Code</Button>
                </Box>
              )}

              {loginMethod === 'emailOtp' ? (
                <VStack gap={4} w="full">
                  <Input type="email" fontFamily="mono" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus size="lg" disabled={showOTPInput} />
                  {!showOTPInput ? (
                    <Button onClick={handleSendEmailOTP} w="full" bg="accent.teal" color="white" size="lg" loading={otpLoading} disabled={otpLoading} _hover={{ bg: 'accent.teal', opacity: 0.9 }}>
                      <LuLogIn />
                      Send Login Code
                    </Button>
                  ) : (
                    <VStack gap={4} w="full">
                      <Text fontSize="sm" color="fg.muted" textAlign="center">
                        We&apos;ve sent a login code to <strong>{email}</strong>. Enter it below.
                      </Text>
                      <OTPInput value={otp} onChange={setOtp} onComplete={handleVerifyEmailOTP} disabled={otpLoading} />
                      <Button onClick={handleVerifyEmailOTP} w="full" bg="accent.teal" color="white" size="lg" loading={otpLoading} disabled={otpLoading || otp.length !== 6} _hover={{ bg: 'accent.teal', opacity: 0.9 }}>
                        Verify Code
                      </Button>
                      <Button onClick={handleSendEmailOTP} variant="ghost" size="sm" disabled={resendCooldown > 0 || otpLoading}>
                        {resendCooldown > 0 ? `Resend code (${resendCooldown}s)` : 'Resend code'}
                      </Button>
                    </VStack>
                  )}
                </VStack>
              ) : (
                <form onSubmit={handleLogin} style={{ width: '100%' }}>
                  <VStack gap={4}>
                    {/* Focus the password when the email is already filled (e.g. right after creating a
                        workspace, where we land on login with the email prefilled). Autofocusing the
                        email there re-grabbed focus and dropped the user's first password keystrokes. */}
                    <Input type="email" fontFamily="mono" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus={!email} size="lg" />
                    <Input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus={!!email} size="lg" disabled={showOTPInput} />

                    {showOTPInput && (
                      <VStack gap={4} w="full" mt={4}>
                        <Text fontSize="sm" color="fg.muted" textAlign="center">
                          We&apos;ve sent a verification code to your phone. Please enter it below.
                        </Text>
                        <OTPInput value={otp} onChange={setOtp} onComplete={handleVerifyOTP} disabled={otpLoading} />
                        <Button onClick={handleVerifyOTP} w="full" bg="accent.teal" color="white" size="lg" loading={otpLoading} disabled={otpLoading || otp.length !== 6} _hover={{ bg: 'accent.teal', opacity: 0.9 }}>
                          Verify OTP
                        </Button>
                        <Button onClick={() => handleSendOTP()} variant="ghost" size="sm" disabled={resendCooldown > 0 || otpLoading}>
                          {resendCooldown > 0 ? `Resend OTP (${resendCooldown}s)` : 'Resend OTP'}
                        </Button>
                      </VStack>
                    )}

                    {!showOTPInput && (
                      <Button type="submit" w="full" bg="accent.teal" color="white" size="lg" loading={loginLoading} disabled={loginLoading} _hover={{ bg: 'accent.teal', opacity: 0.9 }}>
                        <LuLogIn />
                        Sign In
                      </Button>
                    )}
                  </VStack>
                </form>
              )}
            </VStack>
          ) : null}
        </VStack>
      </Box>
    </Box>
  );
}
