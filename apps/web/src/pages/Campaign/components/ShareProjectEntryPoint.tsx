"use client";

import { useCallback, useEffect, useState } from "react";

import { invokeEdgeFunction } from "@/api/edge";
import { ShareProjectDialog } from "./ShareProjectDialog";

type ActiveProjectShareLink = { id: string; shareUrl: string };

type Props = {
  project: { id: string; name?: string };
  folder?: { id: string; name: string } | null;
  selection?: {
    folderIds: string[];
    rootIds: string[];
    folders: { id: string; name: string }[];
    files: { id: string; name: string; coverUrl: string | null; type: string }[];
  } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function selectionSummaryLabel(selection: { folderIds: string[]; rootIds: string[] }) {
  const parts: string[] = [];
  if (selection.folderIds.length > 0) parts.push(`${selection.folderIds.length} folder${selection.folderIds.length === 1 ? "" : "s"}`);
  if (selection.rootIds.length > 0) parts.push(`${selection.rootIds.length} file${selection.rootIds.length === 1 ? "" : "s"}`);
  return parts.join(", ") || "0 items";
}

function shareUrlFor(shareLinkId: string) {
  const base = import.meta.env.VITE_APP_URL || window.location.origin;
  return `${String(base).replace(/\/$/, "")}/share/project/${shareLinkId}`;
}

async function callProjectShare(action: string, body: Record<string, unknown>) {
  const { data, error } = await invokeEdgeFunction("project-share", { body: { action, ...body } });
  if (error) throw error;
  return data?.data;
}

/**
 * "Share this project with a guest" dialog: owns the active-link state and
 * every handler that talks to the project-share edge function. Open state is
 * controlled by the caller (CampaignDetails.tsx) so the same dialog can be
 * triggered from more than one entry point (the toolbar's Share menu) rather
 * than owning a single buried trigger button.
 */
export function ShareProjectEntryPoint({ project, folder, selection, open, onOpenChange }: Props) {
  const [activeLink, setActiveLink] = useState<ActiveProjectShareLink | null>(null);

  const loadActiveLink = useCallback(async () => {
    if (selection) {
      // An exact mixed selection (this specific set of folders + files)
      // essentially never recurs across opens, so there's no "reuse the
      // existing active link" story here -- every open starts fresh at
      // "create new", without even calling the list action.
      setActiveLink(null);
      return;
    }

    try {
      const links = (await callProjectShare("list", { project_id: project.id, folder_id: folder?.id ?? null })) as Array<{
        id: string;
        folder_id: string | null;
        revoked_at: string | null;
        expires_at: string | null;
      }> | undefined;

      // Whole-project shares and per-folder shares track separate "active
      // link" state, even though they're both rows for the same project_id.
      const active = (links ?? []).find(
        (link) =>
          !link.revoked_at &&
          (!link.expires_at || new Date(link.expires_at).getTime() > Date.now()) &&
          (link.folder_id ?? null) === (folder?.id ?? null),
      );
      setActiveLink(active ? { id: active.id, shareUrl: shareUrlFor(active.id) } : null);
    } catch (err) {
      console.error("Failed to load project share link", err);
    }
  }, [project.id, folder?.id, selection]);

  useEffect(() => {
    if (open) void loadActiveLink();
  }, [open, loadActiveLink]);

  const handleCreateLink = async ({ expiresAt, allowUpload, allowDownload, password }: { expiresAt: Date | null; allowUpload: boolean; allowDownload: boolean; password: string | null }) => {
    const shareLink = (await callProjectShare("create", {
      project_id: project.id,
      folder_id: selection ? null : folder?.id ?? null,
      folder_ids: selection ? selection.folderIds : null,
      asset_root_ids: selection ? selection.rootIds : null,
      expires_at: expiresAt ? expiresAt.toISOString() : null,
      allow_upload: allowUpload,
      allow_download: allowDownload,
      password,
    })) as { id: string; share_url: string };

    setActiveLink({ id: shareLink.id, shareUrl: shareLink.share_url });
    return shareLink.share_url;
  };

  const handleRevokeLink = async () => {
    // Must never resolve silently without calling the API — the dialog
    // reports success as soon as this promise resolves, so a no-op here
    // would show "Share link revoked" while the link stays fully live.
    if (!activeLink) throw new Error("No active share link to revoke");
    await callProjectShare("revoke", { share_link_id: activeLink.id });
    setActiveLink(null);
  };

  return (
    <ShareProjectDialog
      open={open}
      onOpenChange={onOpenChange}
      projectName={selection ? selectionSummaryLabel(selection) : folder?.name ?? project.name}
      targetKind={selection ? "selection" : folder ? "folder" : "project"}
      selectionItems={selection ? { folders: selection.folders, files: selection.files } : undefined}
      existingShareUrl={activeLink?.shareUrl ?? null}
      onCreateLink={handleCreateLink}
      onRevokeLink={handleRevokeLink}
    />
  );
}
