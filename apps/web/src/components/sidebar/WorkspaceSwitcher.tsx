'use client'

import * as React from 'react'
import { ChevronsUpDown, Plus, LayoutGrid } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'

type WorkspaceItem = { name: string; logo: React.ElementType }

export function WorkspaceSwitcher({
  workspaces,
  currentWorkspace,      // controlled: the *name* of the active workspace
  onSelect,
  loading = false,
}: {
  workspaces: WorkspaceItem[]
  currentWorkspace?: string
  onSelect?: (name: string) => void
  loading?: boolean
}) {
  const { isMobile } = useSidebar()
  const navigate = useNavigate()

  // derive active workspace from props (or fall back to first item)
  const activeWorkspace = React.useMemo(
    () => workspaces.find((w) => w.name === currentWorkspace) ?? workspaces[0] ?? null,
    [workspaces, currentWorkspace]
  )

  if (loading && !activeWorkspace) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <div className="flex items-center gap-2 px-2 py-1.5 h-12 w-full animate-pulse rounded-lg bg-muted/30">
            <div className="size-8 rounded-lg bg-muted/50 shrink-0" />
            <div className="h-4 w-24 rounded bg-muted/50" />
          </div>
        </SidebarMenuItem>
      </SidebarMenu>
    )
  }

  // Fallback if truly no workspaces and not loading
  if (!activeWorkspace) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" disabled>
             <div className="bg-muted size-8 flex items-center justify-center rounded-lg">
                <LayoutGrid className="size-4" />
             </div>
             <span className="truncate font-medium">Select Workspace</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    )
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="rounded-lg data-[state=open]:bg-sidebar-accent/45 data-[state=open]:text-sidebar-foreground"
            >
              <div className="flex aspect-square size-8 items-center justify-center rounded-md bg-sidebar-accent/45 text-sidebar-foreground/72">
                <activeWorkspace.logo className="size-6" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-sidebar-foreground/38">Workspace</span>
                <span className="truncate font-medium text-sidebar-foreground/82">{activeWorkspace.name}</span>
              </div>
              <ChevronsUpDown className="ml-auto text-sidebar-foreground/35" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            align="start"
            side={isMobile ? 'bottom' : 'right'}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-muted-foreground text-xs">
              Workspaces
            </DropdownMenuLabel>

            {workspaces.map((workspace, index) => (
              <DropdownMenuItem
                key={workspace.name}
                onClick={() => onSelect?.(workspace.name)}
                className="gap-2 p-2"
              >
                <div className="flex size-6 items-center justify-center rounded-md border">
                  <workspace.logo className="size-4 shrink-0" />
                </div>
                {workspace.name}
                <DropdownMenuShortcut>⌘{index + 1}</DropdownMenuShortcut>
              </DropdownMenuItem>
            ))}

            <DropdownMenuSeparator />

            <DropdownMenuItem className="gap-2 p-2">
              <div className="flex size-6 items-center justify-center rounded-md border bg-transparent">
                <Plus className="size-4" />
              </div>
              <div className="text-muted-foreground font-medium">Add Workspace</div>
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuItem className="gap-2 p-2" onClick={() => navigate('/workspaces')}>
              <div className="flex size-6 items-center justify-center rounded-md border bg-transparent">
                <LayoutGrid className="size-4" />
              </div>
              <div className="text-muted-foreground font-medium">All Workspaces</div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
