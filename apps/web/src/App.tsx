"use client";

import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { invokeEdgeFunction } from "@/api/edge";
import { ensureFreshSupabaseSession, getSupabaseSessionFromStorage, updateSupabaseUserViaHttp } from "@/lib/supabaseAuthApi";
import { getDefaultWorkspacePath } from "@/lib/workspaceRouting";

export default function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [hasValidSession, setHasValidSession] = useState(false);
  const [defaultWorkspacePath, setDefaultWorkspacePath] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;

    const checkAuth = async () => {
      try {
        await ensureFreshSupabaseSession();
        const session = getSupabaseSessionFromStorage();
        if (!canceled) {
          setHasValidSession(Boolean(session?.access_token));
          setAuthChecked(true);
        }
      } catch (err) {
        console.error('Auth check failed:', err);
        if (!canceled) {
          setHasValidSession(false);
          setAuthChecked(true);
        }
      }
    };

    const runInviteBootstrap = async () => {
      const session = getSupabaseSessionFromStorage();
      const inviteToken = (session as any)?.user?.user_metadata?.invite_token;
      if (!inviteToken) return;
      try {
        const { error: bootErr } = await invokeEdgeFunction("bootstrap", {
          body: { inviteToken },
        });
        if (bootErr) console.error("Bootstrap invite processing error:", bootErr);

        const metadata = ((session as any)?.user?.user_metadata ?? {}) as any;
        const { invite_token, ...remainingMetadata } = metadata;
        await updateSupabaseUserViaHttp({ data: remainingMetadata });
      } catch (e) {
        console.error("Failed to process invite:", e);
      }
    }

    const onVisibleOrFocus = () => {
      if (document.visibilityState !== "visible") return;
      void checkAuth().then(runInviteBootstrap).catch(() => {});
    };

    void checkAuth().then(runInviteBootstrap);

    window.addEventListener("focus", onVisibleOrFocus);
    document.addEventListener("visibilitychange", onVisibleOrFocus);
    window.addEventListener("storage", onVisibleOrFocus);

    return () => {
      canceled = true;
      window.removeEventListener("focus", onVisibleOrFocus);
      document.removeEventListener("visibilitychange", onVisibleOrFocus);
      window.removeEventListener("storage", onVisibleOrFocus);
    };
  }, []);

  useEffect(() => {
    if (!hasValidSession) {
      setDefaultWorkspacePath(null);
      return;
    }

    let canceled = false;
    void getDefaultWorkspacePath().then((path) => {
      if (!canceled) setDefaultWorkspacePath(path);
    });

    return () => {
      canceled = true;
    };
  }, [hasValidSession]);

  // Show loading while checking auth
  if (!authChecked || (hasValidSession && !defaultWorkspacePath)) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-sky-100 via-white to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto mb-4"></div>
          <p className="text-slate-600">Loading...</p>
        </div>
      </div>
    );
  }

  // If user has valid session, redirect to their workspace/projects
  if (hasValidSession) {
    return <Navigate to={defaultWorkspacePath ?? "/workspaces"} replace />;
  }

  return <Navigate to="/auth" replace />;
}
