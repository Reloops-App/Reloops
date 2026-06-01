import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { invokeEdgeFunction } from "@/api/edge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { SidebarTrigger } from "@/components/ui/sidebar";
import VideoPlayerWithAnnotations, { type Annotation } from "@/components/review/video";
import ImageAnnotatorWithAnnotations from "@/components/review/image";
import WebScreenshotReview from "@/components/review/WebScreenshotReview";
import PdfAnnotatorWithAnnotations from "@/components/review/pdf";
import UnsupportedAssetPreview from "@/components/review/UnsupportedAssetPreview";
import { normalizeAnnotation } from "@/components/review/annotator-utils";
import { isLikelyWebsiteScreenshot, type ImageDimensions } from "@/components/review/website-review-utils";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import AssetNotFound from "@/components/errors/AssetNotFound";
import { cn, formatTimetoDayMonth, downloadFile } from "@/lib/utils";
import { ManageVersionStackDialog } from "@/components/versions/ManageVersionStackDialog";
import {
  buildDaVinciResolveMarkersEdl,
  buildPremiereMarkersCsv,
  downloadTextFile,
  safeMarkerExportBaseName,
} from "@/lib/commentMarkerExport";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { Badge } from "@/components/ui/badge";
import {
  Check,
  Loader2,
  ChevronDown,
  Minus,
  AlertTriangle,
  RotateCcw,
  DownloadIcon,
  GitCompare,
  Layers,
  Palette,
  Share2,
  UserPlus,
  FileDown,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getAvatarInitials, AVATAR_FALLBACK_CLASS } from "@/lib/avatar-utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { requestAssetRevision, updateAsset } from "@/api";
import { ShareAssetDialog } from "@/components/review/ShareAssetDialog";
import {
  apiKeyActorProfileId,
  isApiKeyActorProfileId,
  toApiKeyActorProfile,
  loadApiKeyActorProfiles,
  getApiKeyActorIconUrl,
} from "@/lib/api-key-actors";
import { getDesignAssetLabel, isDesignPreviewUnavailableAsset } from "@/lib/designFiles";
import { previewBackgroundClass } from "@/lib/imagePreviewBackground";
import { useImagePreviewBackground } from "@/hooks/useImagePreviewBackground";

// Types
type Asset = {
  id: string;
  workspace_id: string;
  project_id?: string | null;
  folder_id?: string | null;
  workspace_name?: string | null;
  project_name?: string | null;
  parent_asset_id?: string | null;
  title: string;
  description?: string | null;
  tags?: string[] | null;
  smart_tags?: string[] | null;
  smart_description?: string | null;
  ai_description?: string | null;
  ai_metadata?: Record<string, any> | null;
  cover_image_url?: string | null;
  created_by?: string;
  created_by_api_key_id?: string | null;
  created_at: string;
  uploaded_at?: string;
  uploaded_by?: string;
  uploaded_by_api_key_id?: string | null;
  assigned_to_api_key_id?: string | null;
  updated_at?: string | null;
  updated_by?: string | null;
  updated_by_api_key_id?: string | null;
  storage_path: string;
  //   -- //TODO: tags (future feature)
  // -- Assigned To (a user responsible for this asset, multiple possible)
  assigned_to?: string | null;
  mime_type?: string | null;
  size_bytes?: number | null;
  duration_ms?: number | null;
  width?: number | null;
  height?: number | null;
  status?: "needs_review" | "in_review" | "approved" | "published" | "archived" | "deleted" | string | null;
  version_no?: number | null;
  url?: string | null;
  name?: string | null;
};

type FolderTrailItem = {
  id: string;
  name: string;
  project_id?: string | null;
  parent_folder_id?: string | null;
};

type ReviewAssetLocationState = {
  folderTrail?: FolderTrailItem[];
  asset?: ReviewAssetRouteAsset;
} | null;

type AssetVersion = {
  id: string;
  title: string;
  version_no: number | null;
  created_at: string;
  cover_image_url?: string | null;
  status?: string | null;
};

type ReviewAssetRouteAsset = {
  id: string;
  name?: string | null;
  title?: string | null;
  type?: string | null;
  mime_type?: string | null;
  sizeBytes?: number | null;
  size_bytes?: number | null;
  createdAt?: string | null;
  created_at?: string | null;
  updatedAt?: string | null;
  updated_at?: string | null;
  uploadedAt?: string | null;
  uploaded_at?: string | null;
  coverUrl?: string | null;
  cover_image_url?: string | null;
  url?: string | null;
  storage_path?: string | null;
  status?: Asset["status"] | null;
  version_no?: number | null;
  project_id?: string | null;
  folder_id?: string | null;
  parent_asset_id?: string | null;
  workspace_name?: string | null;
  project_name?: string | null;
};

function hydrateRouteAsset(routeAsset: ReviewAssetRouteAsset | null | undefined, workspaceId?: string, projectId?: string): Asset | null {
  if (!routeAsset || !workspaceId) return null;

  const storagePath = routeAsset.storage_path ?? routeAsset.url ?? "";

  return {
    id: routeAsset.id,
    workspace_id: workspaceId,
    project_id: routeAsset.project_id ?? projectId ?? null,
    folder_id: routeAsset.folder_id ?? null,
    workspace_name: routeAsset.workspace_name ?? null,
    project_name: routeAsset.project_name ?? null,
    parent_asset_id: routeAsset.parent_asset_id ?? null,
    title: routeAsset.title ?? routeAsset.name ?? "Asset",
    cover_image_url: routeAsset.cover_image_url ?? routeAsset.coverUrl ?? null,
    created_by: undefined,
    created_at: routeAsset.created_at ?? routeAsset.createdAt ?? new Date().toISOString(),
    uploaded_at: routeAsset.uploaded_at ?? routeAsset.uploadedAt ?? undefined,
    uploaded_by: undefined,
    updated_at: routeAsset.updated_at ?? routeAsset.updatedAt ?? null,
    updated_by: undefined,
    storage_path: storagePath,
    assigned_to: null,
    mime_type: routeAsset.mime_type ?? routeAsset.type ?? null,
    size_bytes: routeAsset.size_bytes ?? routeAsset.sizeBytes ?? null,
    status: routeAsset.status ?? null,
    version_no: routeAsset.version_no ?? null,
    url: routeAsset.url ?? routeAsset.storage_path ?? null,
    name: routeAsset.name ?? routeAsset.title ?? null,
  };
}

function AssetVersionThumbnail({
  version,
  mimeType,
  unsupportedDesignPreview,
}: {
  version: AssetVersion;
  mimeType?: string | null;
  unsupportedDesignPreview: boolean;
}) {
  const previewBackground = useImagePreviewBackground({ src: version.cover_image_url ?? undefined, mime_type: mimeType });

  return (
    <div className={cn("w-12 h-8 rounded border bg-muted flex-shrink-0 overflow-hidden", previewBackgroundClass(previewBackground))}>
      {unsupportedDesignPreview ? (
        <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.12),_transparent_52%),linear-gradient(180deg,_#111827,_#020617)] text-sky-200">
          <Palette className="h-3.5 w-3.5" />
        </div>
      ) : version.cover_image_url ? (
        <img
          src={`${version.cover_image_url}`}
          alt={version.title}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full bg-muted flex items-center justify-center text-xs text-muted-foreground">
          {mimeType?.startsWith("video/") ? "📹" : "🖼️"}
        </div>
      )}
    </div>
  );
}

export type AssetComment = {
  id: string;
  asset_id: string;
  parent_id: string | null;
  author_user_id: string | null;
  author_api_key_id?: string | null;
  guest_name?: string | null;
  guest_email?: string | null;
  body: string;
  ms_offset: number | null;
  created_at: string;
  drawing_json?: unknown | null;
  status: string;
};

