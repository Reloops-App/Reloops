import * as React from "react";
import { Link } from "react-router-dom";
import { MoreHorizontal } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ProjectCardProps } from "@/types/interfaces";

function timeAgo(date: Date) {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return `just now`;
}

const PREVIEW_PALETTES = [
  {
    background: "linear-gradient(180deg, #f18993 0%, #d06b9f 54%, #5a2b4b 100%)",
    accent: "radial-gradient(circle at 18% 0%, rgba(255,210,125,0.88) 0%, rgba(255,210,125,0.48) 24%, rgba(255,210,125,0) 58%)",
  },
  {
    background: "linear-gradient(180deg, #69adff 0%, #7056ff 52%, #2d246a 100%)",
    accent: "radial-gradient(circle at 28% 0%, rgba(182,234,255,0.86) 0%, rgba(182,234,255,0.32) 24%, rgba(182,234,255,0) 56%)",
  },
  {
    background: "linear-gradient(180deg, #4f7592 0%, #344a7f 48%, #20253f 100%)",
    accent: "radial-gradient(circle at 78% 12%, rgba(186,228,255,0.68) 0%, rgba(186,228,255,0.24) 22%, rgba(186,228,255,0) 52%)",
  },
  {
    background: "linear-gradient(180deg, #5aa2a6 0%, #326577 54%, #1f2941 100%)",
    accent: "radial-gradient(circle at 22% 0%, rgba(192,245,255,0.72) 0%, rgba(192,245,255,0.26) 24%, rgba(192,245,255,0) 56%)",
  },
];

function gradientSet(seed: string) {
  const index = seed.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0) % PREVIEW_PALETTES.length;
  return PREVIEW_PALETTES[index];
}

function ProjectPreview({ project }: { project: ProjectCardProps["project"] }) {
  const previewImage =
    project.previewImageUrl ||
    project.previewImages?.[0] ||
    project.assets?.find((asset) => asset.cover_url)?.cover_url;

  if (previewImage) {
    return (
      <div className="relative aspect-[6/5] overflow-hidden rounded-[12px]">
        <img
          src={previewImage}
          alt=""
          className="h-full w-full object-cover transition duration-300 ease-out group-hover:scale-[1.025]"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/68 via-black/16 to-black/4" />
      </div>
    );
  }

  const gradient = gradientSet(project.id || project.name);

  return (
    <div
      className="animate-gradient-shift relative aspect-[6/5] overflow-hidden rounded-[12px]"
      style={{
        backgroundImage: `${gradient.accent}, ${gradient.background}`,
        backgroundSize: "180% 180%",
      }}
    >
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02)_42%,rgba(15,16,28,0.34)_100%)]" />
      <div className="absolute -left-6 -top-8 h-28 w-40 rounded-full bg-[rgba(255,194,166,0.42)] blur-2xl transition-transform duration-300 group-hover:translate-x-1 group-hover:-translate-y-1" />
      <div className="absolute right-[-18%] top-[-6%] h-24 w-28 rounded-full bg-[rgba(232,243,255,0.12)] blur-xl transition-transform duration-300 group-hover:translate-x-1 group-hover:translate-y-1" />
    </div>
  );
}

export default function ProjectCard({
  project,
  workspaceId,
  workspaceLabel,
  className,
}: ProjectCardProps) {
  const created = new Date(project.created_at);
  const subtitle = workspaceLabel || project.workspace_name || "Workspace";

  return (
    <Card
      className={cn(
        "group relative m-0 flex min-w-0 flex-col overflow-hidden rounded-[16px] border border-white/8 bg-[#1a2133] p-0 shadow-[0_10px_24px_rgba(0,0,0,0.18)] transition-[transform,border-color,box-shadow] duration-200 ease-out motion-safe:hover:-translate-y-0.5 motion-safe:hover:border-white/12 motion-safe:hover:shadow-[0_14px_30px_rgba(0,0,0,0.24)]",
        className,
      )}
    >
      <Link
        to={`/workspace/${workspaceId}/projects/${project.id}`}
        className="absolute inset-0 z-[1]"
        aria-label={`Open ${project.name}`}
      />

      <CardContent className="p-2.5">
        <div className="relative">
          <ProjectPreview project={project} />
        </div>

        <div className="relative z-[2] px-1 pt-2.5">
          <h3 className="line-clamp-2 text-[17px] font-semibold leading-[1.15] text-white">
            {project.name}
          </h3>
          <p className="mt-1 truncate text-[13px] leading-none text-white/62">{subtitle}</p>
        </div>

        <div className="relative z-[2] flex items-center justify-between gap-3 px-1 pt-2.5">
          <div className="truncate text-[13px] text-[#9cafcf]">Updated {timeAgo(created)}</div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 rounded-full text-white/45 hover:bg-white/6 hover:text-white/82"
                aria-label="Open menu"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem asChild>
                <Link to={`/workspace/${workspaceId}/projects/${project.id}`}>Details</Link>
              </DropdownMenuItem>
              <DropdownMenuItem>Archive</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );
}
