"use client";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ArrowUp } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { invokeEdgeFunction } from "@/api/edge";
import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { Project } from "@/types/interfaces";
import CampaignDetails from "./CampaignDetails";
import ProjectNotFound from "@/components/errors/ProjectNotFound";

type ProjectError = "not_found" | "access_denied" | "unknown";
type ProjectFolderRow = {
  id: string;
  workspace_id: string;
  project_id?: string | null;
  parent_folder_id?: string | null;
  name: string;
  sort_order?: number | null;
  created_at?: string | null;
  deleted_at?: string | null;
};
type ExtendedProject = Project & {
  workspace_name?: string;
  assets?: any[];
  folders?: ProjectFolderRow[];
  organization_id?: string;
};

const projectPageCache = new Map<string, ExtendedProject>();

function sameFolderLists(
  a: ProjectFolderRow[] | undefined,
  b: ProjectFolderRow[] | undefined,
) {
  const left = a ?? [];
  const right = b ?? [];
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const lf = left[index];
    const rf = right[index];
    if (
      lf.id !== rf.id ||
      lf.name !== rf.name ||
      (lf.parent_folder_id ?? null) !== (rf.parent_folder_id ?? null) ||
      (lf.project_id ?? null) !== (rf.project_id ?? null) ||
      (lf.sort_order ?? 0) !== (rf.sort_order ?? 0)
    ) {
      return false;
    }
  }
  return true;
}

function sameTrail(
  a: Array<{ id: string; name: string }>,
  b: Array<{ id: string; name: string }>,
) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index].id !== b[index].id || a[index].name !== b[index].name) {
      return false;
    }
  }
  return true;
}

