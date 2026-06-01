import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { invokeEdgeFunction } from "@/api/edge";
import { getSessionToken, supabase } from "@/lib/supabaseClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertCircle, Plus, Search, RefreshCw, FolderKanban } from "lucide-react";
import ProjectCard from "@/components/project/ProjectCard";
import { Project } from "@/types/interfaces";
import { CreateProjectModal } from "@/components/project/CreateProjectModal";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

const Projects: React.FC = () => {
    const { workspaceId } = useParams<{ workspaceId: string }>();
    const [projects, setProjects] = useState<Project[]>([]);
    const [workspaceName, setWorkspaceName] = useState("Workspace");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // UI state
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState<"active" | "archived" | "all">("all");
    const [sortBy] = useState<"created_desc" | "created_asc" | "name_asc">("created_desc");
    const [createOpen, setCreateOpen] = useState(false);

    const handleCreateProject = () => {
        setCreateOpen(true);
    };

    const fetchProjects = async () => {
        if (!workspaceId) return;
        setLoading(true);
        setError(null);

        try {
            const token = await getSessionToken();
            const [projectsRes, countsRes, workspaceRes] = await Promise.all([
                fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/projects?select=id,name,workspace_id,status,created_at&workspace_id=eq.${workspaceId}&order=created_at.desc`, {
                    headers: {
                        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
                        Authorization: `Bearer ${token}`,
                    },
                }),
                invokeEdgeFunction<{ data?: { project_id: string; total: number; approved: number; pending: number }[] }>("asset", {
                    body: { action: "project_counts", workspace_id: workspaceId },
                }),
                supabase.from("workspaces").select("name").eq("id", workspaceId).maybeSingle(),
            ]);

            if (!projectsRes.ok) throw new Error(`Failed to fetch projects: ${projectsRes.statusText}`);
            const projectsData: any[] = await projectsRes.json();
            if (workspaceRes.data?.name) {
                setWorkspaceName(workspaceRes.data.name);
            }

            const projectIds = (projectsData ?? []).map((p) => p.id);
            if (!projectIds.length) {
                setProjects([]);
                setLoading(false);
                return;
            }

            const assetCountsByProject = new Map<string, { total: number; approved: number; pending: number; }>();
            if (countsRes.error) throw new Error(countsRes.error.message || "Failed to fetch project counts");
            (countsRes.data?.data ?? []).forEach((row) => {
                assetCountsByProject.set(row.project_id, {
                    total: row.total,
                    approved: row.approved,
                    pending: row.pending,
                });
            });

            const { data: previewAssets, error: previewsError } = await supabase
                .from("assets")
                .select("project_id, cover_image_url, created_at")
                .eq("workspace_id", workspaceId)
                .in("project_id", projectIds)
                .not("cover_image_url", "is", null)
                .order("created_at", { ascending: false });

            if (previewsError) throw previewsError;

            const previewImagesByProject = new Map<string, string[]>();
            for (const asset of previewAssets ?? []) {
                const projectId = asset.project_id as string | null;
                const coverImageUrl = asset.cover_image_url as string | null;
                if (!projectId || !coverImageUrl) continue;
                const existing = previewImagesByProject.get(projectId) ?? [];
                if (existing.length >= 4) continue;
                previewImagesByProject.set(projectId, [...existing, coverImageUrl]);
            }

            const enriched: Project[] = (projectsData ?? []).map((p) => {
                const counts = assetCountsByProject.get(p.id) ?? { total: 0, approved: 0, pending: 0 };
                const previewImages = previewImagesByProject.get(p.id) ?? [];
                return {
                    id: p.id,
                    name: p.name,
                    status: p.status,
                    created_at: p.created_at,
                    assetsCount: counts.total,
                    assetsApproved: counts.approved,
                    assetsPending: counts.pending,
                    previewImageUrl: previewImages[0],
                    previewImages,
                    workspace_name: workspaceRes.data?.name ?? undefined,
                } as unknown as Project;
            });

            setProjects(enriched);
        } catch (err: any) {
            console.error(err);
            setError("Failed to load projects. Please try again.");
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => {
        fetchProjects();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [workspaceId]);

    const filtered = useMemo(() => {
        let list = [...projects];
        if (statusFilter !== "all") list = list.filter((c) => (c.status ?? "active") === statusFilter);
        if (search.trim()) {
            const q = search.toLowerCase();
            list = list.filter((c) => c.name.toLowerCase().includes(q));
        }
        switch (sortBy) {
            case "created_asc":
                list.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
                break;
            case "name_asc":
                list.sort((a, b) => a.name.localeCompare(b.name));
                break;
            default:
                list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        }
        return list;
    }, [projects, search, statusFilter, sortBy]);

    return (
        <TooltipProvider>
            <div className="space-y-6 p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                        <div className="rounded-2xl p-3 bg-primary/10">
                            <FolderKanban className="h-6 w-6" aria-hidden="true" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" onClick={fetchProjects} aria-label="Refresh list">
                                    <RefreshCw className="h-5 w-5" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Refresh</TooltipContent>
                        </Tooltip>

                        <Button onClick={handleCreateProject}>
                            <Plus className="mr-2 h-4 w-4" /> New Project
                        </Button>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-12 mt-5">
                    <div className="md:col-span-6">
                        <div className="relative">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-60" />
                            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name" className="pl-9" aria-label="Search projects" />
                        </div>
                    </div>
                </div>

                {error && (
                    <Alert variant="destructive" className="mt-6">
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>Unable to load projects</AlertTitle>
                        <AlertDescription>{error} If the problem persists, check your network connection or Supabase rules.</AlertDescription>
                    </Alert>
                )}

                {loading && (
                    <div className="mt-6 flex flex-wrap gap-4">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <Card key={i} className="w-full overflow-hidden rounded-[16px] border-white/8 bg-[#1a2133] p-2.5 sm:w-[236px]">
                                <Skeleton className="aspect-[6/5] w-full rounded-[12px]" />
                                <CardContent className="space-y-2 px-1 pt-2.5">
                                    <Skeleton className="h-5 w-4/5" />
                                    <Skeleton className="h-4 w-2/5" />
                                    <div className="flex items-center justify-between pt-2">
                                        <Skeleton className="h-4 w-24" />
                                        <Skeleton className="h-4 w-4 rounded-full" />
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}

                {!loading && !error && projects.length > 0 && (
                    <Tabs className="mt-10" value={statusFilter} onValueChange={(v) => setStatusFilter(v as "active" | "archived" | "all")}>
                        <TabsList>
                            <TabsTrigger value="all">All</TabsTrigger>
                            <TabsTrigger value="active">Active</TabsTrigger>
                            <TabsTrigger value="archived">Archived</TabsTrigger>
                        </TabsList>

                        <TabsContent value={statusFilter} className="mt-4">
                            <div className="flex flex-wrap gap-4">
                                {filtered.map((proj) => (
                                    <div key={proj.id} className="w-full sm:w-[236px]">
                                        <ProjectCard project={proj} workspaceId={workspaceId!} workspaceLabel={workspaceName} />
                                    </div>
                                ))}
                            </div>

                            {!loading && !error && filtered.length === 0 && (
                                <Empty>
                                    <EmptyHeader>
                                        <EmptyMedia variant="icon">
                                            <FolderKanban className="h-10 w-10 opacity-60" />
                                        </EmptyMedia>
                                        <EmptyTitle>No projects match your filters</EmptyTitle>
                                        <p className="max-w-md text-sm text-muted-foreground">Try adjusting your search or status filters, or create a new project to get started.</p>
                                    </EmptyHeader>
                                    <Button onClick={handleCreateProject}>
                                        <Plus className="mr-2 h-4 w-4" /> Create project
                                    </Button>
                                </Empty>
                            )}
                        </TabsContent>
                    </Tabs>
                )}

                {workspaceId && (
                    <CreateProjectModal open={createOpen} onOpenChange={setCreateOpen} workspaceId={workspaceId} onCreated={fetchProjects} />
                )}
            </div>
        </TooltipProvider>
    );
};

export default Projects;
