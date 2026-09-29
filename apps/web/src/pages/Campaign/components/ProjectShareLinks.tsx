import { useEffect, useState } from "react";
import { invokeEdgeFunction } from "@/api/edge";
import { toast } from "sonner";
import {
    Table,
    TableHeader,
    TableRow,
    TableHead,
    TableBody,
    TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { RefreshCw, Link as LinkIcon, Copy, Trash2, ExternalLink, FolderOpen, Lock, Upload, Download, MessageSquare, CalendarClock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal } from "lucide-react";

type AssetShareLink = {
    kind: "asset";
    id: string;
    created_at: string;
    expires_at: string | null;
    revoked_at: string | null;
    access_count: number;
    last_accessed_at: string | null;
    allow_download?: boolean;
    allow_comments?: boolean;
    assets: { id: string; title: string; mime_type: string; storage_path: string };
};

type ProjectShareLink = {
    kind: "project";
    id: string;
    created_at: string;
    expires_at: string | null;
    revoked_at: string | null;
    access_count: number;
    last_accessed_at: string | null;
    allow_upload: boolean;
    allow_download?: boolean;
    allow_comments?: boolean;
    has_password?: boolean;
    folder_id: string | null;
    folder_name?: string | null;
    folder_ids?: string[] | null;
    asset_root_ids?: string[] | null;
    folder_names?: string[];
    asset_titles?: string[];
};

type UnifiedShareLink = AssetShareLink | ProjectShareLink;

function shareUrlFor(link: UnifiedShareLink) {
    const base = import.meta.env.VITE_APP_URL || window.location.origin;
    const trimmedBase = String(base).replace(/\/$/, "");
    return link.kind === "project" ? `${trimmedBase}/share/project/${link.id}` : `${trimmedBase}/share/${link.id}`;
}

// Compact on/off indicator so every link's permissions are visible at a
// glance in the table, instead of only surfacing "upload allowed"/"password"
// when true (which left download/comments settings invisible either way).
function SettingPill({ icon: Icon, label, on }: { icon: typeof Upload; label: string; on: boolean }) {
    return (
        <span
            className={cn(
                "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium leading-none whitespace-nowrap",
                on
                    ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "border-border/60 bg-muted/20 text-muted-foreground/60",
            )}
        >
            <Icon className="h-2.5 w-2.5" />
            {label}
        </span>
    );
}

// Builds a readable "VEYRANT Logo, Renders +2 more" summary for a multi-select
// share from the resolved folder/asset names, rather than just a bare count.
function selectionRowSummary(folderNames: string[], assetTitles: string[]): string {
    const names = [...folderNames, ...assetTitles];
    if (names.length === 0) return "Selection";
    const shown = names.slice(0, 2).join(", ");
    const remaining = names.length - 2;
    return remaining > 0 ? `${shown} +${remaining} more` : shown;
}

function formatExpiry(expiresAt: string | null): string {
    if (!expiresAt) return "Never expires";
    const date = new Date(expiresAt);
    const isPast = date.getTime() < Date.now();
    return `${isPast ? "Expired" : "Expires"} ${date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
}

export default function ProjectShareLinks({ projectId }: { projectId: string }) {
    const [links, setLinks] = useState<UnifiedShareLink[]>([]);
    const [loading, setLoading] = useState(false);

    const copyLink = async (link: UnifiedShareLink) => {
        try {
            await navigator.clipboard.writeText(shareUrlFor(link));
            toast.success("Share link copied");
        } catch (error) {
            console.error("Failed to copy share link", error);
            toast.error("Failed to copy link");
        }
    };

    useEffect(() => {
        loadLinks();
    }, [projectId]);

    const loadLinks = async () => {
        setLoading(true);
        try {
            const [assetLinksResult, projectLinksResult] = await Promise.all([
                invokeEdgeFunction("share", { body: { action: "list-asset-share-links", projectId } }),
                invokeEdgeFunction("project-share", { body: { action: "list", project_id: projectId } }),
            ]);
            if (assetLinksResult.error) throw assetLinksResult.error;
            if (projectLinksResult.error) throw projectLinksResult.error;

            const assetLinks: UnifiedShareLink[] = ((assetLinksResult.data?.data ?? []) as any[]).map((link) => ({
                ...link,
                kind: "asset" as const,
            }));
            const projectLinks: UnifiedShareLink[] = ((projectLinksResult.data?.data ?? []) as any[]).map((link) => ({
                ...link,
                kind: "project" as const,
            }));

            const merged = [...projectLinks, ...assetLinks].sort(
                (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
            );
            setLinks(merged);
        } catch (e) {
            console.error("Failed to load share links", e);
            toast.error("Failed to load share links");
        } finally {
            setLoading(false);
        }
    };

    const handleRevoke = async (link: UnifiedShareLink) => {
        try {
            setLinks((prev) => prev.map((l) => (l.id === link.id ? { ...l, revoked_at: new Date().toISOString() } : l)));

            const { error } =
                link.kind === "project"
                    ? await invokeEdgeFunction("project-share", { body: { action: "revoke", share_link_id: link.id } })
                    : await invokeEdgeFunction("share", { body: { action: "revoke-asset-share-link", share_link_id: link.id } });
            if (error) throw error;
            toast.success("Link revoked");
        } catch (e) {
            console.error("Failed to revoke link", e);
            toast.error("Failed to revoke link");
            loadLinks(); // revert logic
        }
    };

    if (loading && links.length === 0) {
        return (
            <div className="flex items-center justify-center p-8 text-muted-foreground">
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                Loading share links...
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <LinkIcon className="h-5 w-5 text-muted-foreground" />
                    <h2 className="text-lg font-semibold">Share Links</h2>
                </div>
                <Button variant="ghost" size="sm" onClick={loadLinks} disabled={loading}>
                    <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} /> Refresh
                </Button>
            </div>

            <Card>
                {links.length === 0 ? (
                    <>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-base">No share links yet</CardTitle>
                            <CardDescription>
                                Project and asset review links appear here so you can monitor access, see recent activity, and revoke links when needed.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="pt-0">
                            <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-4 py-8 text-sm text-muted-foreground">
                                Use "Share project" or share a single asset to start sharing work with guests or external reviewers.
                            </div>
                        </CardContent>
                    </>
                ) : (
                    <CardContent className="p-0">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-muted/50">
                                    <TableHead className="pl-6">Shares</TableHead>
                                    <TableHead>Link</TableHead>
                                    <TableHead>Settings</TableHead>
                                    <TableHead>Views</TableHead>
                                    <TableHead>Last Accessed</TableHead>
                                    <TableHead>Created</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="text-right pr-6">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {links.map((link) => {
                                    const isRevoked = !!link.revoked_at;
                                    const isExpired = link.expires_at && new Date(link.expires_at).getTime() < Date.now();
                                    const status = isRevoked ? "Revoked" : isExpired ? "Expired" : "Active";
                                    const statusVariant = isRevoked ? "destructive" : isExpired ? "secondary" : "default"; // 'outline' sometimes looks like secondary dependent on theme
                                    const shareUrl = shareUrlFor(link);

                                    return (
                                        <TableRow key={`${link.kind}-${link.id}`} className={isRevoked ? "opacity-60 bg-muted/20" : "hover:bg-muted/50"}>
                                            <TableCell className="font-medium pl-6">
                                                <div className="flex items-center gap-3">
                                                    <div className="flex h-8 w-8 items-center justify-center rounded bg-primary/10 text-primary">
                                                        {link.kind === "project" ? <FolderOpen className="h-4 w-4" /> : <LinkIcon className="h-4 w-4" />}
                                                    </div>
                                                    <div className="flex flex-col">
                                                        <span
                                                            className="truncate max-w-[180px] font-medium"
                                                            title={
                                                                link.kind === "project" && link.folder_id
                                                                    ? (link.folder_name || "Shared folder")
                                                                    : link.kind === "project" && (link.folder_ids?.length || link.asset_root_ids?.length)
                                                                        ? selectionRowSummary(link.folder_names ?? [], link.asset_titles ?? [])
                                                                        : link.kind === "project"
                                                                            ? "Whole project"
                                                                            : link.assets?.title
                                                            }
                                                        >
                                                            {link.kind === "project" && link.folder_id
                                                                ? (link.folder_name || "Shared folder")
                                                                : link.kind === "project" && (link.folder_ids?.length || link.asset_root_ids?.length)
                                                                    ? selectionRowSummary(link.folder_names ?? [], link.asset_titles ?? [])
                                                                    : link.kind === "project"
                                                                        ? "Whole project"
                                                                        : link.assets?.title || "Unknown Asset"}
                                                        </span>
                                                        {link.kind === "project" && link.folder_id ? (
                                                            <span className="text-[10px] text-muted-foreground">Folder</span>
                                                        ) : link.kind === "project" && (link.folder_ids?.length || link.asset_root_ids?.length) ? (
                                                            <span className="text-[10px] text-muted-foreground">Selection</span>
                                                        ) : null}
                                                    </div>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex max-w-[220px] flex-wrap items-center gap-1">
                                                    {link.kind === "project" ? (
                                                        <SettingPill icon={Upload} label="Upload" on={Boolean(link.allow_upload)} />
                                                    ) : null}
                                                    <SettingPill icon={Download} label="Download" on={link.allow_download !== false} />
                                                    <SettingPill icon={MessageSquare} label="Comments" on={link.allow_comments !== false} />
                                                    {link.kind === "project" ? (
                                                        <SettingPill icon={Lock} label="Password" on={Boolean(link.has_password)} />
                                                    ) : null}
                                                    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground whitespace-nowrap">
                                                        <CalendarClock className="h-2.5 w-2.5" />
                                                        {formatExpiry(link.expires_at)}
                                                    </span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="max-w-[280px]">
                                                <div className="flex min-w-0 items-center gap-2 rounded-md border border-border/70 bg-muted/30 px-2 py-1.5">
                                                    <code className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={shareUrl}>
                                                        {shareUrl}
                                                    </code>
                                                    {!isRevoked && !isExpired ? (
                                                        <div className="flex shrink-0 items-center gap-1">
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-7 w-7"
                                                                onClick={() => copyLink(link)}
                                                                aria-label="Copy share link"
                                                            >
                                                                <Copy className="h-3.5 w-3.5" />
                                                            </Button>
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-7 w-7"
                                                                asChild
                                                            >
                                                                <a href={shareUrl} target="_blank" rel="noopener noreferrer" aria-label="Open share link">
                                                                    <ExternalLink className="h-3.5 w-3.5" />
                                                                </a>
                                                            </Button>
                                                        </div>
                                                    ) : null}
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-1.5">
                                                    <span className="font-semibold">{link.access_count ?? 0}</span>
                                                    <span className="text-xs text-muted-foreground">views</span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-muted-foreground text-sm">
                                                {link.last_accessed_at
                                                    ? formatDistanceToNow(new Date(link.last_accessed_at), { addSuffix: true })
                                                    : "Never"}
                                            </TableCell>
                                            <TableCell className="text-muted-foreground text-sm">
                                                {formatDistanceToNow(new Date(link.created_at), { addSuffix: true })}
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant={statusVariant as any} className="capitalize font-normal text-xs px-2 py-0.5 h-6">
                                                    {status}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-right pr-6">
                                                {!isRevoked && !isExpired && (
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild>
                                                            <Button variant="ghost" size="icon" className="h-8 w-8">
                                                                <MoreHorizontal className="h-4 w-4" />
                                                                <span className="sr-only">Open menu</span>
                                                            </Button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end">
                                                            <DropdownMenuItem onClick={() => copyLink(link)}>
                                                                <Copy className="mr-2 h-4 w-4" />
                                                                Copy Link
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem asChild>
                                                                <a href={shareUrl} target="_blank" rel="noopener noreferrer">
                                                                    <ExternalLink className="mr-2 h-4 w-4" />
                                                                    Open Link
                                                                </a>
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem
                                                                className="text-destructive focus:text-destructive"
                                                                onClick={() => handleRevoke(link)}
                                                            >
                                                                <Trash2 className="mr-2 h-4 w-4" />
                                                                Revoke Link
                                                            </DropdownMenuItem>
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </CardContent>
                )}
            </Card>
        </div>
    );
}
