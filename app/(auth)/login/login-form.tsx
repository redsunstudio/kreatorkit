'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { signIn } from 'next-auth/react';

function getSafeCallbackUrl(value: string | null): string {
  if (!value) return '/workspaces';
  try {
    const baseOrigin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
    const parsed = new URL(value, baseOrigin);
    if (parsed.origin !== baseOrigin) return '/workspaces';
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return '/workspaces';
  }
}

const ERROR_MESSAGES: Record<string, string> = {
  RegistrationClosed: 'Sign-up is currently invite-only. Contact an administrator.',
  OAuthAccountNotLinked: 'Sign-in failed. Please try a different method or contact support.',
  OAuthCallbackError: 'OAuth sign-in failed. Please try again.',
  OAuthEmailNotVerified:
    'Your OAuth account email is not verified. Please verify it with your provider and try again.',
  InvalidVerificationToken: 'The verification link is invalid or has expired.',
  VerificationFailed: 'Email verification failed. Please try again.',
  Default: 'Something went wrong. Please try again.',
};

interface LoginFormInnerProps {
  googleEnabled: boolean;
  githubEnabled: boolean;
  inviteEmail?: string | null;
  inviteTarget?: string | null;
}

function LoginFormInner({
  googleEnabled,
  githubEnabled,
  inviteEmail,
  inviteTarget,
}: LoginFormInnerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isLoading, setIsLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [email, setEmail] = useState(inviteEmail ?? '');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [password, setPassword] = useState('');
  const [usePassword, setUsePassword] = useState(false);
  const codeInput = useRef<HTMLInputElement>(null);
  const callbackUrl = getSafeCallbackUrl(searchParams.get('callbackUrl'));

  useEffect(() => {
    const errorCode = searchParams.get('error');
    if (errorCode) {
      setError(ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.Default);
    }
  }, [searchParams]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function sendCode() {
    if (!email.trim()) return;
    setIsLoading(true);
    setError('');
    try {
      await fetch('/api/auth/otp/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      setCodeSent(true);
      setResendIn(30);
      setTimeout(() => codeInput.current?.focus(), 50);
    } catch {
      setError('Could not send the code — try again.');
    } finally {
      setIsLoading(false);
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    try {
      const result = await signIn('otp', {
        email: email.trim(),
        code: code.trim(),
        redirect: false,
        callbackUrl,
      });
      if (result?.error) {
        setError('That code did not work — check it or request a new one.');
        return;
      }
      router.push(getSafeCallbackUrl(result?.url || callbackUrl));
      router.refresh();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    try {
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
        callbackUrl,
      });
      if (result?.error) {
        setError('Invalid email or password');
        return;
      }
      router.push(getSafeCallbackUrl(result?.url || callbackUrl));
      router.refresh();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOAuthLogin = async (provider: string) => {
    setOauthLoading(provider);
    setError('');
    await signIn(provider, { callbackUrl });
  };

  const hasOAuth = googleEnabled || githubEnabled;
  const anyLoading = isLoading || oauthLoading !== null;

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle>{inviteTarget ? `You've been invited 🎉` : 'Welcome back'}</CardTitle>
        <CardDescription>
          {inviteTarget
            ? `Sign in to join ${inviteTarget} — we'll email you a code, no password needed.`
            : "Enter your email and we'll send you a sign-in code."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm mb-4">
            {error}
          </div>
        )}

        {!usePassword ? (
          <form onSubmit={codeSent ? submitCode : (e) => (e.preventDefault(), void sendCode())} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError('');
                  setCodeSent(false);
                  setCode('');
                }}
                required
                disabled={anyLoading}
              />
            </div>

            {codeSent && (
              <div className="space-y-2">
                <Label htmlFor="code">Sign-in code</Label>
                <Input
                  id="code"
                  ref={codeInput}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  placeholder="123456"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value.replace(/\D/g, ''));
                    setError('');
                  }}
                  className="text-center text-xl tracking-[0.5em] font-mono"
                  required
                  disabled={anyLoading}
                />
                <p className="text-xs text-muted-foreground">
                  Check {email.trim()} — the code lasts 10 minutes.{' '}
                  <button
                    type="button"
                    className="underline disabled:opacity-50"
                    disabled={anyLoading || resendIn > 0}
                    onClick={() => void sendCode()}
                  >
                    {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend'}
                  </button>
                </p>
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={anyLoading || (codeSent && code.length !== 6)}
            >
              {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {codeSent ? 'Sign in' : 'Email me a code'}
            </Button>
          </form>
        ) : (
          <form onSubmit={handlePasswordLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError('');
                }}
                required
                disabled={anyLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError('');
                }}
                required
                disabled={anyLoading}
              />
            </div>
            <Button type="submit" className="w-full" disabled={anyLoading}>
              {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Sign in
            </Button>
          </form>
        )}

        <p className="text-center text-sm text-muted-foreground mt-4">
          <button
            type="button"
            className="underline hover:text-foreground"
            onClick={() => {
              setUsePassword((v) => !v);
              setError('');
            }}
          >
            {usePassword ? 'Email me a code instead' : 'Use a password instead'}
          </button>
        </p>

        {/* OAuth Buttons */}
        {hasOAuth && (
          <>
            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">or</span>
              </div>
            </div>
            <div className="space-y-2">
              {googleEnabled && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={anyLoading}
                  onClick={() => handleOAuthLogin('google')}
                >
                  {oauthLoading === 'google' ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : null}
                  Continue with Google
                </Button>
              )}
              {githubEnabled && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={anyLoading}
                  onClick={() => handleOAuthLogin('github')}
                >
                  {oauthLoading === 'github' ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : null}
                  Continue with GitHub
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function LoginFormSkeleton() {
  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle>Welcome back</CardTitle>
        <CardDescription>Enter your email and we&apos;ll send you a sign-in code.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="h-10 bg-muted animate-pulse rounded-md" />
        <div className="h-10 bg-muted animate-pulse rounded-md" />
        <div className="h-10 bg-primary/20 animate-pulse rounded-md" />
      </CardContent>
    </Card>
  );
}

export function LoginForm(props: LoginFormInnerProps) {
  return (
    <Suspense fallback={<LoginFormSkeleton />}>
      <LoginFormInner {...props} />
    </Suspense>
  );
}
