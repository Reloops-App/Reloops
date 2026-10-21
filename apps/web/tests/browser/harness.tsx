import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { generateThumbnailBlob, type UploadItem } from "../../src/components/file-upload-utils";
import AudioReview from "../../src/components/review/audio";
import { UploadProgressCard } from "../../src/components/upload/UploadProgressCard";
import { useFileUpload } from "../../src/hooks/useFileUpload";
import { supabase } from "../../src/lib/supabaseClient";
import "../../src/styles/globals.css";

const root = createRoot(document.getElementById("test-root")!);
const fromBase64 = (base64: string, name: string, type: string) => new File([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], name, { type });

Object.assign(window, {
  reloopsTest: {
    generateThumbnailBlob,
    fromBase64,
    canceled: [] as string[],
    renderAudio(audioUrl: string) {
      Object.assign(document.getElementById("test-root")!.style, { width: "1280px", margin: "0" });
      root.render(<div style={{ height: "100vh" }}><AudioReview title="Brand Sound.wav" audioUrl={audioUrl} annotations={[]} /></div>);
    },
    renderCard(item: Partial<UploadItem>) {
      root.render(<UploadProgressCard item={{ id: "test-upload", file: new File([], "brief.pdf"), name: "brief.pdf", type: "application/pdf", size: 2048, status: "uploading", phase: "upload", progress: 30, ...item } as UploadItem} onCancel={id => (window as any).reloopsTest.canceled.push(id)} />);
    },
    async upload({ session, workspaceId, base64 }: { session: { access_token: string; refresh_token: string }; workspaceId: string; base64: string }) {
      const auth = await supabase.auth.setSession(session);
      if (auth.error) throw auth.error;
      const file = fromBase64(base64, "member-thumbnail-check.pdf", "application/pdf");
      return await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Member upload timed out")), 30_000);
        function Harness() {
          const hook = useFileUpload({ workspaceId, onUploaded: f => { clearTimeout(timeout); resolve(f); } });
          useEffect(() => { hook.addFiles([file]); }, []);
          useEffect(() => {
            const error = hook.uploads.find(u => u.status === "error");
            if (error) { clearTimeout(timeout); reject(new Error(error.errorMessage)); }
          }, [hook.uploads]);
          return <>{hook.uploads.map(item => <UploadProgressCard key={item.id} item={item} onCancel={hook.cancelUpload} />)}</>;
        }
        root.render(<Harness />);
      });
    },
  },
});
