'use client';

import { useState, FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Box, VStack, Input, Button, Heading, Text } from '@chakra-ui/react';
import { LuLogIn, LuBuilding2 } from 'react-icons/lu';
import { useAppSelector } from '@/store/hooks';
import { Dither } from '@/components/Dither';
import { ColorModeButton } from '@/components/ui/color-mode';
import { useConfigs } from '@/lib/hooks/useConfigs';
import {
  validateCompanyName,
  validateEmail,
  validatePassword,
  validateFullName,
} from '@/lib/validation/validators';
import { CompanyConfig } from '@/lib/branding/whitelabel';
import { OTPInput } from '@/components/auth/OTPInput';
import { fetchWithCache } from '@/lib/api/fetch-wrapper';
import { API } from '@/lib/api/declarations';

interface LoginOrRegisterFormProps {
  hasCompanies: boolean;
  allowMultipleCompanies: boolean;
  defaultCompanyName: string | null;
  subdomain?: string | null;
  subdomainCompanyName?: string | null;
  companyConfig?: CompanyConfig | null;
  showMarketingPage?: boolean;
  inviteCode?: string | null;
}

export function LoginOrRegisterForm({
  hasCompanies,
  allowMultipleCompanies,
  defaultCompanyName,
  subdomain,
  subdomainCompanyName,
  companyConfig,
  showMarketingPage = false,
  inviteCode = null
}: LoginOrRegisterFormProps) {
  const searchParams = useSearchParams();
  const colorMode = useAppSelector((state) => state.ui.colorMode);

  // Get company-specific config from props (SSR) or Redux fallback
  const { config: reduxConfig } = useConfigs();
  const config = companyConfig || reduxConfig;
  const companyDisplayName = config.branding.agentName;

  // Check if company field should be hidden (single-tenant mode OR any subdomain)
  const isSingleTenant = !!defaultCompanyName;
  const isSubdomainMode = !!subdomain;  // True for ANY subdomain (prevents enumeration)

  // Toggle between login and registration mode
  const [showRegistration, setShowRegistration] = useState(!hasCompanies);

  // Track if user wants to bypass marketing page (when they click "Create Organisation")
  const [bypassMarketing, setBypassMarketing] = useState(false);

  // Login form state - pre-fill company if subdomain is present
  const [company, setCompany] = useState(subdomainCompanyName || '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // 2FA state
  const [showOTPInput, setShowOTPInput] = useState(false);
  const [otpToken, setOtpToken] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [savedCompanyId, setSavedCompanyId] = useState<number | null>(null);

  // Registration form state
  const [companyName, setCompanyName] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');

  // Error states
  const [error, setError] = useState<string | null>(null);
  const [companyNameError, setCompanyNameError] = useState<string | null>(null);
  const [adminNameError, setAdminNameError] = useState<string | null>(null);
  const [adminEmailError, setAdminEmailError] = useState<string | null>(null);
  const [adminPasswordError, setAdminPasswordError] = useState<string | null>(null);

  // Loading state
  const [loading, setLoading] = useState(false);

  // Check if redirected after organisation creation
  const wasCreated = searchParams.get('created') === 'true';
  const createdCompany = searchParams.get('company');

  // Check if redirected from invalid subdomain
  const invalidSubdomain = searchParams.get('error') === 'invalid_subdomain';

  // Login form handler
  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // Validate subdomain mode: must have valid company lookup
      if (subdomain && !subdomainCompanyName) {
        setError(`Company not found for subdomain "${subdomain}". Please contact your administrator.`);
        setLoading(false);
        return;
      }

      // Use subdomain company if present, otherwise use form input
      const companyToUse = isSubdomainMode ? subdomainCompanyName! : company;

      // Check if 2FA is required
      let check2FAData;
      try {
        check2FAData = await fetchWithCache('/api/auth/check-2fa', {
          method: 'POST',
          body: JSON.stringify({
            email,
            password,
            company: companyToUse,
          }),
          cacheStrategy: API.auth.check2FA.cache,
        });
      } catch (error) {
        setError('Invalid company, email, or password');
        setLoading(false);
        return;
      }

      if (check2FAData.data.requires2FA) {
        // Show OTP input UI
        setSavedCompanyId(check2FAData.data.companyId);
        setLoading(false);
        setShowOTPInput(true);
        // Send OTP
        await handleSendOTP(check2FAData.data.companyId);
        return;
      }

      // No 2FA required, proceed with normal sign-in
      const result = await signIn('credentials', {
        company: companyToUse,
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError('Invalid company, email, or password');
        setLoading(false);
        return;
      }

      // Force full page reload to trigger layout.tsx and load initial state
      const callbackUrl = searchParams.get('callbackUrl') || '/';
      window.location.href = callbackUrl;
    } catch (err) {
      console.error('Login error:', err);
      setError('An unexpected error occurred');
      setLoading(false);
    }
  };

  // Send OTP handler
  const handleSendOTP = async (companyId?: number) => {
    setError(null);
    setOtpLoading(true);

    try {
      const data = await fetchWithCache('/api/auth/send-otp', {
        method: 'POST',
        body: JSON.stringify({
          email,
          companyId: companyId || savedCompanyId,
        }),
        cacheStrategy: API.auth.sendOTP.cache,
      });
      setOtpToken(data.data.token);
      setResendCooldown(30);

      // Start cooldown timer
      const interval = setInterval(() => {
        setResendCooldown((prev) => {
          if (prev <= 1) {
            clearInterval(interval);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      setOtpLoading(false);
    } catch (err) {
      console.error('Send OTP error:', err);
      setError('Failed to send OTP');
      setOtpLoading(false);
    }
  };

  // Verify OTP and complete sign-in
  const handleVerifyOTP = async () => {
    if (!otpToken || otp.length !== 6) {
      return;
    }

    setError(null);
    setOtpLoading(true);

    try {
      // Verify OTP
      try {
        await fetchWithCache('/api/auth/verify-otp', {
          method: 'POST',
          body: JSON.stringify({ token: otpToken, otp }),
          cacheStrategy: API.auth.verifyOTP.cache,
        });
      } catch (error) {
        setError('Invalid OTP. Please try again.');
        setOtpLoading(false);
        return;
      }

      // OTP verified, now sign in
      const companyToUse = isSubdomainMode ? subdomainCompanyName! : company;
      const result = await signIn('credentials', {
        company: companyToUse,
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError('Sign-in failed after OTP verification');
        setOtpLoading(false);
        return;
      }

      // Success - redirect
      const callbackUrl = searchParams.get('callbackUrl') || '/';
      window.location.href = callbackUrl;
    } catch (err) {
      console.error('Verify OTP error:', err);
      setError('Failed to verify OTP');
      setOtpLoading(false);
    }
  };

  // Registration form validation handlers
  const handleCompanyNameBlur = () => {
    const result = validateCompanyName(companyName);
    setCompanyNameError(result.valid ? null : result.error!);
  };

  const handleAdminNameBlur = () => {
    const result = validateFullName(adminName);
    setAdminNameError(result.valid ? null : result.error!);
  };

  const handleAdminEmailBlur = () => {
    const result = validateEmail(adminEmail);
    setAdminEmailError(result.valid ? null : result.error!);
  };

  const handleAdminPasswordBlur = () => {
    const result = validatePassword(adminPassword);
    setAdminPasswordError(result.valid ? null : result.error!);
  };

  // Registration form handler
  const handleRegister = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate all fields before submission
    const companyNameValidation = validateCompanyName(companyName);
    const adminNameValidation = validateFullName(adminName);
    const emailValidation = validateEmail(adminEmail);
    const passwordValidation = validatePassword(adminPassword);

    setCompanyNameError(companyNameValidation.valid ? null : companyNameValidation.error!);
    setAdminNameError(adminNameValidation.valid ? null : adminNameValidation.error!);
    setAdminEmailError(emailValidation.valid ? null : emailValidation.error!);
    setAdminPasswordError(passwordValidation.valid ? null : passwordValidation.error!);

    // Stop if any validation fails
    if (
      !companyNameValidation.valid ||
      !adminNameValidation.valid ||
      !emailValidation.valid ||
      !passwordValidation.valid
    ) {
      return;
    }

    setLoading(true);

    try {
      let registrationResponse: any;
      try {
        registrationResponse = await fetchWithCache('/api/companies/register', {
          method: 'POST',
          body: JSON.stringify({
            companyName,
            adminName,
            adminEmail,
            adminPassword,
            inviteCode: inviteCode || undefined,
          }),
          cacheStrategy: API.companies.register.cache,
        });
      } catch (error: any) {
        // Handle API error
        if (error.message) {
          setError(error.message);
        } else {
          setError('Failed to create organisation. Please try again.');
        }
        setLoading(false);
        return;
      }

      // Extract subdomain from response (wrapped in { success: true, data: {...} })
      const createdSubdomain = registrationResponse?.data?.subdomain;

      if (!createdSubdomain) {
        console.error('[Registration] No subdomain in response:', registrationResponse);
        setError('Organisation created but subdomain is missing. Please contact support.');
        setLoading(false);
        return;
      }

      // Construct subdomain URL
      const currentUrl = new URL(window.location.href);
      const protocol = currentUrl.protocol; // http: or https:
      let subdomainHost: string;

      if (currentUrl.hostname === 'localhost') {
        // Local development: subdomain.localhost:3000
        subdomainHost = `${createdSubdomain}.localhost:${currentUrl.port}`;
      } else {
        // Production: subdomain.example.com
        const hostParts = currentUrl.hostname.split('.');
        if (hostParts.length >= 2) {
          // Get root domain (last 2 parts: example.com)
          const rootDomain = hostParts.slice(-2).join('.');
          subdomainHost = `${createdSubdomain}.${rootDomain}`;
        } else {
          // Fallback: just prepend subdomain
          subdomainHost = `${createdSubdomain}.${currentUrl.hostname}`;
        }
      }

      const createdCompanyName = registrationResponse?.data?.companyName || companyName;
      const subdomainUrl = `${protocol}//${subdomainHost}/login?created=true&company=${encodeURIComponent(createdCompanyName)}`;

      // Redirect to subdomain login page
      console.log('[Registration] Redirecting to subdomain:', subdomainUrl);
      window.location.href = subdomainUrl;
    } catch (err) {
      console.error('Registration error:', err);
      setError('An unexpected error occurred. Please try again.');
      setLoading(false);
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
      {/* Color mode toggle button */}
      <Box
        position="absolute"
        top={4}
        right={4}
        zIndex={10}
      >
        <ColorModeButton />
      </Box>

      {/* Dither background effect */}
      <Box
        position="absolute"
        top={0}
        left={0}
        right={0}
        bottom={0}
        zIndex={0}
        pointerEvents="none"
      >
        <Dither
          waveSpeed={0.03}
          waveFrequency={5}
          waveAmplitude={0.25}
          waveColor={colorMode === 'dark' ? [1, 1, 1] : [0.7, 0.7, 0.7]}
          colorNum={2}
          pixelSize={2}
          disableAnimation={false}
          enableMouseInteraction={false}
          mouseRadius={0.5}
          opacity={colorMode === 'dark' ? 0.2 : 0.5}
        />
      </Box>

      {/* Login or Registration card */}
      <Box
        w="full"
        maxW="400px"
        p={8}
        bg="bg.surface"
        borderRadius="lg"
        border="1px solid"
        borderColor="border.default"
        position="relative"
        zIndex={1}
        boxShadow="0 20px 60px rgba(0, 0, 0, 0.3)"
      >
        <VStack align="stretch" gap={6}>
          {showMarketingPage && !bypassMarketing ? (
            // MARKETING PAGE - Show info about MinusX and "Book a demo" CTA
            <>
              {/* Logo */}
              <Box display="flex" justifyContent="center" mb={2}>
                <Box
                  aria-label="Company logo"
                  role="img"
                  width={12}
                  height={12}
                  flexShrink={0}
                />
              </Box>

              <Heading size="xl" textAlign="center" fontFamily="mono">
                Welcome to MinusX
              </Heading>

              <Box
                p={4}
                bg="accent.teal/10"
                borderRadius="md"
                border="1px solid"
                borderColor="accent.teal"
              >
                <Text fontSize="sm" color="fg.default" textAlign="center">
                  MinusX is an Agentic Business Intelligence platform built from the ground up for native AI interop. It is the Claude Code / Codex for data.
                </Text>
              </Box>

              <VStack gap={3}>
                <Text fontSize="sm" color="fg.muted" textAlign="center">
                  Get started with your own organization by booking a demo with our team.
                </Text>

                <Button
                  onClick={() => window.open('http://minusx.ai/demo', '_blank', 'noopener,noreferrer')}
                  w="full"
                  bg="accent.teal"
                  color="white"
                  size="lg"
                  _hover={{ bg: 'accent.teal', opacity: 0.9 }}
                >
                  <LuBuilding2 />
                  Book a Demo
                </Button>

                {/* Show "Create Organisation" link if invite code is present */}
                {inviteCode && (
                  <Text fontSize="sm" textAlign="center" color="fg.muted">
                    Have an invite code?{' '}
                    <Box
                      as="span"
                      color="accent.teal"
                      _hover={{ textDecoration: 'underline' }}
                      cursor="pointer"
                      onClick={() => {
                        setBypassMarketing(true);
                        setShowRegistration(true);
                      }}
                    >
                      Create Organisation
                    </Box>
                  </Text>
                )}

                <Text fontSize="xs" color="fg.muted" textAlign="center" mt={2}>
                  Already have an account? Access your organization via its subdomain.
                </Text>
              </VStack>
            </>
          ) : (
            // EXISTING LOGIN/REGISTRATION FORM
            <>
              {/* Logo */}
              <Box display="flex" justifyContent="center" mb={2}>
                <Box
                  aria-label="Company logo"
                  role="img"
                  width={12}
                  height={12}
                  flexShrink={0}
                />
              </Box>

              <Heading size="xl" textAlign="center" fontFamily="mono">
                {showRegistration ? (hasCompanies ? 'Create Organisation' : 'Welcome to MinusX!') : `${companyDisplayName} Login`}
              </Heading>

          {/* Welcome message for first company */}
          {showRegistration && !hasCompanies && (
            <Box
              p={3}
              bg="accent.teal/10"
              borderRadius="md"
              border="1px solid"
              borderColor="accent.teal"
            >
              <Text fontSize="sm" color="accent.teal" textAlign="center">
                Let's set up your organisation
              </Text>
            </Box>
          )}

          {/* Success message for organisation creation */}
          {wasCreated && createdCompany && (
            <Box
              p={3}
              bg="accent.success/10"
              borderRadius="md"
              border="1px solid"
              borderColor="accent.success"
            >
              <Text fontSize="sm" color="accent.success">
                Organisation "{createdCompany}" created successfully! You can now sign in.
              </Text>
            </Box>
          )}

          {/* Warning message for invalid subdomain redirect */}
          {invalidSubdomain && (
            <Box
              p={3}
              bg="accent.warning/10"
              borderRadius="md"
              border="1px solid"
              borderColor="accent.warning"
            >
              <Text fontSize="sm" color="accent.warning" fontWeight="600" mb={1}>
                Invalid Subdomain
              </Text>
              <Text fontSize="sm" color="accent.warning">
                The subdomain you tried to access doesn't exist. Please enter your company name below to continue.
              </Text>
            </Box>
          )}

          {/* Error message (form submission errors) */}
          {error && (
            <Box
              p={3}
              bg="accent.danger/10"
              borderRadius="md"
              border="1px solid"
              borderColor="accent.danger"
            >
              <Text fontSize="sm" color="accent.danger">
                {error}
              </Text>
            </Box>
          )}

          {/* Conditional form rendering */}
          {!showRegistration ? (
            // LOGIN FORM
            <form onSubmit={handleLogin}>
              <VStack gap={4}>
                {/* Show subdomain banner if present (same for valid/invalid to prevent enumeration) */}
                {isSubdomainMode && (
                  <Box
                    w="full"
                    p={3}
                    bg="accent.teal/10"
                    borderRadius="md"
                    border="1px solid"
                    borderColor="accent.teal"
                  >
                    <Text fontSize="sm" color="accent.teal" fontFamily="mono">
                      Logging in to: <strong>{subdomain}</strong>
                    </Text>
                  </Box>
                )}

                {/* Only show company field if not single-tenant AND not subdomain mode */}
                {!isSingleTenant && !isSubdomainMode && (
                  <Input
                    type="text"
                    fontFamily="mono"
                    placeholder="Company"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    required
                    autoFocus
                    size="lg"
                  />
                )}
                <Input
                  type="email"
                  fontFamily="mono"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus={isSingleTenant || isSubdomainMode}
                  size="lg"
                />
                <Input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  size="lg"
                  disabled={showOTPInput}
                />

                {/* 2FA OTP Input */}
                {showOTPInput && (
                  <VStack gap={4} w="full" mt={4}>
                    <Text fontSize="sm" color="fg.muted" textAlign="center">
                      We've sent a verification code to your phone. Please enter it below.
                    </Text>
                    <OTPInput
                      value={otp}
                      onChange={setOtp}
                      onComplete={handleVerifyOTP}
                      disabled={otpLoading}
                    />
                    <Button
                      onClick={handleVerifyOTP}
                      w="full"
                      bg="accent.teal"
                      color="white"
                      size="lg"
                      loading={otpLoading}
                      disabled={otpLoading || otp.length !== 6}
                      _hover={{ bg: 'accent.teal', opacity: 0.9 }}
                    >
                      Verify OTP
                    </Button>
                    <Button
                      onClick={() => handleSendOTP()}
                      variant="ghost"
                      size="sm"
                      disabled={resendCooldown > 0 || otpLoading}
                    >
                      {resendCooldown > 0
                        ? `Resend OTP (${resendCooldown}s)`
                        : 'Resend OTP'}
                    </Button>
                  </VStack>
                )}

                {/* Sign In Button (only show if not in OTP mode) */}
                {!showOTPInput && (
                  <Button
                    type="submit"
                    w="full"
                    bg="accent.teal"
                    color="white"
                    size="lg"
                    loading={loading}
                    disabled={loading}
                    _hover={{ bg: 'accent.teal', opacity: 0.9 }}
                  >
                    <LuLogIn />
                    Sign In
                  </Button>
                )}
              </VStack>
            </form>
          ) : (
            // REGISTRATION FORM
            <form onSubmit={handleRegister}>
              <VStack gap={4}>
                {/* Company Name */}
                <Box w="full">
                  <Input
                    type="text"
                    placeholder="Company Name"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    onBlur={handleCompanyNameBlur}
                    required
                    autoFocus
                    size="lg"
                    borderColor={companyNameError ? 'accent.danger' : undefined}
                  />
                  {companyNameError && (
                    <Text fontSize="xs" color="accent.danger" mt={1}>
                      {companyNameError}
                    </Text>
                  )}
                </Box>

                {/* Admin Full Name */}
                <Box w="full">
                  <Input
                    type="text"
                    placeholder="Admin Name"
                    value={adminName}
                    onChange={(e) => setAdminName(e.target.value)}
                    onBlur={handleAdminNameBlur}
                    required
                    size="lg"
                    borderColor={adminNameError ? 'accent.danger' : undefined}
                  />
                  {adminNameError && (
                    <Text fontSize="xs" color="accent.danger" mt={1}>
                      {adminNameError}
                    </Text>
                  )}
                </Box>

                {/* Admin Email */}
                <Box w="full">
                  <Input
                    type="email"
                    placeholder="Admin Email"
                    value={adminEmail}
                    onChange={(e) => setAdminEmail(e.target.value)}
                    onBlur={handleAdminEmailBlur}
                    required
                    size="lg"
                    borderColor={adminEmailError ? 'accent.danger' : undefined}
                  />
                  {adminEmailError && (
                    <Text fontSize="xs" color="accent.danger" mt={1}>
                      {adminEmailError}
                    </Text>
                  )}
                </Box>

                {/* Admin Password */}
                <Box w="full">
                  <Input
                    type="password"
                    placeholder="Admin Password"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    onBlur={handleAdminPasswordBlur}
                    required
                    size="lg"
                    borderColor={adminPasswordError ? 'accent.danger' : undefined}
                  />
                  {adminPasswordError && (
                    <Text fontSize="xs" color="accent.danger" mt={1}>
                      {adminPasswordError}
                    </Text>
                  )}
                </Box>

                <Button
                  type="submit"
                  w="full"
                  bg="accent.teal"
                  color="white"
                  size="lg"
                  loading={loading}
                  disabled={loading}
                  _hover={{ bg: 'accent.teal', opacity: 0.9 }}
                >
                  <LuBuilding2 />
                  Create Organisation
                </Button>
              </VStack>
            </form>
          )}

          {/* Toggle between login and registration */}
          {/* Show "Sign In" link when in registration mode AND companies exist */}
          {showRegistration && hasCompanies && (
            <Text fontSize="sm" textAlign="center" color="fg.muted">
              Already have an account?{' '}
              <Box
                as="span"
                color="accent.teal"
                _hover={{ textDecoration: 'underline' }}
                cursor="pointer"
                onClick={() => setShowRegistration(false)}
              >
                Sign In
              </Box>
            </Text>
          )}
          {/* Show "Create Organisation" link when in login mode AND multiple companies allowed AND not on subdomain */}
          {!showRegistration && allowMultipleCompanies && !subdomain && (
            <Text fontSize="sm" textAlign="center" color="fg.muted">
              Don't have an account?{' '}
              <Box
                as="span"
                color="accent.teal"
                _hover={{ textDecoration: 'underline' }}
                cursor="pointer"
                onClick={() => setShowRegistration(true)}
              >
                Create Organisation
              </Box>
            </Text>
          )}
            </>
          )}
        </VStack>
      </Box>
    </Box>
  );
}
