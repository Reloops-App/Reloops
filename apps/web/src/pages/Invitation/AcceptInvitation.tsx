// pages/AcceptInvitation.tsx
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getSessionToken, supabase } from "@/lib/supabaseClient";
import { invokeEdgeFunction } from "@/api/edge";

export default function AcceptInvitation() {
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      const url = new URL(window.location.href);
      const token = url.searchParams.get("token");
      const accessToken = await getSessionToken();
      if (!token) {
        navigate("/auth", { replace: true });
        return;
      }

      if (!accessToken) {
        // not logged in → send them to auth but keep the token
        navigate(`/auth?token=${encodeURIComponent(token)}`, { replace: true });
        return;
      }

      const { data, error } = await invokeEdgeFunction("invite", {
        body: { action: "accept", token },
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      console.log("accept invitation result", data, error);
      // add time delay before redirecting
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (error) {
        console.error("accept invitation error", error);
        navigate(`/auth?token=${encodeURIComponent(token)}`, { replace: true });
        return;
      }
      navigate("/workspaces", { replace: true });
    })();
  }, [navigate]);

  return null;
}
