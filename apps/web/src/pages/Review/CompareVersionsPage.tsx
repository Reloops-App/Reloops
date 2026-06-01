import CompareVersions from "@/components/review/CompareVersions";
import { Button } from "@/components/ui/button";
import { Layers, Upload } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { normalizeAssets } from "@/lib/assetUtils";
import {
  apiKeyActorProfileId,
  loadApiKeyActorProfiles,
} from "@/lib/api-key-actors";

type VersionRow = {
  id: string;
  title?: string | null;
  mime_type?: string | null;
  cover_image_url?: string | null;
  uploaded_at?: string | null;
  uploaded_by?: string | null;
  storage_path?: string | null;
  version_no?: number | null;
};

type CommentRow = {
  id: string;
  asset_id: string;
  author_user_id: string | null;
  author_api_key_id?: string | null;
  created_at: string;
  status?: string | null;
  body?: string | null;
  ms_offset?: number | null;
  drawing_json?: unknown;
};

type ProfileRow = {
  id: string;
  display_name?: string | null;
  avatar_url?: string | null;
};

type NormalizedAsset = {
  id: string;
  type?: string | null;
  coverUrl?: string | null;
  url?: string | null;
  name?: string | null;
  version?: number | null;
  __raw?: {
    storage_path?: string | null;
    version_no?: number | null;
  };
};

export default function CompareVersionsPage() {
  // route params: workspaceId, projectId, parentAssetId (root asset id)
  const { workspaceId, projectId, parentAssetId } = useParams();

  const [versions, setVersions] = useState<NormalizedAsset[] | undefined>(undefined);
  const [allComments, setAllComments] = useState<CommentRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileRow>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // require a parentAssetId in the new route. if missing, we don't fetch.
    if (!parentAssetId) return;
    let mounted = true;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        // fetch all assets that belong to the same root (parent_asset_id)
        const { data, error } = await supabase
          .from("assets")
          .select(
            "id, title, mime_type, cover_image_url, uploaded_at, uploaded_by, storage_path, version_no"
          )
          .or(`parent_asset_id.eq.${parentAssetId},id.eq.${parentAssetId}`)
          .order("version_no", { ascending: false });

        if (error) {
          if (mounted) setError(error.message || String(error));
          return;
        }

        const normalized = normalizeAssets((data ?? []) as VersionRow[]) as NormalizedAsset[];
        // map to the Version shape expected by CompareVersions component
        const mapped = normalized.map((a) => ({
          id: a.id,
          type: a.type && a.type.startsWith("image") ? "image" : a.type && a.type.startsWith("video") ? "video" : "image",
          coverUrl: a.coverUrl,
          src: a.__raw?.storage_path ? (import.meta.env.VITE_ASSET_PUBLIC_BASE_URL + a.__raw.storage_path) : (a.url || a.coverUrl || ""),
          title: a.name,
          version_no: a.version || a.__raw?.version_no,
        }));

        if (mounted) setVersions(mapped);

        // Fetch comments for all these versions
        const versionIds = data ? (data as VersionRow[]).map((d) => d.id) : [];
        if (versionIds.length > 0) {
          const { data: commentsData, error: commentsError } = await supabase
            .from("asset_comments")
            .select("*")
            .in("asset_id", versionIds)
            .neq("status", "deleted")
            .order("created_at", { ascending: true });

          if (!commentsError && commentsData) {
            const typedComments = commentsData as CommentRow[];
            const apiKeyIds = Array.from(new Set(typedComments.map((c) => c.author_api_key_id).filter(Boolean))) as string[];
            const authorIds = Array.from(new Set(
              typedComments
                .filter((c) => !c.author_api_key_id && c.author_user_id)
                .map((c) => c.author_user_id as string)
            ));

            const [actorProfiles, profilesData] = await Promise.all([
              loadApiKeyActorProfiles(apiKeyIds),
              authorIds.length > 0
                ? supabase
                    .from("profiles")
                    .select("id, display_name, avatar_url")
                    .in("id", authorIds)
                    .then((res) => res.data ?? [])
                : Promise.resolve([]),
            ]);

            const profileMap: Record<string, ProfileRow> = { ...actorProfiles };
            profilesData.forEach((p) => { profileMap[p.id] = p; });

            const mappedComments = typedComments.map((c) =>
              c.author_api_key_id
                ? { ...c, author_user_id: apiKeyActorProfileId(c.author_api_key_id) }
                : c
            );

            if (mounted) {
              setAllComments(mappedComments);
              setProfiles(profileMap);
            }
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (mounted) setError(message);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [parentAssetId, workspaceId, projectId]);

  return (
    <div className="p-4 sm:p-6 w-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SidebarTrigger className="-ml-1" />
          <Layers className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Compare versions</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm">
            <Upload className="mr-2 h-4 w-4" /> Upload version
          </Button>
        </div>
      </div>

      {/* Pass real versions when available, otherwise fallback to component defaults */}
      <CompareVersions versions={versions} allComments={allComments} profiles={profiles} />

      {loading && <div className="text-sm text-muted-foreground mt-3">Loading versions…</div>}
      {error && <div className="text-sm text-destructive mt-3">{error}</div>}
      {!loading && !error && !versions && (
        <div className="text-sm text-muted-foreground mt-3">No asset specified — open an asset's compare page to load real versions.</div>
      )}
    </div>
  );
}
