import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
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
import { RefreshCw, Link as LinkIcon, Copy, Trash2, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal } from "lucide-react";

type ShareLink = {
    id: string;
    asset_id: string;
    token_hash: string;
    allow_download: boolean;
    allow_comments: boolean;
    created_at: string;
    expires_at: string | null;
    revoked_at: string | null;
    access_count: number;
    last_accessed_at: string | null;
    assets: {
        id: string;
        title: string;
        mime_type: string;
        storage_path: string;
    };
};

export default function ProjectShareLinks({ projectId }: { projectId: string }) {
    const [links, setLinks] = useState<ShareLink[]>([]);
    const [loading, setLoading] = useState(false);

    const shareUrlFor = (link: ShareLink) => {
        const base = import.meta.env.VITE_APP_URL || window.location.origin;
        return `${String(base).replace(/\/$/, "")}/share/${link.id}`;
    };

    const copyLink = async (link: ShareLink) => {
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
            const { data, error } = await invokeEdgeFunction("share", {
                body: { action: "list-asset-share-links", projectId },
            });
            if (error) throw error;
            setLinks((data?.data ?? []) as ShareLink[]);
        } catch (e) {
            console.error("Failed to load share links", e);
            toast.error("Failed to load share links");
        } finally {
            setLoading(false);
        }
    };

    const handleRevoke = async (linkId: string) => {
        try {
            // optimistic update
            setLinks(prev => prev.map(l => l.id === linkId ? { ...l, revoked_at: new Date().toISOString() } : l));

            const { error } = await invokeEdgeFunction("share", {
                body: { action: "revoke-asset-share-link", share_link_id: linkId },
            });
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
                                Asset review links for this project appear here so you can monitor access, see recent activity, and revoke links when needed.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="pt-0">
                            <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-4 py-8 text-sm text-muted-foreground">
                                Create a review link from an asset to start sharing work with guests or external reviewers.
                            </div>
                        </CardContent>
                    </>
                ) : (
                    <CardContent className="p-0">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-muted/50">
                                    <TableHead className="pl-6">Asset</TableHead>
                                    <TableHead>Link</TableHead>
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
                                        <TableRow key={link.id} className={isRevoked ? "opacity-60 bg-muted/20" : "hover:bg-muted/50"}>
                                            <TableCell className="font-medium pl-6">
                                                <div className="flex items-center gap-3">
                                                    <div className="flex h-8 w-8 items-center justify-center rounded bg-primary/10 text-primary">
                                                        <LinkIcon className="h-4 w-4" />
                                                    </div>
                                                    <span className="truncate max-w-[180px] font-medium" title={link.assets?.title}>
                                                        {link.assets?.title || "Unknown Asset"}
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
                                                                onClick={() => handleRevoke(link.id)}
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