export function CampaignPage() {
  const { projectId, workspaceId } = useParams<{ projectId: string; workspaceId: string }>();

  const [project, setProject] = useState<ExtendedProject | null>(null);
  const [folderTrail, setFolderTrail] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ProjectError | null>(null);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    let isMounted = true;
    const requestSeq = ++requestSeqRef.current;
    const controller = new AbortController();
    const cacheKey = workspaceId && projectId ? `${workspaceId}:${projectId}` : "";
    const cachedProject = cacheKey ? projectPageCache.get(cacheKey) ?? null : null;

    setProject(cachedProject);
    setFolderTrail([]);
    setLoading(!cachedProject);
    setError(null);

    const fetchProject = async () => {
      if (!projectId || !workspaceId) {
        if (isMounted) {
          setError("not_found");
          setLoading(false);
        }
        return;
      }

      try {
        const { data, error: listError } = await invokeEdgeFunction<{
          data?: {
            project?: any;
            workspace?: any;
            assets?: any[];
            folders?: any[];
          };
        }>("asset", {
          body: { action: "list_project", project_id: projectId },
          signal: controller.signal,
        });

        if (listError) {
          if (listError.status === 403) throw new Error("access_denied");
          if (listError.status === 404) throw new Error("not_found");
          throw new Error(listError.message || "Failed to fetch project assets");
        }

        const payload = data?.data;
        const workspaceData = payload?.workspace;
        const projectData = payload?.project;

        if (!workspaceData || !projectData || projectData?.status === "deleted") {
          if (isMounted) {
            setError("not_found");
            setLoading(false);
          }
          return;
        }

        const mappedAssets =
          (payload?.assets as any[] | null)?.map((a) => {
            return {
              id: a.id,
              name: a.title,
              type: a.mime_type,
              sizeBytes: a.size_bytes ?? undefined,
              createdAt: a.created_at,
              coverUrl: a.cover_image_url ?? undefined,
              url: a.url ?? a.storage_path ?? undefined,
              status: a.status ?? undefined,
              version_no: a.version_no ?? undefined,
              parent_asset_id: a.parent_asset_id ?? undefined,
              folder_id: a.folder_id ?? undefined,
              project_id: a.project_id ?? undefined,
              comments_count: a.comments_count ?? 0,
              uploaded_at: a.uploaded_at ?? undefined,
              updated_at: a.updated_at ?? undefined,
              updated_by: a.updated_by ?? undefined,
              assigned_to: a.assigned_to ?? undefined,

              __raw: a,
            };
          }) ?? [];

        // merge into Project the extra, expected fields
        if (isMounted && requestSeq === requestSeqRef.current) {
          const enriched: ExtendedProject = {
            ...(projectData as Project),
            workspace_name: workspaceData?.name,
            assets: mappedAssets as any[],
            folders: Array.isArray(payload?.folders) ? payload.folders as ProjectFolderRow[] : [],
            organization_id: workspaceData?.organization_id,
          };
          if (cacheKey) projectPageCache.set(cacheKey, enriched);
          startTransition(() => {
            setProject(enriched);
            setLoading(false);
          });
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error("CampaignPage: fetchProject error", err);
        if (isMounted && requestSeq === requestSeqRef.current) {
          if (err instanceof Error && err.message === "access_denied") {
            setError("access_denied");
          } else if (err instanceof Error && err.message === "not_found") {
            setError("not_found");
          } else {
            setError("unknown");
          }
          setLoading(false);
        }
      }
    };

    fetchProject();
    return () => {
      // cleanup guard for async fetch
      isMounted = false;
      controller.abort();
    };
  }, [projectId, workspaceId]);

  const handleProjectUpdate = useCallback((updatedProject: Partial<ExtendedProject>) => {
    setProject((prev) => {
      if (!prev) return null;
      const next: ExtendedProject = { ...prev, ...updatedProject };
      if ("folders" in updatedProject && sameFolderLists(prev.folders, updatedProject.folders)) {
        next.folders = prev.folders;
      }
      if ("assets" in updatedProject && updatedProject.assets === prev.assets) {
        next.assets = prev.assets;
      }
      if (
        next === prev ||
        (
          next.name === prev.name &&
          next.workspace_name === prev.workspace_name &&
          next.organization_id === prev.organization_id &&
          next.assets === prev.assets &&
          next.folders === prev.folders
        )
      ) {
        return prev;
      }
      if (workspaceId && projectId) {
        projectPageCache.set(`${workspaceId}:${projectId}`, next);
      }
      return next;
    });
  }, [projectId, workspaceId]);

  const handleFolderTrailChange = useCallback((nextTrail: Array<{ id: string; name: string }>) => {
    setFolderTrail((prev) => (sameTrail(prev, nextTrail) ? prev : nextTrail));
  }, []);
  const parentFolder = folderTrail.length > 1 ? folderTrail[folderTrail.length - 2] : null;
  const parentFolderName = parentFolder?.name ?? project?.name ?? "Project";
  const parentFolderPath = parentFolder
    ? `/workspace/${workspaceId}/projects/${projectId}?folder=${parentFolder.id}`
    : `/workspace/${workspaceId}/projects/${projectId}`;

  return (
    <TooltipProvider>
    <div className="min-h-screen bg-background">
      <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
        <div className="flex min-w-0 items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-2 data-[orientation=vertical]:h-4"
          />
          {folderTrail.length > 0 ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button asChild variant="outline" size="sm" className="h-8 max-w-[230px] shrink-0 gap-1.5 px-2.5">
                  <Link to={parentFolderPath} aria-label={`Go to parent folder: ${parentFolderName}`}>
                    <ArrowUp className="h-4 w-4 shrink-0" />
                    <span className="truncate">{parentFolderName}</span>
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>Go to parent folder: {parentFolderName}</p>
                <p className="text-xs text-muted-foreground">Alt + Up Arrow</p>
              </TooltipContent>
            </Tooltip>
          ) : null}
          <Breadcrumb className="min-w-0">
            <BreadcrumbList className="flex-nowrap text-xs text-muted-foreground/80">
              <BreadcrumbItem className="hidden md:block">
                <BreadcrumbLink asChild>
                  <Link className="hover:text-foreground hover:underline" to={`/workspace/${workspaceId}/projects`}>
                    All Projects
                  </Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link className="hover:text-foreground hover:underline" to={`/workspace/${workspaceId}/projects/${projectId}`}>
                    {project?.name || "Project"}
                  </Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              {folderTrail.map((folder, index) => (
                <div key={folder.id} className="contents">
                  <BreadcrumbSeparator className="hidden md:block" />
                  <BreadcrumbItem>
                    {index === folderTrail.length - 1 ? (
                      <BreadcrumbPage className="text-foreground">{folder.name}</BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink asChild>
                        <Link className="hover:text-foreground hover:underline" to={`/workspace/${workspaceId}/projects/${projectId}?folder=${folder.id}`}>
                          {folder.name}
                        </Link>
                      </BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                </div>
              ))}
            </BreadcrumbList>
          </Breadcrumb>
        </div>
      </header>

      <div className="flex-1">
        {error ? (
          <ProjectNotFound
            workspaceId={workspaceId}
            projectId={projectId}
            error={error}
          />
        ) : project ? (
          <CampaignDetails
            key={`${workspaceId}:${project.id}`}
            project={project as ExtendedProject}
            workspaceId={String(workspaceId)}
            onProjectUpdate={handleProjectUpdate}
            onFolderTrailChange={handleFolderTrailChange}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center p-8">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto mb-4"></div>
              <p>Loading project...</p>
            </div>
          </div>
        )}
      </div>
    </div>
    </TooltipProvider>
  );
}
