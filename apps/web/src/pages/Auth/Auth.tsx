import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertCircle, Mail, Lock, User2, Building2 } from "lucide-react";
import { motion } from "framer-motion";
import { supabase } from "@/lib/supabaseClient";
import { invokeEdgeFunction } from "@/api/edge";
import { getDefaultWorkspacePath } from "@/lib/workspaceRouting";



export default function Auth() {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  const { inviteToken, returnTo } = useMemo((): { inviteToken?: string; returnTo?: string } => {
    if (typeof window === "undefined") return { inviteToken: undefined, returnTo: undefined };
    try {
      const url = new URL(window.location.href);
      return {
        inviteToken: url.searchParams.get("invite") || url.searchParams.get("token") || undefined,
        returnTo: url.searchParams.get("redirectTo") || undefined,
      };
    } catch {
      return { inviteToken: undefined, returnTo: undefined };
    }
  }, []);

  console.log("[Auth] Params:", { inviteToken });

  // Where to go after auth — use the returnTo param if present, otherwise the active workspace projects page.
  const postAuthPath = useMemo(() => {
    return returnTo ? decodeURIComponent(returnTo) : '/workspaces';
  }, [returnTo]);

  const resolvePostAuthPath = async () => {
    if (returnTo) return postAuthPath;
    const workspacePath = await getDefaultWorkspacePath();
    return workspacePath;
  };

  let redirectTo = typeof window !== "undefined" ? `${window.location.origin}/auth?redirectTo=${encodeURIComponent(postAuthPath)}` : undefined;

  // Check if user is already authenticated and redirect to projects
  useEffect(() => {
    const checkAuthStatus = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          // Ensure user is provisioned before redirecting
          try {
             console.log("[Auth] Calling bootstrap...");
             await invokeEdgeFunction("bootstrap", {
               body: inviteToken ? { inviteToken } : {}
             });
          } catch (e) {
             console.warn("[Auth] Bootstrap failed", e);
          }

          navigate(await resolvePostAuthPath(), { replace: true });
        }
      } catch (error) {
        console.error('Error checking auth status:', error);
      } finally {
        setCheckingAuth(false);
      }
    };

    checkAuthStatus();
  }, [redirectTo, postAuthPath, returnTo, inviteToken, navigate]);

  // ────────────────────────────────────────────────────────────────────────────
  // Auth handlers (Supabase)
  const onGoogle = async (_mode: "signin" | "signup") => {
    try {
      setError(null); setLoading(true);
      if (!supabase) throw new Error("Supabase not configured");
      const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
      if (error) throw error;
      // Supabase will redirect; no further action required.
    } catch (e: any) {
      setError(e.message || "Google auth failed");
      setLoading(false);
    }
  };

  const onSignin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    try {
      setError(null); setLoading(true);
      const form = new FormData(e.currentTarget);
      const email = String(form.get("email"));
      const password = String(form.get("password"));
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });

      console.log("Sign in data:", data);

      // delay to allow for any redirects to complete
      await new Promise((res) => setTimeout(res, 1500));

      if (error) throw error;
      
      // Call bootstrap idempotently on any signin.
      try {
        await invokeEdgeFunction("bootstrap", {
          body: inviteToken ? { inviteToken } : {}
        });
      } catch (e) {
        console.warn("[Auth] Bootstrap on sign-in failed", e);
      }

      navigate(await resolvePostAuthPath(), { replace: true });
    } catch (e: any) {
      setError(e.message || "Sign in failed");
    } finally {
      setLoading(false);
    }
  };

  const onSignup = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    try {
      setError(null); setLoading(true);
      if (!supabase) throw new Error("Supabase not configured");
      const form = new FormData(e.currentTarget);
      const full_name = String(form.get("fullName"));
      const company = String(form.get("company"));
      const email = String(form.get("email"));
      const password = String(form.get("password"));

      const { data: _signupData, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            confirmation_sent_at: new Date(),
            full_name,
            company,
            ...(inviteToken && { invite_token: inviteToken }),
          },
          emailRedirectTo: redirectTo,
        },
      });
      if (error) throw error;

      // Check if we have an immediate session
      const { data: sess } = await supabase.auth.getSession();
      
      if (!sess.session) {
        console.log("[Auth] No session yet; continuing to post-auth destination");
      }

      // Immediate session (email confirmation disabled or already confirmed)
      try {
        await invokeEdgeFunction("bootstrap", {
          body: inviteToken ? { inviteToken } : {},
        });
      } catch (e) {
        console.error('[Auth] Failed to provision user in onSignup:', e);
      }

      navigate(await resolvePostAuthPath(), { replace: true });
    } catch (e: any) {
      setError(e.message || "Sign up failed");
    } finally {
      setLoading(false);
    }
  };

  // ────────────────────────────────────────────────────────────────────────────
  // Show loading while checking auth status
  if (checkingAuth) {
    return (
      <div className="relative min-h-screen overflow-hidden px-4 py-10 grid place-items-center text-slate-900 dark:text-slate-100">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900" />
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center gap-2 text-slate-600 dark:text-slate-400"
        >
          <div className="animate-spin rounded-full h-4 w-4 border-2 border-current border-t-transparent" />
          <span>Checking authentication...</span>
        </motion.div>
      </div>
    );
  }

  // ────────────────────────────────────────────────────────────────────────────
  // FX: animated background (gradient blobs + subtle grid)
  return (
    <div className="relative min-h-screen overflow-hidden px-4 py-10 grid place-items-center text-slate-900 dark:text-slate-100">
      {/* radial vignette */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900" />
      <div className="pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)] bg-[linear-gradient(120deg,rgba(251,191,36,0.25),transparent_40%),linear-gradient(300deg,rgba(59,130,246,0.25),transparent_40%)]" />

      {/* soft animated blobs */}
      <motion.div
        className="pointer-events-none absolute -top-24 -left-24 h-72 w-72 rounded-full blur-3xl bg-amber-300/30 dark:bg-amber-400/20"
        animate={{ y: [0, 30, 0], x: [0, 10, 0] }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="pointer-events-none absolute -bottom-24 -right-24 h-80 w-80 rounded-full blur-3xl bg-blue-300/30 dark:bg-blue-400/20"
        animate={{ y: [0, -20, 0], x: [0, -15, 0] }}
        transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* subtle grid */}
      <svg className="pointer-events-none absolute inset-0 opacity-[0.06] dark:opacity-[0.08]" aria-hidden>
        <defs>
          <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
            <path d="M 32 0 L 0 0 0 32" fill="none" stroke="currentColor" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" className="text-slate-900 dark:text-slate-100" />
      </svg>


      {/* Auth Card */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="relative z-10 w-full max-w-md">
        <Card className="bg-white/80 backdrop-blur border-slate-200 shadow-2xl dark:bg-slate-900/80 dark:border-slate-800">
          <CardHeader className="space-y-2">
            <CardTitle className="text-2xl">Welcome back</CardTitle>
            <CardDescription>Sign in to your workspace or create a new account.</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="signin" className="w-full">
              <TabsList className="grid grid-cols-2 rounded-xl">
                <TabsTrigger value="signin">Sign In</TabsTrigger>
                <TabsTrigger value="signup">Sign Up</TabsTrigger>
              </TabsList>

              {/* Sign In */}
              <TabsContent value="signin" className="mt-6">
                <form className="space-y-4" onSubmit={onSignin}>
                  <div className="grid gap-2">
                    <Label htmlFor="email">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                      <Input id="email" name="email" type="email" placeholder="you@company.com" className="pl-9" required />
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="password">Password</Label>
                      <Link to="/forgot-password" className="text-xs text-primary hover:underline underline-offset-4">
                        Forgot password?
                      </Link>
                    </div>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                      <Input id="password" name="password" type="password" placeholder="••••••••" className="pl-9" required />
                    </div>
                  </div>
                  <Button type="submit" className="w-full rounded-xl" disabled={loading}>{loading ? "Signing in…" : "Sign In"}</Button>
                </form>
                {/* 
                <div className="my-6 flex items-center gap-3">
                  <Separator className="flex-1" />
                  <span className="text-xs text-slate-500">or</span>
                  <Separator className="flex-1" />
                </div>

                <Button
                  variant="outline"
                  className="gsi-material-button w-full rounded-xl flex items-center"
                  onClick={() => onGoogle("signin")}
                  disabled={loading}
                  type="button"
                >
                  <span className="gsi-material-button-icon mr-2">
                    <svg
                      version="1.1"
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 48 48"
                      style={{ display: "block" }}
                      width={20}
                      height={20}
                    >
                      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                      <path fill="none" d="M0 0h48v48H0z"></path>
                    </svg>
                  </span>
                  {/* <span className="gsi-material-button-contents">Sign in with Google</span>
                  <span style={{ display: "none" }}>Sign in with Google</span> */}
                {/* </Button> } */}
              </TabsContent>

              {/* Sign Up */}
              <TabsContent value="signup" className="mt-6">
                <form className="space-y-4" onSubmit={onSignup}>
                  <div className="grid gap-2">
                    <Label htmlFor="fullName">Full name</Label>
                    <div className="relative">
                      <User2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                      <Input id="fullName" name="fullName" placeholder="Jane Doe" className="pl-9" required />
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="company">Company</Label>
                    <div className="relative">
                      <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                      <Input id="company" name="company" placeholder="Acme Inc." className="pl-9" />
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="email2">Work email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                      <Input id="email2" name="email" type="email" placeholder="you@company.com" className="pl-9" required />
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="password2">Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                      <Input id="password2" name="password" type="password" placeholder="At least 8 characters" className="pl-9" minLength={8} required />
                    </div>
                  </div>

                  <Button type="submit" className="w-full rounded-xl" disabled={loading}>{loading ? "Creating…" : "Create Account"}</Button>
                </form>
                {/* 
                <div className="my-6 flex items-center gap-3">
                  <Separator className="flex-1" />
                  <span className="text-xs text-slate-500">or</span>
                  <Separator className="flex-1" />
                </div>

                <Button
                  variant="outline"
                  className="gsi-material-button w-full rounded-xl flex items-center"
                  onClick={() => onGoogle("signup")}
                  disabled={loading}
                  type="button"
                >
                  <span className="gsi-material-button-icon mr-2">
                    <svg
                      version="1.1"
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 48 48"
                      style={{ display: "block" }}
                      width={20}
                      height={20}
                    >
                      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                      <path fill="none" d="M0 0h48v48H0z"></path>
                    </svg>
                  </span>
                  <span className="gsi-material-button-contents">Sign up with Google</span>
                  <span style={{ display: "none" }}>Sign up with Google</span>
                </Button> */}

                <p className="mt-4 text-xs text-slate-500">By continuing, you agree to our Terms and Privacy Policy.</p>
              </TabsContent>
            </Tabs>

            {/* Error */}
            {error && (
              <div className="mt-4 flex items-center gap-2 text-red-500 text-sm">
                <AlertCircle className="h-4 w-4" /> <span>{error}</span>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div >
  );
}
