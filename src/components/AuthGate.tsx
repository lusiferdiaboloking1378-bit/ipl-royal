import React, { useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  KeyRound,
  Link2,
  Mail,
  ShieldCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  loginWithEmail,
  loginWithGoogle,
  registerWithEmail,
  resetPasswordByEmail,
} from '../firebase';

interface AuthGateProps {
  inviteRoomCode?: string;
}

function mapFirebaseAuthError(err: unknown): { message: string; needsEmailProviderSetup: boolean } {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: string }).code)
      : '';
  const msg = err instanceof Error ? err.message : String(err);

  if (code === 'auth/operation-not-allowed' || msg.includes('operation-not-allowed')) {
    return {
      message:
        'Email/Password sign-in is not yet enabled in your Firebase project. Enable it in Firebase Console (Authentication -> Sign-in method -> Email/Password), or sign in right away using Google Mail below.',
      needsEmailProviderSetup: true,
    };
  }
  if (code === 'auth/email-already-in-use') {
    return {
      message: 'This email is already registered. Switch to "Sign In" to log into your account.',
      needsEmailProviderSetup: false,
    };
  }
  if (code === 'auth/invalid-email') {
    return { message: 'Please enter a valid email address.', needsEmailProviderSetup: false };
  }
  if (code === 'auth/weak-password') {
    return {
      message: 'Password must be at least 6 characters long.',
      needsEmailProviderSetup: false,
    };
  }
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
    return {
      message: 'Incorrect email or password. Check your details or reset your password.',
      needsEmailProviderSetup: false,
    };
  }
  if (code === 'auth/popup-closed-by-user') {
    return {
      message: 'Google sign-in popup was closed before completing login.',
      needsEmailProviderSetup: false,
    };
  }
  return {
    message: msg.replace(/^Firebase:\s*/i, ''),
    needsEmailProviderSetup: false,
  };
}