function LoadingSkeleton() {
  return <div className="aspect-video w-full overflow-hidden rounded-lg border bg-muted/30" />;
}

// tiny time-ago using only existing timestamps
function timeAgo(iso?: string | null) {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  const y = Math.floor(mo / 12);
  return `${y}y ago`;
}

// Types
type Profile = { id: string; display_name: string | null; avatar_url: string | null };
type AssignableAgent = {
  id: string;
  name: string;
  provider?: string | null;
  icon_url?: string | null;
};
type AssignOption =
  | { kind: "user"; id: string; label: string; avatar_url?: string | null }
  | { kind: "agent"; id: string; label: string; avatar_url?: string | null; provider?: string | null };

function AssignAvatar({ option, className }: { option: AssignOption; className?: string }) {
  return (
    <Avatar className={cn("h-6 w-6 shrink-0 border border-border/60", option.kind === "agent" && "bg-background p-0.5", className)}>
      <AvatarImage
        src={option.avatar_url ?? undefined}
        alt={option.label}
        className={cn(option.kind === "agent" && "object-contain")}
      />
      <AvatarFallback className={cn("text-[10px] font-semibold", AVATAR_FALLBACK_CLASS)}>
        {getAvatarInitials(option.label)}
      </AvatarFallback>
    </Avatar>
  );
}

function mapApiKeyActorFields<T extends {
  created_by?: string | null;
  created_by_api_key_id?: string | null;
  uploaded_by?: string | null;
  uploaded_by_api_key_id?: string | null;
  assigned_to?: string | null;
  assigned_to_api_key_id?: string | null;
  updated_by?: string | null;
  updated_by_api_key_id?: string | null;
}>(row: T): T {
  const next = { ...row };
  if (next.created_by_api_key_id) next.created_by = apiKeyActorProfileId(next.created_by_api_key_id);
  if (next.uploaded_by_api_key_id) next.uploaded_by = apiKeyActorProfileId(next.uploaded_by_api_key_id);
  if (next.assigned_to_api_key_id) next.assigned_to = apiKeyActorProfileId(next.assigned_to_api_key_id);
  if (next.updated_by_api_key_id) next.updated_by = apiKeyActorProfileId(next.updated_by_api_key_id);
  return next;
}

function mapCommentActor(row: AssetComment): AssetComment {
  if (!row.author_api_key_id) return row;
  return {
    ...row,
    author_user_id: apiKeyActorProfileId(row.author_api_key_id),
  };
}

// Status Badge Component
function StatusBadge({ status }: { status: Asset["status"] | null | undefined }) {
  const NO_STATUS_LABEL = "No status";

  if (status == null || status === "") {
    return (
      <Badge className="gap-1.5 bg-muted text-muted-foreground">
        <Minus className="h-3.5 w-3.5" />
        {NO_STATUS_LABEL}
      </Badge>
    );
  }
  const map: Record<string, { cn: string; icon: React.ElementType; label: string }> = {
    needs_review: {
      cn: "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-100",
      icon: AlertTriangle,
      label: "Needs review",
    },
    in_review: {
      cn: "bg-blue-100 text-blue-900 dark:bg-blue-500/20 dark:text-blue-100",
      icon: RotateCcw,
      label: "In review",
    },
    approved: {
      cn: "bg-green-100 text-green-900 dark:bg-green-500/20 dark:text-green-100",
      icon: Check,
      label: "Approved",
    },
  };
  const def = map[String(status)] ?? {
    cn: "bg-muted text-muted-foreground",
    icon: Minus,
    label: String(status).replace(/_/g, " "),
  };
  const Icon = def.icon;
  return (
    <Badge className={`gap-1.5 ${def.cn}`}>
      <Icon className="h-3.5 w-3.5" />
      {def.label}
    </Badge>
  );
}


