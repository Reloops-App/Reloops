import { Button } from "@/components/ui/button";
import { invokeEdgeFunction } from "@/api/edge";
import { getLoggedInUserProfile } from "@/lib/supabaseClient";
import { cn, downloadFile } from "@/lib/utils";
import type { CommentMutationContext } from "@/lib/shareGuestIdentity";
import { Download, FileImage, ImageOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import CommentsPanel from "./CommentsPanel";
import type { Annotation } from "./annotator-utils";

type ReviewAsset = {
  id: string;
  title?: string | null;
  description?: string | null;
  tags?: string[] | null;
  smart_tags?: string[] | null;
  smart_description?: string | null;
  project_id?: string | null;
  parent_asset_id?: string | null;
  status?: string | null;
  assigned_to?: string | null;
  uploaded_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  uploaded_at?: string;
  mime_type?: string | null;
  size_bytes?: number | null;
  width?: number | null;
  height?: number | null;
  duration_ms?: number | null;
  version_no?: number | null;
  storage_path?: string | null;
};

type Props = {
  className?: string;
  title?: string | null;
  fileTypeLabel?: string;
  downloadUrl?: string | null;
  fallbackDownloadUrl?: string | null;
  downloadName?: string | null;
  message?: string;
  description?: string;
  // Replaces the default "can't preview, download it" card with custom
  // content (e.g. TextFileView's syntax-highlighted preview for JSON/
  // Markdown/etc.), while keeping all the CommentsPanel/annotation wiring
  // below exactly as-is.
  customPreview?: ReactNode;
  annotations?: Annotation[];
  onAddAnnotation?: (annotation: Annotation) => void | Promise<void>;
  projectId?: string | null;
  organizationId?: string | null;
  workspaceId?: string | null;
  assetId?: string | null;
  asset?: ReviewAsset | null;
  onAssetMetadataSave?: (patch: { description: string | null; tags: string[] }) => Promise<void> | void;
  onRetagAsset?: () => void;
  retagStatus?: "idle" | "queued" | "error";
  commentsPanelOpen?: boolean;
  onCommentsPanelOpenChange?: (open: boolean) => void;
  commentMutationContext?: CommentMutationContext;
  // Which edge function edit/delete calls target — defaults to the shared
  // "comment" function used by every existing caller. A share flow with its
  // own isolated comment function can point this elsewhere without changing
  // behavior for anyone else.
  commentEndpoint?: string;
  // Optional: lets a host react to a comment being selected in the list
  // (the live snippet viewer uses it to deep-link to the pin on the real
  // site). Unset for every existing caller.
  onItemClick?: (id: string) => void;
  profiles?: Record<string, {
    id: string;
    display_name?: string | null;
    avatar_url?: string | null;
  }>;
};

export default function UnsupportedAssetPreview({
  className,
  title,
  fileTypeLabel = "Design",
  downloadUrl,
  fallbackDownloadUrl,
  downloadName,
  message,
  description,
  customPreview,
  annotations = [],
  onAddAnnotation,
  projectId,
  organizationId,
  workspaceId,
  assetId,
  asset,
  onAssetMetadataSave,
  onRetagAsset,
  retagStatus,
  commentsPanelOpen,
  onCommentsPanelOpenChange,
  commentMutationContext,
  commentEndpoint = "comment",
  onItemClick,
  profiles = {},
}: Props) {
  const [panelAnnotations, setPanelAnnotations] = useState<Annotation[]>(annotations);
  const [commentText, setCommentText] = useState("");
  const fallbackMessage = `${fileTypeLabel} preview isn't supported in this browser.`;
  const fallbackDescription = "Download the original file to view it in a compatible app.";
  const panelOpen = commentsPanelOpen ?? true;
  const canCompleteComments = !commentMutationContext?.share_token;
  const panelAsset = asset ? {
    ...asset,
    title: asset.title || title || "Asset",
    created_at: asset.created_at || new Date(0).toISOString(),
    storage_path: asset.storage_path || "",
  } : null;

  useEffect(() => {
    setPanelAnnotations(annotations);
  }, [annotations]);

  const commentItems = useMemo(
    () =>
      panelAnnotations.map((annotation) => ({
        id: annotation.id,
        author: annotation.author,
        authorId: annotation.authorId,
        text: annotation.text,
        emoji: annotation.emoji,
        hasDrawing: Boolean(annotation.drawing && annotation.drawing.length > 0),
        page: annotation.page,
        timeSec: Number.isFinite(annotation.time) ? annotation.time : undefined,
        isCompleted: annotation.isCompleted,
        isDeleted: annotation.isDeleted,
        canManageComment: annotation.canManageComment,
        canDeleteComment: annotation.canDeleteComment,
        createdAt: annotation.createdAt,
      })),
    [panelAnnotations],
  );

  async function handleCommentSubmit(text: string) {
    if (!onAddAnnotation) return;
    const user = await getLoggedInUserProfile().catch(() => null);
    const annotation: Annotation = {
      id: globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2),
      time: Number.NaN,
      text,
      author: user?.full_name,
      authorId: user?.sub,
      isCompleted: false,
      isDeleted: false,
      createdAt: new Date().toISOString(),
      emoji: {},
      drawing: [],
    };

    setCommentText("");
    await onAddAnnotation(annotation);
  }

  // Edit/delete target the "comment" function by default (unchanged for
  // every existing caller). A share flow with its own isolated comment
  // function passes commentEndpoint to route here instead — that function
  // takes an action-based POST body rather than comment's PATCH-with-status.
  async function editOrDeleteComment(action: "edit" | "delete", fields: { id: string; body?: string }) {
    if (commentEndpoint === "comment") {
      const body: Record<string, unknown> = { id: fields.id, ...(commentMutationContext ?? {}) };
      if (action === "edit") body.body = fields.body;
      else body.status = "deleted";
      const { error } = await invokeEdgeFunction("comment", { method: "PATCH", body });
      if (error) throw error;
      return;
    }
    const { error } = await invokeEdgeFunction(commentEndpoint, {
      method: "POST",
      body: { action, id: fields.id, body: fields.body, ...(commentMutationContext ?? {}) },
    });
    if (error) throw error;
  }

  async function handleEditComment(id: string, newText: string) {
    setPanelAnnotations((prev) =>
      prev.map((annotation) => annotation.id === id ? { ...annotation, text: newText } : annotation)
    );
    await editOrDeleteComment("edit", { id, body: newText });
  }

  async function handleDeleteComment(id: string) {
    setPanelAnnotations((prev) =>
      prev.map((annotation) => annotation.id === id ? { ...annotation, isDeleted: true } : annotation)
    );
    await editOrDeleteComment("delete", { id });
  }

  async function handleToggleCompleted(id: string) {
    const target = panelAnnotations.find((annotation) => annotation.id === id);
    const nextCompleted = !target?.isCompleted;
    setPanelAnnotations((prev) =>
      prev.map((annotation) => annotation.id === id ? { ...annotation, isCompleted: nextCompleted } : annotation)
    );
    const { error } = await invokeEdgeFunction("comment", {
      method: "PATCH",
      body: { id, status: nextCompleted ? "completed" : "active", ...(commentMutationContext ?? {}) },
    });
    if (error) throw error;
  }

  const preview = customPreview ?? (
    <div className="flex h-full w-full items-center justify-center bg-background p-6">
      <div className="flex max-w-lg flex-col items-center rounded-xl border border-border/70 bg-card px-8 py-10 text-center shadow-sm">
        <div className="relative flex h-24 w-28 items-center justify-center">
          <div className="absolute inset-x-3 bottom-2 h-16 rounded-lg border border-border bg-muted/50 shadow-sm" />
          <div className="relative flex h-20 w-16 items-center justify-center rounded-lg border border-border bg-background shadow-sm">
            <div className="absolute right-0 top-0 h-5 w-5 rounded-bl-lg border-b border-l border-border bg-muted" />
            <FileImage className="h-8 w-8 text-muted-foreground" />
          </div>
          <div className="absolute bottom-0 right-3 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background shadow-sm">
            <ImageOff className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>
        <div className="mt-4 rounded-md border border-border bg-muted/40 px-2.5 py-1 text-xs font-semibold uppercase text-muted-foreground">
          {fileTypeLabel}
        </div>
        {title ? (
          <div className="mt-3 max-w-full truncate text-sm font-medium text-foreground">
            {title}
          </div>
        ) : null}
        <h2 className="mt-3 text-xl font-semibold text-foreground">{message ?? fallbackMessage}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {description ?? fallbackDescription}
        </p>
        {downloadUrl ? (
          <Button
            className="mt-6"
            variant="outline"
            onClick={() => void downloadFile(downloadUrl, downloadName || title || "asset", { fallbackUrl: fallbackDownloadUrl })}
          >
            <Download className="h-4 w-4" />
            Download file
          </Button>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className={cn("flex h-full min-h-0 w-full flex-col overflow-hidden lg:flex-row", className)}>
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {preview}
      </div>
      {panelOpen ? (
        <div className="flex min-h-0 flex-1 w-full flex-col lg:h-full lg:w-auto lg:flex-none">
          <CommentsPanel
            items={commentItems}
            onItemClick={onItemClick}
            showCommentDock={Boolean(onAddAnnotation)}
            includeTimestamp={false}
            reviewMode="view"
            showAnnotationControls={false}
            onCommentSubmit={handleCommentSubmit}
            commentValue={commentText}
            onCommentChange={setCommentText}
            onEditComment={handleEditComment}
            onDeleteComment={handleDeleteComment}
            onToggleCompleted={canCompleteComments ? handleToggleCompleted : undefined}
            projectId={projectId}
            organizationId={organizationId}
            workspaceId={workspaceId}
            assetId={assetId}
            asset={panelAsset}
            onAssetMetadataSave={onAssetMetadataSave}
            onRetagAsset={onRetagAsset}
            retagStatus={retagStatus}
            profiles={profiles}
            onCollapse={onCommentsPanelOpenChange ? () => onCommentsPanelOpenChange(false) : undefined}
          />
        </div>
      ) : null}
    </div>
  );
}