export const AuthGate: React.FC<AuthGateProps> = ({ inviteRoomCode }) => {
  const [mode, setMode] = useState<'SIGNUP' | 'SIGNIN'>('SIGNUP');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [needsConsoleSetup, setNeedsConsoleSetup] = useState(false);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);
    setNeedsConsoleSetup(false);

    if (!email.trim() || !password) {
      setErrorMsg('Please enter your email and password.');
      return;
    }
    if (mode === 'SIGNUP' && !name.trim()) {
      setErrorMsg('Please enter your Captain Name to create your player account.');
      return;
    }

    setLoading(true);
    try {
      if (mode === 'SIGNUP') {
        await registerWithEmail({ name, email, password });
      } else {
        await loginWithEmail({ email, password });
      }
    } catch (err) {
      const mapped = mapFirebaseAuthError(err);
      setErrorMsg(mapped.message);
      setNeedsConsoleSetup(mapped.needsEmailProviderSetup);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setErrorMsg(null);
    setInfoMsg(null);
    setNeedsConsoleSetup(false);
    setLoading(true);
    try {
      await loginWithGoogle();
    } catch (err) {
      const mapped = mapFirebaseAuthError(err);
      setErrorMsg(mapped.message);
      setNeedsConsoleSetup(mapped.needsEmailProviderSetup);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    setErrorMsg(null);
    setInfoMsg(null);
    if (!email.trim()) {
      setErrorMsg('Enter your email address above first so we can send a password reset mail.');
      return;
    }
    setLoading(true);
    try {
      await resetPasswordByEmail(email);
      setInfoMsg(`Password reset email sent to ${email.trim()}. Check your inbox.`);
    } catch (err) {
      const mapped = mapFirebaseAuthError(err);
      setErrorMsg(mapped.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#080D1A] text-slate-100 flex items-center justify-center px-4 py-10">
      <div className="max-w-md w-full space-y-5">
        {inviteRoomCode && (
          <div className="rounded-2xl border border-amber-400/50 bg-amber-500/12 p-4 flex items-start gap-3">
            <Users className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-100 leading-relaxed">
              <strong className="text-white block text-sm mb-0.5">
                Squad Invite Link Detected · Room {inviteRoomCode}
              </strong>
              Sign in or create your account via email below to join your squad directly in the live
              IPL auction hall.
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-slate-800 bg-slate-900/95 p-6 sm:p-8 shadow-2xl space-y-6">
          <div className="space-y-1.5 text-center">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-400">
              <ShieldCheck className="w-4 h-4" />
              <span>IPL Auction &amp; Showdown</span>
            </div>
            <h1 className="font-display text-3xl font-extrabold text-white tracking-tight">
              {mode === 'SIGNUP' ? 'New Player Mail Registration' : 'Captain Email Sign In'}
            </h1>
            <p className="text-xs text-slate-400">
              Sign in with your email to enter live auctions, join squad links, and play the
              2-over cricket showdown.
            </p>
          </div>

          {/* Mode Toggle */}
          <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-slate-950 border border-slate-800">
            <button
              type="button"
              onClick={() => {
                setMode('SIGNUP');
                setErrorMsg(null);
                setInfoMsg(null);
              }}
              className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                mode === 'SIGNUP'
                  ? 'bg-amber-400 text-slate-950'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>New Player</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('SIGNIN');
                setErrorMsg(null);
                setInfoMsg(null);
              }}
              className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                mode === 'SIGNIN'
                  ? 'bg-amber-400 text-slate-950'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>Existing Player</span>
            </button>
          </div>

          {errorMsg && (
            <div className="p-3.5 rounded-xl bg-rose-500/15 border border-rose-500/40 text-xs text-rose-200 space-y-2">
              <div>{errorMsg}</div>
              {needsConsoleSetup && (
                <div className="text-[11px] text-rose-100/90 border-t border-rose-500/30 pt-2">
                  Admin setup: Firebase Console → Authentication → Sign-in method → Enable{' '}
                  <strong>Email/Password</strong>.
                </div>
              )}
            </div>
          )}

          {infoMsg && (
            <div className="p-3.5 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-xs text-emerald-200 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{infoMsg}</span>
            </div>
          )}

          <form onSubmit={handleEmailSubmit} className="space-y-3.5">
            {mode === 'SIGNUP' && (
              <div className="space-y-1.5">
                <label htmlFor="auth-name" className="text-xs font-semibold text-slate-300 block">
                  Captain / Player Name
                </label>
                <input
                  id="auth-name"
                  type="text"
                  maxLength={40}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Aarav Sharma"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="auth-email" className="text-xs font-semibold text-slate-300 block">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  id="auth-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="captain@example.com"
                  className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="auth-password" className="text-xs font-semibold text-slate-300">
                  Password
                </label>
                {mode === 'SIGNIN' && (
                  <button
                    type="button"
                    onClick={handleResetPassword}
                    className="text-[11px] text-amber-400 hover:underline cursor-pointer"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <input
                id="auth-password"
                type="password"
                autoComplete={mode === 'SIGNUP' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 6 characters"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 rounded-xl bg-amber-400 hover:bg-amber-300 disabled:opacity-60 text-slate-950 font-display text-lg font-bold tracking-wide flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <span>
                {loading
                  ? 'Signing In...'
                  : mode === 'SIGNUP'
                  ? 'Create Account & Enter Auction'
                  : 'Sign In with Email'}
              </span>
              <ArrowRight className="w-5 h-5" />
            </button>
          </form>

          <div className="relative flex items-center justify-center">
            <div className="border-t border-slate-800 w-full" />
            <span className="px-3 bg-slate-900 text-[11px] text-slate-500 uppercase tracking-wider shrink-0">
              or instant mail login
            </span>
            <div className="border-t border-slate-800 w-full" />
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={handleGoogleLogin}
            className="w-full py-2.5 px-4 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-700 text-sm font-semibold text-white flex items-center justify-center gap-2.5 transition-colors cursor-pointer"
          >
            <Mail className="w-4 h-4 text-sky-400" />
            <span>Continue with Google Mail</span>
          </button>

          {inviteRoomCode && (
            <div className="pt-2 border-t border-slate-800 flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
              <Link2 className="w-3.5 h-3.5 text-amber-400" />
              <span>Your squad room invite ({inviteRoomCode}) will open right after login.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
