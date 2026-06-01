// src/pages/Workspaces/Workspaces.tsx
'use client';

import * as React from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Plus, RefreshCw, LayoutGrid, FolderGit2 } from 'lucide-react';
import WorkspaceCard from '@/components/workspaces/WorkspaceCard';
import { CreateWorkspaceModal } from '@/components/workspaces/CreateWorkspaceModal';
import { invokeEdgeFunction } from '@/api/edge';
import { getSupabaseUserFromStorage, updateSupabaseUserViaHttp } from "@/lib/supabaseAuthApi"

/**
 * ===== Types =====
 */
type DbWorkspace = {
    id: string;
    name: string;
    organization_id: string;
    status: 'active' | 'archived' | 'deleted';
    created_at: string;
};

type WorkspaceWithMeta = {
    ws: DbWorkspace;
    orgName: string | null;
    myOrgRole?: 'owner' | 'admin' | 'member' | 'billing';
    isAdminLike: boolean; // org owner/admin
    storageBytes?: number;
    projectsCount?: number;
    assetsCount?: number;
    sampleProjects?: { id: string; name: string }[];
    sampleAssets?: { id: string; title: string }[];
};

/**
 * ===== Page =====
 */
export default function WorkspacesPage() {
    const [loading, setLoading] = React.useState(true);
    const [err, setErr] = React.useState<string | null>(null);
    const [adminRows, setAdminRows] = React.useState<WorkspaceWithMeta[]>([]);
    const [memberRows, setMemberRows] = React.useState<WorkspaceWithMeta[]>([]);
    const [refreshing, setRefreshing] = React.useState(false);
    const [createOpen, setCreateOpen] = React.useState(false);

    /**
     * Load all workspaces for the currently logged-in user.
     * This does NOT manage `loading` – caller controls that so we can sequence
     * bootstrap + loadWorkspaces on initial mount.
     */
    const loadWorkspaces = React.useCallback(async () => {
        setErr(null);

        try {
            const { data, error } = await invokeEdgeFunction<{ data: WorkspaceWithMeta[] }>("workspace", {
                body: { action: "list" },
            })
            if (error) throw error

            const rows = Array.isArray((data as any)?.data) ? ((data as any).data as WorkspaceWithMeta[]) : []
            setAdminRows(rows.filter((r) => r.isAdminLike))
            setMemberRows(rows.filter((r) => !r.isAdminLike))
            return rows.length;
        } catch (e: any) {
            console.error('Failed to load workspaces', e);
            setErr(e?.message ?? 'Failed to load workspaces');
            setAdminRows([]);
            setMemberRows([]);
            return 0;
        }
    }, []);

    /**
     * Initial effect:
     * - Check session
     * - If there's an invite_token in user_metadata, call `bootstrap` once
     * - Then load workspaces
     */
    React.useEffect(() => {
        const init = async () => {
            setLoading(true);
            try {
                const user = getSupabaseUserFromStorage()
                const metadata = (user as any)?.user_metadata ?? {}
                const inviteToken = (metadata as any)?.invite_token

                if (inviteToken) {
                    try {
                        await invokeEdgeFunction('bootstrap', {
                            body: { inviteToken },
                        });

                        // Remove invite_token so it doesn't re-run next time
                        const { invite_token, ...rest } = metadata;
                        await updateSupabaseUserViaHttp({ data: rest });
                    } catch (err) {
                        console.error('Bootstrap from metadata failed', err);
                        // You could set a non-fatal error message here if you want
                    }
                }

                // After any invite handling, load workspaces using up-to-date memberships
                const count = await loadWorkspaces();
                
                // Fallback: If no workspaces found, trigger bootstrap (self-healing for orphaned users)
                if (count === 0) {
                    console.log('No workspaces found, triggering bootstrap fallback...');
                    await invokeEdgeFunction('bootstrap', { body: {} });
                    await loadWorkspaces();
                }
            } catch (e) {
                console.error('Init workspaces page failed', e);
                setErr(
                    e instanceof Error ? e.message : 'Something went wrong initializing workspaces'
                );
            } finally {
                setLoading(false);
            }
        };

        void init();
    }, [loadWorkspaces]);

    const onRefresh = React.useCallback(async () => {
        setRefreshing(true);
        try {
            await loadWorkspaces();
        } finally {
            setRefreshing(false);
        }
    }, [loadWorkspaces]);

    return (
        <div className="min-h-full w-full bg-background px-4 py-5 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-7xl space-y-6">
                {/* Header */}
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                        <SidebarTrigger className="mt-1" />
                        <div className="space-y-1">
                            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                                Workspaces
                            </h1>
                            <p className="text-sm text-muted-foreground">
                                Choose a workspace or create a new one.
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <Button
                            variant="outline"
                            size="icon"
                            onClick={onRefresh}
                            disabled={refreshing || loading}
                            aria-label="Refresh"
                            className="h-10 w-10"
                        >
                            <RefreshCw
                                className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`}
                            />
                        </Button>
                        <Button
                            onClick={() => setCreateOpen(true)}
                            className="h-10 px-4 shadow-sm transition-all hover:shadow-md"
                        >
                            <Plus className="mr-2 h-4 w-4" />
                            New Workspace
                        </Button>
                    </div>
                </div>

                <Separator className="bg-border/60" />

                {/* Error */}
                {err ? (
                    <Card className="border-destructive/50 bg-destructive/5">
                        <CardHeader>
                            <CardTitle className="text-destructive">
                                Couldn’t load workspaces
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm text-muted-foreground">{err}</p>
                            <div className="mt-4">
                                <Button variant="secondary" onClick={onRefresh}>
                                    Try again
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                ) : null}

                {/* Loading */}
                {loading ? (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <Card key={i} className="border-border/60 bg-card/90 shadow-sm">
                                <CardHeader className="space-y-2">
                                    <Skeleton className="h-5 w-1/2" />
                                    <Skeleton className="h-4 w-1/3" />
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <Skeleton className="h-8 w-full rounded-lg" />
                                    <Skeleton className="h-8 w-2/3 rounded-lg" />
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                ) : (
                    <div className="space-y-8">
                        {/* Admin / Owner */}
                        {adminRows.length > 0 && (
                            <section className="space-y-4">
                                <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                                    <LayoutGrid className="h-4 w-4" />
                                    <h2>Admin &amp; Owner</h2>
                                </div>
                                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3">
                                    {adminRows.map((item) => (
                                        <WorkspaceCard
                                            key={item.ws.id}
                                            item={item}
                                            showAdminMetrics
                                        />
                                    ))}
                                </div>
                            </section>
                        )}

                        {/* Member */}
                        <section className="space-y-4">
                            <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                                <FolderGit2 className="h-4 w-4" />
                                <h2>Member</h2>
                            </div>

                            {memberRows.length === 0 ? (
                                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border/70 bg-muted/20 py-12 text-center">
                                    <div className="rounded-full bg-muted p-3">
                                        <FolderGit2 className="h-6 w-6 text-muted-foreground" />
                                    </div>
                                    <h3 className="mt-4 text-lg font-medium">
                                        No other workspaces
                                    </h3>
                                    <p className="mt-2 text-sm text-muted-foreground max-w-sm">
                                        You haven&apos;t joined any other workspaces as a member
                                        yet.
                                    </p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3">
                                    {memberRows.map((item) => (
                                        <WorkspaceCard key={item.ws.id} item={item} />
                                    ))}
                                </div>
                            )}
                        </section>

                        <CreateWorkspaceModal
                            open={createOpen}
                            onOpenChange={setCreateOpen}
                            onCreated={async (workspaceId) => {
                                // redirect to new workspace
                                window.location.href = `/workspace/${workspaceId}/projects`;
                            }}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