export default function ReviewAsset() {
  const { workspaceId, projectId, assetId } = useParams<{
    workspaceId: string;
    projectId?: string;
    assetId: string;
  }>();
  const location = useLocation();
  const navigate = useNavigate();
  const routeState = location.state as ReviewAssetLocationState;
  const routeFolderTrail = useMemo(() => {
    return Array.isArray(routeState?.folderTrail) ? routeState.folderTrail : [];
  }, [routeState]);
  const routeAsset = useMemo(
    () => hydrateRouteAsset(routeState?.asset, workspaceId, projectId),
    [routeState, workspaceId, projectId],
  );

  const [asset, setAsset] = useState<Asset | null>(routeAsset);
  const [comments, setComments] = useState<AssetComment[]>([]);
  const [folderTrail, setFolderTrail] = useState<FolderTrailItem[]>(routeFolderTrail);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [versions, setVersions] = useState<AssetVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [showVersionsDialog, setShowVersionsDialog] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [shareLinkId, setShareLinkId] = useState<string | null>(null);
  const [shareLinkLoading, setShareLinkLoading] = useState(false);
  const [shareLinkResolvedAssetId, setShareLinkResolvedAssetId] = useState<string | null>(null);

  const [user_profiles_access_to_asset, setUserProfilesAccessToAsset] = useState<Profile[]>([]);
  const [assignableAgents, setAssignableAgents] = useState<AssignableAgent[]>([]);
  const [loading, setLoading] = useState(!routeAsset);
  const [error, setError] = useState<"not_found" | "access_denied" | "unknown" | null>(null);
  const [isTeamMember, setIsTeamMember] = useState(false);
  const loadKeyRef = useRef<string | null>(null);
  const loadSeqRef = useRef(0);

  const canQuery = Boolean(workspaceId && assetId);

  useEffect(() => {
    setFolderTrail(routeFolderTrail);
  }, [assetId, routeFolderTrail]);

  useEffect(() => {
    setAsset(routeAsset);
    setComments([]);
    setVersions([]);
    setError(null);
    setLoading(!routeAsset);
  }, [assetId, routeAsset]);

  useEffect(() => {
    setShowShareDialog(false);
    setShareLink(null);
    setShareLinkId(null);
    setShareLinkLoading(false);
    setShareLinkResolvedAssetId(null);
  }, [assetId]);



  // Helper functions for file type icons
  function kindFromMime(mime?: string | null): "image" | "video" | "audio" | "pdf" | "text" | "other" {
    if (!mime) return "other";
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("video/")) return "video";
    if (mime.startsWith("audio/")) return "audio";
    if (mime === "application/pdf") return "pdf";
    if (mime.startsWith("text/")) return "text";
    return "other";
  }



  // Status options (schema-only)
  const STATUS_OPTIONS = ["needs_review", "in_review", "approved"] as const;
  const [statusSaving, setStatusSaving] = useState(false);
  const [requestRevisionSaving, setRequestRevisionSaving] = useState(false);

  const NO_STATUS_LABEL = "No status";
  const formatStatusLabel = (s?: Asset["status"] | null) =>
    s == null || s === "" ? NO_STATUS_LABEL : String(s).replace(/_/g, " ");

  // Edit State
  const [editingProject, setEditingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [isUpdatingProject, setIsUpdatingProject] = useState(false);

  const [editingAsset, setEditingAsset] = useState(false);
  const [newAssetName, setNewAssetName] = useState("");
  const [isUpdatingAsset, setIsUpdatingAsset] = useState(false);

  const handleEditProject = () => {
    setNewProjectName(asset?.project_name || "");
    setEditingProject(true);
  };

  const handleSaveProjectEdit = async () => {
    if (!projectId || !newProjectName.trim()) return;
    setIsUpdatingProject(true);
    try {
      const { error } = await supabase
        .from("projects")
        .update({ name: newProjectName.trim() })
        .eq("id", projectId);

      if (error) throw error;

      setAsset((prev) => prev ? { ...prev, project_name: newProjectName.trim() } : null);
      toast.success("Project updated");
      setEditingProject(false);
    } catch (err) {
      console.error("Error updating project:", err);
      toast.error("Failed to update project");
    } finally {
      setIsUpdatingProject(false);
    }
  };

  const handleEditAsset = () => {
    setNewAssetName(asset?.title || asset?.name || "");
    setEditingAsset(true);
  };

  const handleSaveAssetEdit = async () => {
    if (!assetId || !newAssetName.trim()) return;
    setIsUpdatingAsset(true);
    try {
      const { error } = await invokeEdgeFunction("asset", {
        method: "PATCH",
        body: { id: assetId, title: newAssetName.trim() }
      });

      if (error) throw error;

      // Update local state
      setAsset((prev) => prev ? { ...prev, title: newAssetName.trim() } : null);
      toast.success("Asset updated");
      setEditingAsset(false);
      // Refresh asset data to ensure UI consistency
      await loadData();
    } catch (err) {
      console.error("Error updating asset:", err);
      toast.error("Failed to update asset");
    } finally {
      setIsUpdatingAsset(false);
    }
  };

  async function loadVersions(currentAsset: Asset) {
    if (!currentAsset.id) return;

    setVersionsLoading(true);
    try {
      // Find the root asset (parent) to get all versions in the chain
      const rootAssetId = currentAsset.parent_asset_id || currentAsset.id;

      // Get all assets with the same parent_asset_id or the root asset itself
      // Also include assets that have the current asset as parent (if this asset is the root)
      const { data: versionData, error: versionError } = await supabase
        .from("assets")
        .select("id, title, version_no, created_at, cover_image_url, status")
        .or(`parent_asset_id.eq.${rootAssetId},id.eq.${rootAssetId},parent_asset_id.eq.${currentAsset.id}`)
        .eq("workspace_id", workspaceId!)
        .order("version_no", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });

      if (versionError) throw versionError;

      // Remove duplicates and ensure current asset is included
      const uniqueVersions = (versionData || []).reduce((acc: AssetVersion[], version: AssetVersion) => {
        if (!acc.find(v => v.id === version.id)) {
          acc.push(version);
        }
        return acc;
      }, []);

      // If we only found the current asset, it means there are no other versions
      setVersions(uniqueVersions);
    } catch (e) {
      console.error("Failed to load versions", e);
      setVersions([]);
    } finally {
      setVersionsLoading(false);
    }
  }

  async function resolveFolderTrail(folderId?: string | null): Promise<FolderTrailItem[]> {
    if (!folderId || !workspaceId) return [];

    try {
      const { data, error } = await invokeEdgeFunction<{ data?: FolderTrailItem[] }>("asset", {
        body: {
          action: "list_folders",
          workspace_id: workspaceId,
          project_id: projectId ?? undefined,
        },
      });

      if (error) throw new Error(error.message || "Failed to load folders");

      const foldersById = new Map<string, FolderTrailItem>(
        ((Array.isArray(data?.data) ? data.data : []) as FolderTrailItem[]).map((folder) => [folder.id, folder]),
      );
      const trail: FolderTrailItem[] = [];
      const seen = new Set<string>();
      let cursor: string | null | undefined = folderId;

      while (cursor && !seen.has(cursor)) {
        seen.add(cursor);
        const folder = foldersById.get(cursor);
        if (!folder) break;
        trail.unshift(folder);
        cursor = folder.parent_folder_id ?? null;
      }

      return trail;
    } catch (err) {
      console.warn("Failed to load asset folder breadcrumb", err);
      return [];
    }
  }

  async function loadData() {
    if (!canQuery) return;
    const loadKey = `${workspaceId ?? ""}:${projectId ?? ""}:${assetId ?? ""}`;
    if (loadKeyRef.current === loadKey) return;
    loadKeyRef.current = loadKey;
    const loadSeq = ++loadSeqRef.current;
    if (!routeAsset) setLoading(true);
    setError(null);

    try {
      const assetQuery = supabase
        .from("assets")
        .select("*, workspaces:workspaces!assets_workspace_id_fkey(name), projects:projects!assets_project_id_fkey(name)")
        .eq("id", assetId!)
        .eq("workspace_id", workspaceId!);

      const routeProjectRequest = projectId
        ? supabase
          .from("projects")
          .select("name")
          .eq("id", projectId)
          .maybeSingle()
        : Promise.resolve({ data: null, error: null });

      const workspaceRequest = supabase
        .from("workspaces")
        .select("organization_id, id")
        .eq("id", workspaceId)
        .maybeSingle();

      const commentsRequest = supabase
        .from("asset_comments")
        .select("*")
        .eq("asset_id", assetId!)
        .neq("status", "deleted")
        .order("created_at", { ascending: true });

      const [
        { data: routeProject },
        { data: workspaceData },
        { data: assetRow, error: assetErr },
        { data: commentRows, error: commentsErr },
      ] = await Promise.all([
        routeProjectRequest,
        workspaceRequest,
        assetQuery.maybeSingle(),
        commentsRequest,
      ]);

      if (loadSeq !== loadSeqRef.current) return;

      const routeProjectName = routeProject?.name ?? null;

      if (assetErr) throw assetErr;
      if (commentsErr) throw commentsErr;

      if (!assetRow) {
        setAsset(null);
        setComments([]);
        setFolderTrail([]);
        setError("not_found");
        if (loadSeq === loadSeqRef.current) setLoading(false);
        return;
      }

      const assetFolderId = (assetRow as any)?.folder_id ?? null;
      const hasMatchingRouteTrail = assetFolderId
        ? routeFolderTrail[routeFolderTrail.length - 1]?.id === assetFolderId
        : routeFolderTrail.length === 0;

      if (!hasMatchingRouteTrail) {
        setFolderTrail([]);
        void resolveFolderTrail(assetFolderId).then((trail) => {
          setFolderTrail(trail);
        });
      }

      const workspace_name =
        (assetRow as any)?.workspaces?.name ??
        (assetRow as any)?.workspaces?.[0]?.name ??
        null;
      const project_name =
        routeProjectName ??
        (assetRow as any)?.projects?.name ??
        (assetRow as any)?.projects?.[0]?.name ??
        null;

      const rawAssetWithNames = { ...(assetRow as any), workspace_name, project_name } as Asset;
      const apiKeyIds = Array.from(new Set([
        rawAssetWithNames.created_by_api_key_id,
        rawAssetWithNames.uploaded_by_api_key_id,
        rawAssetWithNames.assigned_to_api_key_id,
        rawAssetWithNames.updated_by_api_key_id,
        ...((commentRows ?? []) as AssetComment[]).map((r) => r.author_api_key_id ?? null),
      ].filter(Boolean))) as string[];

      const [actorProfiles, rawRows] = await Promise.all([
        loadApiKeyActorProfiles(apiKeyIds),
        Promise.resolve((commentRows ?? []) as AssetComment[]),
      ]);

      const assetWithNames = mapApiKeyActorFields(rawAssetWithNames);
      setAsset((current) => {
        if (!current) return assetWithNames;
        return {
          ...assetWithNames,
          title: current.title || assetWithNames.title || current.name || assetWithNames.name || "Asset",
          name: current.name || assetWithNames.name || null,
          storage_path: current.storage_path || assetWithNames.storage_path,
          url: current.url || assetWithNames.url,
          cover_image_url: current.cover_image_url ?? assetWithNames.cover_image_url ?? null,
        };
      });

      const rows = rawRows.map(mapCommentActor);
      setComments(rows);
      if (loadSeq === loadSeqRef.current) setLoading(false);

      // Load versions after asset is set
      void loadVersions(assetWithNames);

      void (async () => {
        try {
          const organizationIdValue = workspaceData?.organization_id ?? null;
          if (loadSeq !== loadSeqRef.current) return;

          if (organizationIdValue) {
            setOrganizationId(organizationIdValue);

            const { data: authData, error: authError } = await supabase.auth.getUser();
            if (loadSeq !== loadSeqRef.current) return;
            const authUserId = authData?.user?.id ?? null;

            if (authError) {
              console.warn("Failed to determine current user:", authError);
            }

            const membershipPromise = authUserId
              ? supabase
                .from("organization_members")
                .select("role")
                .eq("organization_id", organizationIdValue)
                .eq("user_id", authUserId)
                .in("role", ["owner", "admin", "member", "billing"])
                .maybeSingle()
              : Promise.resolve({ data: null, error: null } as const);

            const apiKeysPromise = supabase
              .from("api_keys")
              .select("id, name, provider, icon_url")
              .eq("organization_id", organizationIdValue)
              .order("created_at", { ascending: false });

            const apiKeyIds = Array.from(new Set([
              rawAssetWithNames.created_by_api_key_id,
              rawAssetWithNames.uploaded_by_api_key_id,
              rawAssetWithNames.assigned_to_api_key_id,
              rawAssetWithNames.updated_by_api_key_id,
              ...((commentRows ?? []) as AssetComment[]).map((r) => r.author_api_key_id ?? null),
            ].filter(Boolean))) as string[];

            const userIds = Array.from(new Set([
              ...rows.map((r) => r.author_user_id),
              assetWithNames.assigned_to,
              assetWithNames.uploaded_by
            ])).filter((id): id is string => Boolean(id) && !isApiKeyActorProfileId(id));

            const mentionablePromise = invokeEdgeFunction('get-mentionable-users', {
              body: {
                projectId,
                organizationId: organizationIdValue,
                assetId
              }
            });

            const actorProfilesPromise = loadApiKeyActorProfiles(apiKeyIds);
            const profilesPromise = userIds.length
              ? supabase
                .from("profiles")
                .select("id, display_name, avatar_url")
                .in("id", userIds)
              : Promise.resolve({ data: null, error: null } as const);

            const [
              membershipResult,
              apiKeysResult,
              mentionableResult,
              actorProfilesResult,
              profilesResult,
            ] = await Promise.all([
              membershipPromise,
              apiKeysPromise,
              mentionablePromise,
              actorProfilesPromise,
              profilesPromise,
            ]);

            if (loadSeq !== loadSeqRef.current) return;

            if (membershipResult?.error) {
              console.warn("Failed to determine team membership:", membershipResult.error);
              setIsTeamMember(false);
            } else {
              setIsTeamMember(Boolean(membershipResult?.data));
            }

            if (apiKeysResult.error) {
              console.warn("Failed to load assignable developer keys:", apiKeysResult.error);
            } else {
              setAssignableAgents((apiKeysResult.data ?? []) as AssignableAgent[]);
            }

            if (mentionableResult.error) {
              console.warn("Failed to load mentionable users:", mentionableResult.error);
            } else {
              const mentionableUsers = mentionableResult.data?.users || [];
              setUserProfilesAccessToAsset(mentionableUsers as Profile[]);
            }

            const map: Record<string, Profile> = { ...actorProfilesResult };
            if (profilesResult.data) {
              for (const p of profilesResult.data as Profile[]) map[p.id] = p;
            }
            setProfiles(map);
          } else {
            setIsTeamMember(false);
          }
        } catch (backgroundError) {
          console.warn("Failed to hydrate review metadata", backgroundError);
        }
      })();
    } catch (e: any) {
      console.error("Failed to load asset/comments", e);
      setFolderTrail([]);
      // Determine error type based on error code
      if (e?.code === 'PGRST116') {
        setError("not_found");
      } else if (e?.message?.includes('access') || e?.message?.includes('permission')) {
        setError("access_denied");
      } else {
        setError("unknown");
      }
    } finally {
      if (loadSeq === loadSeqRef.current) {
        loadKeyRef.current = null;
      }
      if (!routeAsset) setLoading(false);
    }
  }

  async function loadShareLink(force = false): Promise<void> {
    if (!assetId) return;
    if (!force && shareLinkResolvedAssetId === assetId) return;

    setShareLinkLoading(true);
    try {
      const { data, error } = await invokeEdgeFunction("share", {
        body: { action: "list-asset-share-links", asset_id: assetId }
      });
      if (error) throw error;
      const links = (data?.data ?? []) as Array<{ id: string; revoked_at?: string | null }>;
      const active = links.find((link) => !link.revoked_at) ?? null;
      if (active) {
        setShareLinkId(active.id);
        // We use the ID as the token now, so we can reconstruct the link
        setShareLink(`${import.meta.env.VITE_APP_URL || window.location.origin}/share/${active.id}`);
      } else {
        setShareLinkId(null);
        setShareLink(null);
      }
      setShareLinkResolvedAssetId(assetId);
    } catch (err) {
      console.warn("Failed to load share link", err);
    } finally {
      setShareLinkLoading(false);
    }
  }

  async function handleOpenShareDialog() {
    if (!showShareDialog) {
      await loadShareLink();
    }
    setShowShareDialog(true);
  }

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, projectId, assetId]);



  useEffect(() => {
    if (!assetId) return;
    const channel = supabase
      .channel(`asset-comments:${assetId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "asset_comments", filter: `asset_id=eq.${assetId}` },
        (payload: RealtimePostgresChangesPayload<AssetComment>) => {
          if (payload.eventType === "INSERT" && payload.new) {
            const rawRow = payload.new as AssetComment;
            const row = mapCommentActor(rawRow);
            setComments((prev: AssetComment[]) => (prev.some((c) => c.id === row.id) ? prev : [...prev, row]));
            if (row.author_user_id && isApiKeyActorProfileId(row.author_user_id)) {
              if (!profiles[row.author_user_id] && rawRow.author_api_key_id) {
                void loadApiKeyActorProfiles([rawRow.author_api_key_id]).then((actorMap) => {
                  if (Object.keys(actorMap).length) {
                    setProfiles((m: Record<string, Profile>) => ({ ...m, ...actorMap }));
                  }
                });
              }
            } else if (row.author_user_id && !profiles[row.author_user_id]) {
              supabase
                .from("profiles")
                .select("id, display_name, avatar_url")
                .eq("id", row.author_user_id)
                .maybeSingle()
                .then((res: { data: any } | { data: Profile | null } | any) => {
                  const data = (res?.data ?? null) as Profile | null;
                  if (data) setProfiles((m: Record<string, Profile>) => ({ ...m, [data.id]: data }));
                });
            }
          } else if (payload.eventType === "UPDATE" && payload.new) {
            setComments((prev: AssetComment[]) =>
              prev.map((c: AssetComment) => (c.id === (payload.new as AssetComment).id ? mapCommentActor(payload.new as AssetComment) : c))
            );
          } else if (payload.eventType === "DELETE" && payload.old) {
            setComments((prev: AssetComment[]) => prev.filter((c: AssetComment) => c.id !== (payload.old as AssetComment).id));
          }
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [assetId, profiles]);

  const isVideo = Boolean(asset?.mime_type && asset.mime_type.startsWith("video/"));
  const isPdf = asset?.mime_type === "application/pdf";
  const reviewImageUrl = (() => {
    const rawPath = asset?.storage_path || asset?.url || "";
    if (!rawPath) return "";
    if (rawPath.startsWith("http")) return rawPath;
    const proxy = import.meta.env.VITE_ASSET_PUBLIC_BASE_URL || "";
    const base = proxy.endsWith("/") ? proxy.slice(0, -1) : proxy;
    const path = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
    return `${base}${path}`;
  })();
  const assetDisplayName = asset?.title || asset?.name || "Asset";
  const isUnsupportedDesignPreview = isDesignPreviewUnavailableAsset({
    mime_type: asset?.mime_type,
    name: asset?.name,
    title: assetDisplayName,
    url: asset?.url,
    storage_path: asset?.storage_path,
  });
  const designAssetLabel = getDesignAssetLabel({
    mime_type: asset?.mime_type,
    name: asset?.name,
    title: assetDisplayName,
    url: asset?.url,
    storage_path: asset?.storage_path,
  });
  const [probedImageDimensions, setProbedImageDimensions] = useState<ImageDimensions | null>(null);
  const [imageProbeSettled, setImageProbeSettled] = useState(false);

  useEffect(() => {
    setProbedImageDimensions(null);
    setImageProbeSettled(false);

    if (isVideo || isPdf || isUnsupportedDesignPreview || !asset?.mime_type?.startsWith("image/") || !reviewImageUrl) {
      setImageProbeSettled(true);
      return;
    }

    let active = true;
    const probe = new window.Image();
    probe.onload = () => {
      if (!active) return;
      setProbedImageDimensions({
        width: probe.naturalWidth,
        height: probe.naturalHeight,
      });
      setImageProbeSettled(true);
    };
    probe.onerror = () => {
      if (!active) return;
      setImageProbeSettled(true);
    };
    probe.src = reviewImageUrl;

    return () => {
      active = false;
    };
  }, [asset?.mime_type, isPdf, isUnsupportedDesignPreview, isVideo, reviewImageUrl]);

  const baseWebsiteScreenshot = isLikelyWebsiteScreenshot(asset);
  const isWebsiteScreenshot = !isVideo && isLikelyWebsiteScreenshot(asset, probedImageDimensions);
  const pendingImageReviewerType = !isUnsupportedDesignPreview && !isVideo && !isPdf && asset?.mime_type?.startsWith("image/") && !baseWebsiteScreenshot && !imageProbeSettled;



  const playerAnnotations = useMemo<Annotation[]>(() => {
    const normed = comments.map((c: AssetComment) => {
      const timeSec = Number.isFinite(c.ms_offset as number) ? (c.ms_offset as number) / 1000 : Number.NaN;
      const base = normalizeAnnotation({
        ...c,
        time: timeSec,
        drawing: c.drawing_json,
        author: c.guest_name ?? undefined,
      });
      return {
        ...base,
        author: profiles[c.author_user_id]?.display_name ?? c.guest_name ?? base.author,
        isCompleted: c.status === 'completed',
        isDeleted: c.status === 'deleted',
        // authorId is now handled by normalizeAnnotation
      } as Annotation;
    });
    return isVideo ? normed.filter((a: Annotation) => Number.isFinite(a.time) && (a.time as number) >= 0) : normed;
  }, [comments, profiles, isVideo]);
  const exportableMarkerComments = useMemo(
    () => playerAnnotations.filter((annotation) => !annotation.isDeleted && Number.isFinite(annotation.time) && annotation.time >= 0 && annotation.text.trim()),
    [playerAnnotations]
  );
  const markerExportBaseName = useMemo(() => safeMarkerExportBaseName(assetDisplayName), [assetDisplayName]);

  function handleExportPremiereMarkers() {
    if (exportableMarkerComments.length === 0) {
      toast.info("No timecoded comments to export.");
      return;
    }

    downloadTextFile(
      `${markerExportBaseName}-premiere-markers.csv`,
      buildPremiereMarkersCsv(exportableMarkerComments),
      "text/csv;charset=utf-8"
    );
    toast.success("Premiere Pro marker CSV exported.");
  }

  function handleExportResolveMarkers() {
    if (exportableMarkerComments.length === 0) {
      toast.info("No timecoded comments to export.");
      return;
    }

    downloadTextFile(
      `${markerExportBaseName}-resolve-markers.edl`,
      buildDaVinciResolveMarkersEdl(exportableMarkerComments, { title: assetDisplayName }),
      "text/plain;charset=utf-8"
    );
    toast.success("DaVinci Resolve marker EDL exported.");
  }

  const MOCK_VIDEO_URL = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4";

  async function handleAddAnnotation(a: Annotation) {
    if (!assetId) return;

    const submitComment = async (): Promise<void> => {
      try {
        const payload = {
          asset_id: assetId,
          body: a.text,
          ms_offset: Number.isFinite(a.time) ? Math.round((a.time as number) * 1000) : null,
          drawing_json: a.page != null ? { page: a.page, strokes: a.drawing ?? [] } : a.drawing ?? null,
        } as const;

        const { data: resData, error } = await invokeEdgeFunction<{ data: AssetComment }>("comment", {
          body: payload,
        });

        if (error) throw error;

        const data = resData?.data;
        if (!data?.id) throw new Error("Comment API did not return the created comment.");

        // Load current user's profile if not already loaded
        const userId = data.author_user_id;
        if (userId && !profiles[userId]) {
          try {
            const { data: profile } = await supabase
              .from("profiles")
              .select("id, display_name, avatar_url")
              .eq("id", userId)
              .single();

            if (profile) {
              setProfiles(prev => ({
                ...prev,
                [userId]: profile
              }));
            }
          } catch (e) {
            console.error("Failed to load user profile", e);
          }
        }

        setComments((prev: AssetComment[]) =>
          prev.some((c: AssetComment) => c.id === data.id) ? prev : [...prev, data]
        );

        toast.success("Comment added");
      } catch (e: any) {
        console.error("Failed to persist annotation", e);
        const errorMessage = e?.message || "Unknown error";
        toast.error(`Failed to add comment: ${errorMessage}`);
      }
    };

    await submitComment();
  }

  // status update (supports NULL)
  async function handleChangeStatus(nextStatus: Asset["status"] | null) {
    if (!asset || !assetId || !workspaceId || nextStatus === asset.status) return;
    const prev = asset.status ?? null;
    setStatusSaving(true);
    setAsset({ ...asset, status: nextStatus }); // optimistic
    try {
      const response = await updateAsset({
        id: assetId, status: nextStatus,
      });
      const data = await response.json();
      const error = data?.error;
      if (error) throw error;
    } catch {
      setAsset((a: Asset | null) => (a ? { ...a, status: prev } : a));
    } finally {
      setStatusSaving(false);
    }
  }

  async function handleRequestRevision() {
    if (!asset || !assetId) return;
    if (!isTeamMember) {
      toast.error("Only team members can request revision.");
      return;
    }

    if (latestVersion && latestVersion.id !== assetId) {
      const confirmed = window.confirm(
        `You're viewing v${asset.version_no ?? 1}, but v${latestVersion.version_no ?? 1} is available. Request revision on this older version anyway?`
      );
      if (!confirmed) return;
    }

    const previousStatus = asset.status ?? null;
    setRequestRevisionSaving(true);
    setAsset({ ...asset, status: "needs_review" });

    try {
      const response = await requestAssetRevision({ id: assetId });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || data?.error) {
        throw new Error(data?.error || "Failed to request revision");
      }

      toast.success("Revision requested.");
    } catch (error) {
      console.error("Failed to request revision", error);
      setAsset((current) => (current ? { ...current, status: previousStatus } : current));
      toast.error(error instanceof Error ? error.message : "Failed to request revision");
    } finally {
      setRequestRevisionSaving(false);
    }
  }

  if (!canQuery) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>Missing parameters</CardTitle>
            <CardDescription>
              This page expects route params <code>workspaceId</code> and <code>assetId</code>.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }



  const updatedAt = asset?.uploaded_at ?? asset?.created_at ?? null;
  const latestVersion = versions[0] ?? null;
  const latestVersionNumber = latestVersion?.version_no ?? null;
  const isLatestVersion = !latestVersion || latestVersion.id === assetId;
  const versionBadgeLabel = isLatestVersion
    ? "Latest"
    : latestVersionNumber
      ? `v${latestVersionNumber} available`
      : "Outdated";
  const hasRevisionAssignee = Boolean(asset?.assigned_to || asset?.assigned_to_api_key_id);
  const showRequestRevision = hasRevisionAssignee;
  const canRequestRevision =
    hasRevisionAssignee &&
    isTeamMember &&
    !statusSaving &&
    !requestRevisionSaving;

  const requestRevisionTitle = !hasRevisionAssignee
    ? "Assign this asset before requesting revision"
    : !isTeamMember
      ? "Only team members can request revision"
      : undefined;

  const assignOptions: AssignOption[] = (() => {
    const userOptions: AssignOption[] = user_profiles_access_to_asset.map((profile) => ({
      kind: "user",
      id: profile.id,
      label: profile.display_name ?? profile.id,
      avatar_url: profile.avatar_url ?? undefined,
    }));

    const agentOptions: AssignOption[] = assignableAgents.map((agent) => ({
      kind: "agent",
      id: agent.id,
      label: agent.name,
      avatar_url: getApiKeyActorIconUrl(agent) ?? undefined,
      provider: agent.provider,
    }));

    return [...userOptions, ...agentOptions];
  })();

  const currentAssignee = (() => {
    if (!asset?.assigned_to) return null;
    return assignOptions.find((option) =>
      option.kind === "user"
        ? option.id === asset.assigned_to
        : apiKeyActorProfileId(option.id) === asset.assigned_to
    ) ?? null;
  })();

  async function handleAssignTo(option: AssignOption): Promise<void> {
    if (!asset || !assetId || !workspaceId) return;
    const previousAssignedTo = asset.assigned_to ?? null;
    const previousAssignedToApiKeyId = asset.assigned_to_api_key_id ?? null;

    const nextAssignedTo =
      option.kind === "user" ? option.id : apiKeyActorProfileId(option.id);
    const nextAssignedToApiKeyId =
      option.kind === "agent" ? option.id : null;

    setAsset({
      ...asset,
      assigned_to: nextAssignedTo,
      assigned_to_api_key_id: nextAssignedToApiKeyId,
    });

    if (option.kind === "agent") {
      const agent = assignableAgents.find((item) => item.id === option.id);
      if (agent) {
        const actorProfile = toApiKeyActorProfile(agent);
        setProfiles((prev) => ({ ...prev, [actorProfile.id]: actorProfile }));
      }
    }

    try {
      const response = await updateAsset({
        id: assetId,
        assigned_to: option.kind === "user" ? option.id : null,
        assigned_to_api_key_id: option.kind === "agent" ? option.id : null,
      });
      const data = await response.json();
      const error = data?.error;
      if (error) throw error;
    } catch (e) {
      console.error("Failed to assign user", e);
      setAsset((a: Asset | null) => (a ? {
        ...a,
        assigned_to: previousAssignedTo,
        assigned_to_api_key_id: previousAssignedToApiKeyId,
      } : a));
    }
  }

  async function handleAssetMetadataSave(patch: { description: string | null; tags: string[] }): Promise<void> {
    if (!asset || !assetId) return;
    const previous = {
      description: asset.description ?? null,
      tags: Array.isArray(asset.tags) ? asset.tags : [],
    };
    const next = {
      description: patch.description,
      tags: Array.isArray(patch.tags) ? patch.tags : [],
    };

    setAsset((current) => (current ? { ...current, ...next } : current));

    try {
      const response = await updateAsset({
        id: assetId,
        description: next.description,
        tags: next.tags,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.error) {
        throw new Error(data?.error || "Failed to save asset metadata");
      }
      toast.success("Asset metadata saved");
    } catch (error) {
      setAsset((current) => (current ? { ...current, ...previous } : current));
      throw error instanceof Error ? error : new Error("Failed to save asset metadata");
    }
  }

  function handleVersionChange(versionAssetId: string): void {
    const folderId = asset?.folder_id ?? folderTrail[folderTrail.length - 1]?.id ?? null;
    const folderQuery = folderId ? `?folder=${encodeURIComponent(folderId)}` : "";
    const state = {
      folderTrail: folderTrail.map((folder) => ({
        id: folder.id,
        name: folder.name,
        parent_folder_id: folder.parent_folder_id ?? null,
        project_id: folder.project_id ?? null,
      })),
    };

    if (projectId) {
      navigate(`/workspace/${workspaceId}/projects/${projectId}/assets/${versionAssetId}${folderQuery}`, { state });
    } else {
      navigate(`/workspace/${workspaceId}/assets/${versionAssetId}${folderQuery}`, { state });
    }
  }



  function handleManageVersions(): void {
    // Since VersionStackCard manages its own dialog state internally,
    // we need to trigger its internal dialog. For now, let's use a simple dialog.
    setShowVersionsDialog(true);
  }

  async function handleVersionsReorder(payload: { orderedIds: string[]; removedIds: string[] }): Promise<void> {
    try {
      console.log("Reordering versions:", payload);

      // Use the proper edge function for reordering versions
      const { data, error } = await invokeEdgeFunction('reorder-versions', {
        body: {
          orderedIds: payload.orderedIds,
          removedIds: payload.removedIds,
        },
      });

      if (error) {
        console.error("Edge function error:", error);
        throw new Error("Failed to reorder versions: " + error.message);
      }

      if (data && !data.ok) {
        console.error("Server reported failure:", data);
        throw new Error("Server reported failure");
      }

      // Refresh both asset and versions data from the server after successful reorder
      if (asset) {
        // Reload the current asset to get updated version_no with project/workspace names
        const { data: updatedAssetRow, error: assetError } = await supabase
          .from("assets")
          .select("*, workspaces:workspaces!assets_workspace_id_fkey(name), projects:projects!assets_project_id_fkey(name)")
          .eq("id", assetId)
          .eq("workspace_id", workspaceId!)
          .single();

        if (!assetError && updatedAssetRow) {
          // Extract workspace and project names from joined data
          const workspace_name =
            (updatedAssetRow as any)?.workspaces?.name ??
            (updatedAssetRow as any)?.workspaces?.[0]?.name ??
            asset.workspace_name; // Preserve existing name if not found
          const project_name =
            projectId
              ? asset.project_name
              : (
                (updatedAssetRow as any)?.projects?.name ??
                (updatedAssetRow as any)?.projects?.[0]?.name ??
                asset.project_name
              );

          const updatedAsset = { ...(updatedAssetRow as any), workspace_name, project_name } as Asset;
          setAsset(updatedAsset);
          await loadVersions(updatedAsset);
        } else {
          // If current asset was detached (made independent), it might have lost its parent_asset_id
          // Refresh versions and check if we need to redirect to a different version
          await loadVersions(asset);

          // If the current asset was detached and there are remaining versions in the stack,
          // we might want to redirect to the top version, but for now just refresh
        }
      }

      console.log("Version reorder completed successfully");
    } catch (error) {
      console.error("Failed to reorder versions:", error);
      throw error; // Re-throw so dialog can handle the error
    }
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Tight, sticky header */}
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 flex-shrink-0">
        <div className="flex flex-col gap-2 px-3 py-3 md:h-14 md:flex-row md:items-center md:gap-3 md:py-0">
          {/* Left: breadcrumb + title */}
          <div className="min-w-0 flex-1 overflow-hidden">
            <div className="flex items-start gap-2 md:items-center">
              <div className="flex shrink-0 items-center gap-2">
                <SidebarTrigger className="-ml-1" />
                <Separator orientation="vertical" className="mr-1 hidden data-[orientation=vertical]:h-4 md:block" />
              </div>
              <Breadcrumb className="min-w-0">
                <BreadcrumbList className="flex flex-wrap items-center gap-y-2 truncate">
                  {projectId ? (
                    <>
                      <BreadcrumbItem className="hidden md:block">
                        <div className="flex items-center gap-2">
                          <BreadcrumbLink asChild>
                            <Link to={`/workspace/${workspaceId}/projects/${projectId}`}>
                              {asset?.project_name ?? "Project"}
                            </Link>
                          </BreadcrumbLink>
                        </div>
                      </BreadcrumbItem>
                      <BreadcrumbSeparator className="hidden md:block" />
                    </>
                  ) : (
                    <>
                      <BreadcrumbItem className="hidden md:block">
                        <div className="flex items-center gap-2">
                          <BreadcrumbLink asChild>
                            <Link to={`/workspace/${workspaceId}/assets`}>
                              Library
                            </Link>
                          </BreadcrumbLink>
                        </div>
                      </BreadcrumbItem>
                      <BreadcrumbSeparator className="hidden md:block" />
                    </>
                  )}
                  {folderTrail.map((folder) => (
                    <div key={folder.id} className="contents">
                      <BreadcrumbItem className="hidden md:block">
                        <BreadcrumbLink asChild>
                          <Link
                            to={
                              projectId
                                ? `/workspace/${workspaceId}/projects/${projectId}?folder=${folder.id}`
                                : `/workspace/${workspaceId}/assets?folder=${folder.id}`
                            }
                          >
                            {folder.name}
                          </Link>
                        </BreadcrumbLink>
                      </BreadcrumbItem>
                      <BreadcrumbSeparator className="hidden md:block" />
                    </div>
                  ))}
                  <BreadcrumbItem>
                    <BreadcrumbPage className="flex flex-wrap items-center gap-2 truncate">
                      <span className="max-w-full truncate text-sm sm:text-base">{assetDisplayName}</span>
                      {/* TODO: Add edit asset name */}
                      {/* <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 text-muted-foreground hover:text-foreground"
                        onClick={handleEditAsset}
                        title="Edit asset name"
                      >
                        <Pencil className="h-3 w-3" />
                      </Button> */}
                      {versions.length > 1 ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm" className="h-6 px-2 text-xs">
                              v{asset?.version_no ?? 1}
                              <ChevronDown className="h-3 w-3 ml-1" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" className="w-80">
                            <DropdownMenuLabel>Versions</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            {versions.map((version) => (
                              <DropdownMenuItem
                                key={version.id}
                                onClick={() => handleVersionChange(version.id)}
                                className="cursor-pointer p-3 h-auto"
                              >
                                <div className="flex w-full items-center gap-3">
                                  {/* Cover Image */}
                                  <AssetVersionThumbnail version={version} mimeType={asset?.mime_type} unsupportedDesignPreview={isUnsupportedDesignPreview} />

                                  {/* Version Info */}
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium">
                                        v{version.version_no ?? 1}
                                      </span>
                                      {version.status && (
                                        <Badge variant="secondary" className="text-xs">
                                          {version.status.replace(/_/g, " ")}
                                        </Badge>
                                      )}
                                    </div>
                                    <div className="text-xs text-muted-foreground truncate">
                                      {version.title} • {formatTimetoDayMonth(version.created_at)}
                                    </div>
                                  </div>

                                  {/* Current indicator */}
                                  {version.id === assetId && (
                                    <Check className="h-4 w-4 text-green-600 flex-shrink-0" />
                                  )}
                                </div>
                              </DropdownMenuItem>
                            ))}

                            {/* Management Options */}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                handleManageVersions();
                              }}
                              className="cursor-pointer"
                            >
                              <Layers className="mr-2 h-4 w-4" />
                              Manage versions
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                const compareRootId = asset?.parent_asset_id || assetId;
                                const folderId = asset?.folder_id ?? folderTrail[folderTrail.length - 1]?.id ?? null;
                                const folderQuery = folderId ? `?folder=${encodeURIComponent(folderId)}` : "";
                                if (projectId) {
                                  navigate(`/workspace/${workspaceId}/projects/${projectId}/assets/${compareRootId}/compare${folderQuery}`);
                                  return;
                                }
                                navigate(`/workspace/${workspaceId}/assets/${compareRootId}/compare${folderQuery}`);
                              }}
                              className="cursor-pointer"
                            >
                              <GitCompare className="h-4 w-4 mr-2" />
                              Compare versions
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        <Button variant="outline" size="sm" className="h-6 px-2 text-xs" disabled>
                          v{asset?.version_no ?? 1}
                        </Button>
                      )}
                      <Badge
                        variant="outline"
                        className={cn(
                          "h-6 rounded-full px-2 text-[11px] font-medium",
                          isLatestVersion
                            ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-100"
                            : "border-amber-500/25 bg-amber-500/10 text-amber-100"
                        )}
                      >
                        {versionBadgeLabel}
                      </Badge>
                    </BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
            </div>
          </div>

          {/* Right: assigned_to + status + actions */}
          <div className="flex w-full flex-wrap items-center gap-2 md:ml-auto md:w-auto md:flex-nowrap md:justify-end md:gap-3 shrink-0">
            {/* Share Button linked to Dialog */}
            <Button
              variant="outline"
              size="default"
              className="gap-1.5 hover:bg-primary/90 shrink-0 hidden sm:flex"
              onClick={() => void handleOpenShareDialog()}
              disabled={shareLinkLoading}
            >
              {shareLinkLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <span>Share</span>}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 shrink-0 sm:hidden"
              onClick={() => void handleOpenShareDialog()}
              disabled={shareLinkLoading}
            >
              {shareLinkLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
            </Button>
            <div className="hidden sm:flex min-w-0 items-center gap-2">
              {/* create a drop down for assigned_to */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="lg"
                    className={cn(
                      "h-10 max-w-[16rem] justify-between gap-2 rounded-xl border-border/70 px-3 text-left shadow-sm",
                      currentAssignee ? "min-w-[12rem]" : "min-w-[7.5rem]",
                    )}
                  >
                    {currentAssignee ? (
                      <span className="inline-flex min-w-0 flex-1 items-center gap-2">
                        <AssignAvatar option={currentAssignee} />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium normal-case">
                          {currentAssignee.label}
                        </span>
                      </span>
                    ) : (
                      <span className="inline-flex min-w-0 flex-1 items-center gap-2 text-sm font-medium normal-case">
                        <UserPlus className="h-4 w-4 shrink-0 text-muted-foreground" />
                        Assign
                      </span>
                    )}
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72 rounded-xl p-1">
                  <DropdownMenuLabel>Assign</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {assignOptions.map((option) => (
                    <DropdownMenuItem
                      key={`${option.kind}:${option.id}`}
                      onClick={() => handleAssignTo(option)}
                      className="cursor-pointer rounded-lg px-2 py-2"
                    >
                      <span className="flex w-full min-w-0 items-center justify-between gap-3">
                        <span className="flex min-w-0 items-center gap-2.5">
                          <AssignAvatar option={option} className="h-7 w-7" />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">{option.label}</span>
                            <span className="block text-xs capitalize text-muted-foreground">
                              {option.kind === "agent" ? "Developer key" : "Team member"}
                            </span>
                          </span>
                        </span>
                        {currentAssignee?.kind === option.kind && currentAssignee.id === option.id ? (
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                            <Check className="h-3.5 w-3.5" />
                          </span>
                        ) : null}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={requestRevisionSaving}
                  className="uppercase whitespace-nowrap"
                >
                  {statusSaving ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Saving…
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <StatusBadge status={asset?.status ?? null} />
                      <ChevronDown className="h-4 w-4 shrink-0" />
                    </span>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Set status</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={statusSaving || requestRevisionSaving}
                  onClick={() => handleChangeStatus(null)}
                  className="uppercase cursor-pointer"
                >
                  <span className="flex w-full items-center justify-between">
                    <StatusBadge status={null} />
                  </span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {STATUS_OPTIONS.map((s) => {
                  return (
                    <DropdownMenuItem
                      key={s}
                      disabled={statusSaving || requestRevisionSaving}
                      onClick={() => handleChangeStatus(s)}
                      className="uppercase cursor-pointer"
                    >
                      <span className="flex w-full items-center justify-between">
                        <StatusBadge status={s} />
                      </span>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>

            {showRequestRevision && (
              <Button
                size="sm"
                variant="outline"
                disabled={!canRequestRevision}
                title={requestRevisionTitle}
                className={cn(
                  "shadow-none shrink-0",
                  canRequestRevision
                    ? "border-amber-500/25 bg-amber-500/10 text-amber-100 hover:border-amber-400/30 hover:bg-amber-500/15 hover:text-amber-50"
                    : "border-amber-500/10 bg-amber-500/5 text-amber-100/45 hover:border-amber-500/10 hover:bg-amber-500/5 hover:text-amber-100/45"
                )}
                onClick={() => void handleRequestRevision()}
              >
                {requestRevisionSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="hidden sm:inline">Requesting…</span>
                  </>
                ) : (
                  <>
                    <RotateCcw className="h-4 w-4" />
                    <span className="hidden sm:inline">Request revision</span>
                  </>
                )}
              </Button>
            )}

            {asset?.status !== "approved" && (
              <Button
                size="sm"
                disabled={statusSaving || requestRevisionSaving}
                className="shrink-0 border border-emerald-500/25 bg-emerald-500/12 text-emerald-100 shadow-none hover:bg-emerald-500/18 hover:text-emerald-50"
                onClick={() => handleChangeStatus("approved")}
              >
                <Check className="h-4 w-4" />
                <span className="inline sm:inline">Approve</span>
              </Button>
            )}
            {isVideo && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    disabled={exportableMarkerComments.length === 0}
                    title={exportableMarkerComments.length === 0 ? "No timecoded comments to export" : "Export comments as editor markers"}
                  >
                    <FileDown className="h-4 w-4" />
                    <span className="hidden lg:inline">Export markers</span>
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuLabel>Export timecoded comments</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleExportPremiereMarkers}>
                    Premiere Pro marker CSV
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleExportResolveMarkers}>
                    DaVinci Resolve marker EDL
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button variant="outline" size="sm" className="shrink-0" onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              const rawUrl = asset?.url || asset?.storage_path;
              if (rawUrl) {
                let downloadUrl = "";
                if (rawUrl.startsWith("http")) {
                  downloadUrl = rawUrl;
                } else {
                  const proxy = import.meta.env.VITE_ASSET_PUBLIC_BASE_URL || "";
                  const base = proxy.endsWith("/") ? proxy.slice(0, -1) : proxy;
                  const path = rawUrl.startsWith("/") ? rawUrl : `/${rawUrl}`;
                  downloadUrl = `${base}${path}`;
                }
                void downloadFile(downloadUrl, assetDisplayName);
              }
            }}>
              <DownloadIcon className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Version Management Dialog */}
      <ManageVersionStackDialog
        isOpen={showVersionsDialog}
        onClose={() => setShowVersionsDialog(false)}
        versions={versions.map(v => ({
          ...v,
          cover_image_url: v.cover_image_url,
          mime_type: asset?.mime_type || null
        }))}
        currentAssetId={assetId}
        onSave={handleVersionsReorder}
      />

      {/* Main content area - flex-1 takes remaining height */}
      <div className="flex-1 min-h-0">
        {error ? (
          <AssetNotFound
            workspaceId={workspaceId}
            projectId={projectId}
            assetId={assetId}
            error={error}
            onRetry={() => {
              setError(null);
              void loadData();
            }}
          />
        ) : loading ? (
          <LoadingSkeleton />
        ) : (
          <div className="flex flex-col h-full">
            {isVideo ? (
              <VideoPlayerWithAnnotations
                title={assetDisplayName}
                videoUrl={reviewImageUrl}
                poster={asset?.cover_image_url}
                annotations={playerAnnotations}
                onAddAnnotation={handleAddAnnotation}
                projectId={projectId}
                organizationId={organizationId}
                workspaceId={workspaceId}
                assetId={assetId}
                asset={asset}
                onAssetMetadataSave={handleAssetMetadataSave}
                profiles={profiles}
              />
            ) : isPdf ? (
              <PdfAnnotatorWithAnnotations
                title={assetDisplayName}
                pdfUrl={reviewImageUrl}
                annotations={playerAnnotations}
                onAddAnnotation={handleAddAnnotation}
                projectId={projectId}
                organizationId={organizationId}
                workspaceId={workspaceId}
                assetId={assetId}
                asset={asset}
                onAssetMetadataSave={handleAssetMetadataSave}
                profiles={profiles}
              />
            ) : isUnsupportedDesignPreview ? (
              <UnsupportedAssetPreview
                title={assetDisplayName}
                fileTypeLabel={designAssetLabel}
                downloadUrl={reviewImageUrl || null}
                downloadName={assetDisplayName}
              />
            ) : pendingImageReviewerType ? (
              <LoadingSkeleton />
            ) : isWebsiteScreenshot ? (
              <WebScreenshotReview
                title={assetDisplayName}
                imageUrl={reviewImageUrl}
                annotations={playerAnnotations}
                onAddAnnotation={handleAddAnnotation}
                projectId={projectId}
                organizationId={organizationId}
                workspaceId={workspaceId}
                assetId={assetId}
                asset={asset}
                onAssetMetadataSave={handleAssetMetadataSave}
                profiles={profiles}
              />
            ) : (
              <ImageAnnotatorWithAnnotations
                hideHeader
                title={assetDisplayName}
                imageUrl={reviewImageUrl}
                annotations={playerAnnotations}
                onAddAnnotation={handleAddAnnotation}
                projectId={projectId}
                organizationId={organizationId}
                workspaceId={workspaceId}
                assetId={assetId}
                asset={asset}
                onAssetMetadataSave={handleAssetMetadataSave}
                profiles={profiles}
              />
            )}
          </div>
        )}
      </div>
      {showShareDialog && (
        <ShareAssetDialog
          open={showShareDialog}
          onOpenChange={setShowShareDialog}
          assetTitle={assetDisplayName}
          assetVersion={asset?.version_no ?? 1}
          existingShareUrl={shareLink}
          onCreateLink={async ({ expiresAt, allowDownload }) => {
            if (!assetId) throw new Error("Missing asset id");
            const { data, error } = await invokeEdgeFunction("share", {
              body: {
                action: "create-asset-share-link",
                asset_id: assetId,
                expires_at: expiresAt ? expiresAt.toISOString() : null,
                allow_download: allowDownload,
                allow_comments: true,
              }
            });
            if (error) throw error;
            const url = data?.data?.share_url as string | undefined;
            const linkId = data?.data?.id as string | undefined;
            if (linkId) setShareLinkId(linkId);
            if (url) setShareLink(url);
            return url ?? "";
          }}
          onRevokeLink={async () => {
            if (!shareLinkId) return;
            const { error } = await invokeEdgeFunction("share", {
              body: { action: "revoke-asset-share-link", share_link_id: shareLinkId }
            });
            if (error) throw error;
            setShareLink(null);
            setShareLinkId(null);
          }}
        />
      )}
    </div>
  );
}
