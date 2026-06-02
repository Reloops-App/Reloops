'use client'

import * as React from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  Folder,
  Search as SearchIcon,
  FileImage,
  FileText,
  FileVideo,
  Globe2,
  Users,
  Link2,
  CreditCard,
  HelpCircle,
  Plus,
  ChevronRight,
  Clock,
  Settings,
  LayoutGrid,
} from 'lucide-react' // TODO(DB): make sure notifications/posts exist if you use related badges

import { WorkspaceSwitcher } from './WorkspaceSwitcher'
import { rememberActiveWorkspace } from '@/lib/workspaceRouting'
import { NavUser } from './nav-user'
import { supabase } from '@/lib/supabaseClient'
import { getSupabaseUserFromStorage } from "@/lib/supabaseAuthApi"
import { invokeEdgeFunction } from '@/api/edge'
import { cn } from '@/lib/utils'
import { NotificationDrawer } from '@/components/notifications/NotificationDrawer'
import { isLikelyWebsiteScreenshot } from '@/components/review/website-review-utils'

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'

// ===== Types =====
export type Workspace = {
  id: string
  name: string
  logo: React.ElementType
  organizationId?: string
  role?: string
  members_count?: number
}

type FolderRow = {
  id: string
  workspace_id: string
  project_id?: string | null
  parent_folder_id?: string | null
  name: string
  sort_order?: number | null
  created_at?: string | null
  deleted_at?: string | null
}

type ProjectAssetFolderRow = {
  folder_ids?: string[]
}

type ProjectSummary = { id: string; name: string; status?: string }
type CollectionSummary = { id: string; name: string; logoUrl?: string | null }
type QuickViewCounts = {
  all: number
  needsReview: number
  inReview: number
  approved: number
  video: number
  image: number
  pdf: number
  websiteReview: number
  archived: number
}

const workspaceProjectsCache = new Map<string, { all: ProjectSummary[]; recent: ProjectSummary[] }>()
const workspaceFoldersCache = new Map<string, FolderRow[]>()
const workspaceCollectionsCache = new Map<string, CollectionSummary[]>()
const workspaceQuickViewCountsCache = new Map<string, QuickViewCounts>()
const projectFolderIdsCache = new Map<string, string[]>()

const emptyQuickViewCounts: QuickViewCounts = {
  all: 0,
  needsReview: 0,
  inReview: 0,
  approved: 0,
  video: 0,
  image: 0,
  pdf: 0,
  websiteReview: 0,
  archived: 0,
}

function assetMime(asset: any) {
  return String(asset?.mime_type ?? asset?.type ?? asset?.content_type ?? "")
}

function assetRootId(asset: any) {
  const parent = asset?.parent_asset_id ?? asset?.parentAssetId
  return parent ? String(parent) : String(asset?.id ?? "")
}

function computeQuickViewCounts(rows: any[]): QuickViewCounts {
  const byRoot = new Map<string, any>()
  for (const row of rows) {
    const rootId = assetRootId(row)
    if (!rootId || byRoot.has(rootId)) continue
    byRoot.set(rootId, row)
  }

  const counts = { ...emptyQuickViewCounts }
  for (const asset of byRoot.values()) {
    const status = String(asset.status ?? "none").toLowerCase()
    if (status === "deleted") continue
    const mime = assetMime(asset)
    counts.all += 1
    if (status === "needs_review") counts.needsReview += 1
    if (status === "in_review") counts.inReview += 1
    if (status === "approved") counts.approved += 1
    if (status === "archived") counts.archived += 1
    if (mime.startsWith("video/")) counts.video += 1
    if (mime.startsWith("image/")) counts.image += 1
    if (mime === "application/pdf" || mime.endsWith("/pdf")) counts.pdf += 1
    if (isLikelyWebsiteScreenshot({
      title: asset.title ?? asset.name ?? asset.filename ?? null,
      storage_path: asset.storage_path ?? asset.path ?? asset.url ?? null,
      mime_type: mime,
      width: typeof asset.width === "number" ? asset.width : null,
      height: typeof asset.height === "number" ? asset.height : null,
    })) counts.websiteReview += 1
  }
  return counts
}

// ===== Supabase user helper =====
function useSupabaseUser() {
  const [user, setUser] = React.useState<{
    id: string
    name: string
    email: string
    avatar: string
  } | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let canceled = false

    const sync = () => {
      if (canceled) return
      const u = getSupabaseUserFromStorage()
      if (u) {
        const email = String((u as any).email ?? (u as any).user_metadata?.email ?? "")
        setUser({
          id: String((u as any).id),
          name: String((u as any).user_metadata?.full_name || email.split("@")[0] || "User"),
          email,
          avatar: (u as any).user_metadata?.avatar_url || "",
        })
      } else {
        setUser(null)
      }
      setLoading(false)
    }

    const onVisibleOrFocus = () => {
      if (document.visibilityState !== "visible") return
      sync()
    }

    sync()
    window.addEventListener("focus", onVisibleOrFocus)
    document.addEventListener("visibilitychange", onVisibleOrFocus)
    window.addEventListener("storage", onVisibleOrFocus)

    return () => {
      canceled = true
      window.removeEventListener("focus", onVisibleOrFocus)
      document.removeEventListener("visibilitychange", onVisibleOrFocus)
      window.removeEventListener("storage", onVisibleOrFocus)
    }
  }, [])

  return { user, loading }
}

// ===== Link Component =====
function SidebarNavLink({
  to,
  icon: Icon,
  label,
  badge,
  dotClassName,
  className,
  isActiveOverride,
}: {
  to: string
  icon?: React.ElementType
  label: string
  badge?: number | string
  dotClassName?: string
  className?: string
  isActiveOverride?: (pathname: string) => boolean
}) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const active = React.useMemo(() => {
    if (isActiveOverride) return isActiveOverride(pathname)
    return pathname === to || pathname.startsWith(`${to}/`)
  }, [isActiveOverride, pathname, to])

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        role="link"
        aria-current={active ? 'page' : undefined}
        tooltip={label}
        isActive={active}
        className={cn(
          "relative h-8 w-full min-w-0 justify-start rounded-md text-[13px] font-normal text-sidebar-foreground/58",
          "hover:bg-sidebar-accent/40 hover:text-sidebar-foreground/82",
          "data-[active=true]:bg-sidebar-accent/48 data-[active=true]:font-semibold data-[active=true]:text-sidebar-foreground/92",
          "data-[active=true]:before:absolute data-[active=true]:before:bottom-1.5 data-[active=true]:before:left-0 data-[active=true]:before:top-1.5 data-[active=true]:before:w-0.5 data-[active=true]:before:rounded-r-full data-[active=true]:before:bg-sidebar-primary/80",
          "data-[active=true]:[&>svg]:text-sidebar-foreground/82 [&>svg]:size-3.5 [&>svg]:text-sidebar-foreground/38",
          className,
        )}
        onClick={() => navigate(to)}
      >
        {Icon ? <Icon /> : null}
        {dotClassName ? <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClassName)} /> : null}
        <span className="block truncate">{label}</span>
        {typeof badge !== 'undefined' && (
          <span
            aria-label={
              typeof badge === 'number' ? `${badge} items` : 'status badge'
            }
            className={cn(
              "ml-auto inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-sidebar-accent/55 px-1.5 text-[10px] font-medium leading-none text-sidebar-foreground/48",
              active && "bg-sidebar-accent/75 text-sidebar-foreground/70",
            )}
          >
            {badge}
          </span>
        )}
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

function SidebarSectionHeader({
  label,
  onClick,
  actionLabel,
  onAction,
}: {
  label: string
  onClick?: () => void
  actionLabel?: string
  onAction?: () => void
}) {
  const LabelElement = onClick ? 'button' : 'div'
  return (
    <div className="mb-2 mt-6 flex h-5 items-center justify-between px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-sidebar-foreground/38 group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0">
      <LabelElement
        type={onClick ? "button" : undefined}
        className={cn(onClick && "hover:text-sidebar-foreground/75")}
        onClick={onClick}
      >
        {label}
      </LabelElement>
      {onAction ? (
        <button
          type="button"
          aria-label={actionLabel}
          className="grid h-5 w-5 place-items-center rounded-md text-sidebar-foreground/38 hover:bg-sidebar-accent/45 hover:text-sidebar-foreground/75"
          onClick={onAction}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  )
}

function CollectionCardsIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={cn("h-4 w-4 shrink-0", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="7" y="5" width="11" height="13" rx="2" />
      <path d="M5 8.5V17a2 2 0 0 0 2 2h8.5" />
      <path d="M9 9h7" />
      <path d="M9 12h4" />
    </svg>
  )
}

function CollectionLogoIcon({ collection }: { collection: CollectionSummary }) {
  if (collection.logoUrl) {
    return (
      <img
        src={collection.logoUrl}
        alt=""
        className="h-4 w-4 shrink-0 rounded-sm object-cover"
      />
    )
  }
  return <CollectionCardsIcon />
}

function SidebarFolderTreeNode({
  folder,
  depth,
  currentFolderId,
  foldersByParent,
  expandedFolderIds,
  onToggle,
  onSelect,
  activeScope = true,
}: {
  folder: FolderRow
  depth: number
  currentFolderId: string | null
  foldersByParent: Map<string | null, FolderRow[]>
  expandedFolderIds: Set<string>
  onToggle: (folderId: string) => void
  onSelect: (folderId: string) => void
  activeScope?: boolean
}) {
  const children = foldersByParent.get(folder.id) ?? []
  const expanded = expandedFolderIds.has(folder.id)
  const active = activeScope && currentFolderId === folder.id

  return (
    <div>
      <div
        className={cn(
          "relative flex h-7 min-w-0 items-center gap-1 overflow-hidden rounded-md pr-2 text-[13px] transition-colors",
          active
            ? "bg-sidebar-accent/48 font-semibold text-sidebar-foreground/88 before:absolute before:bottom-1.5 before:left-0 before:top-1.5 before:w-0.5 before:rounded-r-full before:bg-sidebar-primary/80"
            : cn(
              depth > 1 ? "text-sidebar-foreground/46" : "text-sidebar-foreground/56",
              "hover:bg-sidebar-accent/35 hover:text-sidebar-foreground/78",
            ),
        )}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
      >
        <button
          type="button"
          aria-label={expanded ? "Collapse folder" : "Expand folder"}
          className={cn(
            "grid h-5 w-5 shrink-0 place-items-center rounded-sm text-sidebar-foreground/40 hover:text-sidebar-foreground/70",
            children.length === 0 && "invisible",
          )}
          onClick={(event) => {
            event.stopPropagation()
            onToggle(folder.id)
          }}
        >
          <ChevronRight className={cn("h-3 w-3 transition-transform", expanded && "rotate-90")} />
        </button>
        <button
          type="button"
          className="min-w-0 flex-1 overflow-hidden text-left"
          onClick={() => onSelect(folder.id)}
        >
          <span className="block truncate" title={folder.name}>{folder.name}</span>
        </button>
      </div>

      {expanded && children.length > 0 && (
        <div className="ml-5 space-y-0.5 border-l border-sidebar-border/30">
          {children.map((child) => (
            <SidebarFolderTreeNode
              key={child.id}
              folder={child}
              depth={depth + 1}
              currentFolderId={currentFolderId}
              foldersByParent={foldersByParent}
              expandedFolderIds={expandedFolderIds}
              onToggle={onToggle}
              onSelect={onSelect}
              activeScope={activeScope}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ===== Sidebar =====
export default function AppSidebar() {
  const navigate = useNavigate()
  const { workspaceId, projectId } = useParams<{ workspaceId: string; projectId?: string }>()
  const { pathname, search } = useLocation()
  const { user, loading } = useSupabaseUser()

  const [workspaces, setWorkspaces] = React.useState<Workspace[]>([])
  const [loadingWorkspaces, setLoadingWorkspaces] = React.useState(true)

  // Badges / status
  const [unreadCount, setUnreadCount] = React.useState<number>(0)
  const [isOnTrial] = React.useState<boolean>(false) // TODO(DB): workspaces.billing_status
  const [ytConnected] = React.useState<boolean>(false) // TODO(DB): youtube_connections.valid_token

  // Recent projects for quick access
  const [recentProjects, setRecentProjects] = React.useState<ProjectSummary[]>([])

  // All projects in workspace
  const [allProjects, setAllProjects] = React.useState<ProjectSummary[]>([])
  const [collections, setCollections] = React.useState<CollectionSummary[]>([])
  const [quickViewCounts, setQuickViewCounts] = React.useState<QuickViewCounts>(emptyQuickViewCounts)
  const [folders, setFolders] = React.useState<FolderRow[]>([])
  const [expandedFolderIds, setExpandedFolderIds] = React.useState<Set<string>>(() => new Set())
  const [expandedProjectIds, setExpandedProjectIds] = React.useState<Set<string>>(() => new Set())
  const [projectFolderIds, setProjectFolderIds] = React.useState<Record<string, string[]>>({})
  const [loadingProjectFolderIds, setLoadingProjectFolderIds] = React.useState<Set<string>>(() => new Set())
  const projectFolderIdsRef = React.useRef<Record<string, string[]>>({})
  const loadingProjectFolderIdsRef = React.useRef<Set<string>>(new Set())
  const folderRequestSeqRef = React.useRef(0)

  React.useEffect(() => {
    projectFolderIdsRef.current = projectFolderIds
  }, [projectFolderIds])

  React.useEffect(() => {
    loadingProjectFolderIdsRef.current = loadingProjectFolderIds
  }, [loadingProjectFolderIds])

  // Role gating (simple)
  type Role = 'admin' | 'member' | 'reviewer'
  const [role] = React.useState<Role>('member') // TODO(DB): derive from organization_members

  const can = {
    posts: role !== 'reviewer',
    approvals: role !== 'reviewer',
    connections: role === 'admin',
    billing: role === 'admin',
  }

  // Current workspace name
  const currentWorkspace = React.useMemo(() => {
    const ws = workspaces.find((w: Workspace) => w.id === workspaceId)
    return ws?.name
  }, [workspaces, workspaceId])

  React.useEffect(() => {
    rememberActiveWorkspace(workspaceId)
  }, [workspaceId])

  // Fetch workspaces
  React.useEffect(() => {
    if (!user || loading) return
    let isMounted = true
    let channel: ReturnType<typeof supabase.channel> | null = null

    async function fetchWorkspacesForUser() {
      setLoadingWorkspaces(true)
      try {
        const { data, error } = await supabase
          .from('workspaces')
          .select(`
            id, name, organization_id, status, created_at, logo_url,
            organizations:organization_id (
              organization_members ( user_id, role )
            )
          `)
          .neq('status', 'deleted')
          .order('created_at', { ascending: true })
        if (error) throw error
        const rows = (data || []).filter((r: any) =>
          (Array.isArray(r.organizations?.organization_members)
            ? r.organizations.organization_members
            : []
          ).some((m: any) => m.user_id === user?.id)
        )

        const mapped = rows.map((r: any) => {
          const LogoComponent = ({ className }: { className?: string }) => {
            if (r.logo_url) {
              return <img src={r.logo_url} alt={r.name} className={`rounded-lg object-cover ${className}`} />
            }
            return (
              <div className={`rounded-lg border flex items-center justify-center ${className}`}>
                <Users className="size-3 text-muted-foreground" />
              </div>
            )
          }
          return {
            id: r.id,
            name: r.name,
            organizationId: r.organization_id,
            logo: LogoComponent,
          }
        })

        if (isMounted) setWorkspaces(mapped)
        // TODO(DB): also setRole from org_membership.role for this workspace
      } catch (e) {
        console.error('Failed to load workspaces', e)
      } finally {
        if (isMounted) setLoadingWorkspaces(false)
      }
    }

    fetchWorkspacesForUser()

    // Realtime subscription for workspace updates
    channel = supabase
      .channel('workspaces-sidebar-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'workspaces' },
        () => {
          // Refresh list on any workspace change
          fetchWorkspacesForUser()
        }
      )
      .subscribe()

    return () => {
      isMounted = false
      if (channel) supabase.removeChannel(channel)
    }
  }, [user, loading])

  // Notifications badge
  React.useEffect(() => {
    if (!workspaceId || !user || loading) {
      setUnreadCount(0)
      return
    }
    let cancelled = false

    async function loadUnreadCount() {
      const { data } = await invokeEdgeFunction<{ data?: { count?: number } }>('notifications', {
        body: { action: 'unread-count', workspace_id: workspaceId },
      })
      if (!cancelled) setUnreadCount(Number(data?.data?.count ?? 0) || 0)
    }

    void loadUnreadCount()
    const interval = window.setInterval(loadUnreadCount, 60_000)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [loading, user, workspaceId])

  // Approvals / failed posts / recent projects / billing / connections
  React.useEffect(() => {
    if (!workspaceId) return
    let isMounted = true
    const cached = workspaceProjectsCache.get(workspaceId)
    if (cached) {
      setAllProjects(cached.all)
      setRecentProjects(cached.recent)
    }

    async function refreshProjects() {
      try {
        // ===== All projects
        const { data: allProj } = await supabase
          .from('projects')
          .select('id, name, workspace_id, status, created_at')
          .eq('workspace_id', workspaceId)
          .neq('status', 'deleted')
          .order('created_at', { ascending: false })

        if (isMounted && allProj) {
          const mapped = allProj.map((d: ProjectSummary) => ({
            id: d.id,
            name: d.name,
            status: d.status
          }))
          const next = { all: mapped, recent: mapped.slice(0, 5) }
          workspaceProjectsCache.set(workspaceId, next)
          React.startTransition(() => {
            setAllProjects(next.all)
            setRecentProjects(next.recent)
          })
        }
      } catch {
        /* noop */
      }
    }
    // initial fetch
    refreshProjects()
    // subscribe to project changes for this workspace
    const channel = supabase
      .channel('projects-recent')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'projects', filter: `workspace_id=eq.${workspaceId}` },
        () => refreshProjects()
      )
      .subscribe()

    const onProjectsChanged = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : undefined
      if (detail?.workspaceId && detail.workspaceId !== workspaceId) return
      workspaceProjectsCache.delete(workspaceId)
      void refreshProjects()
    }

    window.addEventListener('projects:changed', onProjectsChanged)
    return () => {
      isMounted = false
      window.removeEventListener('projects:changed', onProjectsChanged)
      supabase.removeChannel(channel)
    }
  }, [workspaceId])

  // Keyboard shortcuts (g c / g l / g p / g a / g n)
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (
        e.target &&
        (e.target as HTMLElement).tagName?.match(/input|textarea/i)
      )
        return
      if (e.key.toLowerCase() === 'g') {
        const handler = (evt: KeyboardEvent) => {
          const k = evt.key.toLowerCase()
          if (k === 'c') navigate(`${base}/projects`)
          if (k === 'l') navigate(`${base}/assets`)
          if (k === 'p') navigate(`${base}/posts`)
          if (k === 'a') navigate(`${base}/approvals`)
          window.removeEventListener('keydown', handler, true)
        }
        window.addEventListener('keydown', handler, true)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const base = `/workspace/${workspaceId}`
  const isOnRoot = pathname === base || pathname === `${base}/`
  const currentCollectionId = React.useMemo(() => {
    const match = pathname.match(new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/collections/([^/]+)$`))
    return match?.[1] ?? null
  }, [base, pathname])
  const currentFolderId = React.useMemo(() => new URLSearchParams(search).get('folder'), [search])
  const isProjectBrowser = Boolean(projectId && pathname.startsWith(`${base}/projects/${projectId}`))
  const showFolderTree = Boolean(workspaceId)

  React.useEffect(() => {
    if (!workspaceId || !showFolderTree) {
      setFolders([])
      return
    }

    const cached = workspaceFoldersCache.get(workspaceId)
    if (cached) setFolders(cached)

    let mounted = true
    const controller = new AbortController()
    async function loadFolders() {
      const requestSeq = ++folderRequestSeqRef.current
      try {
        const { data, error } = await invokeEdgeFunction<{ data?: FolderRow[] }>('asset', {
          body: { action: 'list_folders', workspace_id: workspaceId },
          signal: controller.signal,
        })
        if (error) throw error
        if (!mounted || requestSeq !== folderRequestSeqRef.current) return
        const nextFolders = Array.isArray(data?.data) ? data.data : []
        workspaceFoldersCache.set(workspaceId, nextFolders)
        React.startTransition(() => setFolders(nextFolders))
      } catch (err) {
        if (controller.signal.aborted) return
        console.warn('Failed to load sidebar folders', err)
        if (mounted) setFolders([])
      }
    }

    void loadFolders()
    const onFoldersChanged = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : undefined
      if (detail?.projectId && detail?.folderId) {
        projectFolderIdsCache.delete(String(detail.projectId))
        setProjectFolderIds((prev) => {
          const existing = new Set(prev[String(detail.projectId)] ?? [])
          existing.add(String(detail.folderId))
          return {
            ...prev,
            [String(detail.projectId)]: Array.from(existing),
          }
        })
      }
      if (!detail?.workspaceId || detail.workspaceId === workspaceId) {
        if (workspaceId) workspaceFoldersCache.delete(workspaceId)
        void loadFolders()
      }
    }
    window.addEventListener('asset-folders:changed', onFoldersChanged)
    return () => {
      mounted = false
      controller.abort()
      window.removeEventListener('asset-folders:changed', onFoldersChanged)
    }
  }, [workspaceId, showFolderTree])

  React.useEffect(() => {
    setProjectFolderIds({})
    projectFolderIdsRef.current = {}
    setLoadingProjectFolderIds(new Set())
    loadingProjectFolderIdsRef.current = new Set()
  }, [workspaceId])

  React.useEffect(() => {
    if (!workspaceId) return
    let isMounted = true

    const cached = workspaceCollectionsCache.get(workspaceId)
    if (cached) setCollections(cached)

    async function refreshCollections() {
      try {
        const { data, error } = await invokeEdgeFunction<{ data?: any[] }>('collections', {
          body: { action: 'list', workspace_id: workspaceId },
        })
        if (error) throw error
        if (!isMounted) return

        const nextCollections = Array.isArray(data?.data)
          ? data.data.map((row: any) => ({
            id: String(row.id),
            name: String(row.name || 'Untitled Collection'),
            logoUrl: row.logo_url ?? row.logoUrl ?? row.brand_logo_url ?? row.cover_url ?? null,
          }))
          : []
        workspaceCollectionsCache.set(workspaceId, nextCollections)
        setCollections(nextCollections)
      } catch (err) {
        console.warn('Failed to load collections for sidebar', err)
        if (isMounted) setCollections([])
      }
    }

    void refreshCollections()
    const onCollectionsChanged = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : undefined
      if (detail?.workspaceId && String(detail.workspaceId) !== String(workspaceId)) return
      workspaceCollectionsCache.delete(workspaceId)
      void refreshCollections()
    }

    window.addEventListener('collections:changed', onCollectionsChanged)
    return () => {
      isMounted = false
      window.removeEventListener('collections:changed', onCollectionsChanged)
    }
  }, [workspaceId])

  React.useEffect(() => {
    if (!workspaceId) {
      setQuickViewCounts(emptyQuickViewCounts)
      return
    }

    const cached = workspaceQuickViewCountsCache.get(workspaceId)
    if (cached) setQuickViewCounts(cached)

    let mounted = true
    async function refreshQuickViewCounts() {
      try {
        const { data, error } = await invokeEdgeFunction<any>('asset', {
          body: { action: 'list_library', workspace_id: workspaceId, limit: 1000 },
        })
        if (error) throw error
        if (!mounted) return
        const payload = data?.data ?? data ?? {}
        const rows = Array.isArray(payload.assets) ? payload.assets : []
        const next = computeQuickViewCounts(rows)
        workspaceQuickViewCountsCache.set(workspaceId, next)
        setQuickViewCounts(next)
      } catch (err) {
        console.warn('Failed to load quick view counts for sidebar', err)
        if (mounted) setQuickViewCounts(emptyQuickViewCounts)
      }
    }

    void refreshQuickViewCounts()
    const onAssetsChanged = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : undefined
      if (detail?.workspaceId && String(detail.workspaceId) !== String(workspaceId)) return
      workspaceQuickViewCountsCache.delete(workspaceId)
      void refreshQuickViewCounts()
    }
    window.addEventListener('assets:changed', onAssetsChanged)
    window.addEventListener('projects:changed', onAssetsChanged)
    return () => {
      mounted = false
      window.removeEventListener('assets:changed', onAssetsChanged)
      window.removeEventListener('projects:changed', onAssetsChanged)
    }
  }, [workspaceId])

  React.useEffect(() => {
    if (!workspaceId) return
    try {
      const rawProjectIds = window.localStorage.getItem(`sidebar-expanded-projects:${workspaceId}`)
      const rawFolderIds = window.localStorage.getItem(`sidebar-expanded-folders:${workspaceId}`)
      setExpandedProjectIds(new Set(rawProjectIds ? JSON.parse(rawProjectIds) : []))
      setExpandedFolderIds(new Set(rawFolderIds ? JSON.parse(rawFolderIds) : []))
    } catch {
      setExpandedProjectIds(new Set())
      setExpandedFolderIds(new Set())
    }
  }, [workspaceId])

  React.useEffect(() => {
    if (!workspaceId) return
    window.localStorage.setItem(
      `sidebar-expanded-projects:${workspaceId}`,
      JSON.stringify(Array.from(expandedProjectIds)),
    )
  }, [expandedProjectIds, workspaceId])

  React.useEffect(() => {
    if (!workspaceId) return
    window.localStorage.setItem(
      `sidebar-expanded-folders:${workspaceId}`,
      JSON.stringify(Array.from(expandedFolderIds)),
    )
  }, [expandedFolderIds, workspaceId])

  const foldersById = React.useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders])
  const currentFolderTrail = React.useMemo(() => {
    const trail: FolderRow[] = []
    let cursor = currentFolderId
    while (cursor) {
      const folder = foldersById.get(cursor)
      if (!folder) break
      trail.unshift(folder)
      cursor = folder.parent_folder_id ?? null
    }
    return trail
  }, [currentFolderId, foldersById])

  const loadProjectFolderIds = React.useCallback(async (targetProjectId: string) => {
    if (!targetProjectId) return

    const cached = projectFolderIdsCache.get(targetProjectId)
    if (cached) {
      setProjectFolderIds((prev) => (
        prev[targetProjectId] ? prev : { ...prev, [targetProjectId]: cached }
      ))
      return
    }
    if (
      projectFolderIdsRef.current[targetProjectId] ||
      loadingProjectFolderIdsRef.current.has(targetProjectId)
    ) return

    loadingProjectFolderIdsRef.current = new Set(loadingProjectFolderIdsRef.current).add(targetProjectId)
    setLoadingProjectFolderIds(new Set(loadingProjectFolderIdsRef.current))
    try {
      const { data, error } = await invokeEdgeFunction<{
        data?: ProjectAssetFolderRow
      }>('asset', {
        body: { action: 'list_project_folders', project_id: targetProjectId },
      })
      if (error) throw error

      const nextIds = Array.isArray(data?.data?.folder_ids) ? data.data.folder_ids : []
      projectFolderIdsCache.set(targetProjectId, nextIds)
      setProjectFolderIds((prev) => {
        const next = {
          ...prev,
          [targetProjectId]: nextIds,
        }
        projectFolderIdsRef.current = next
        return next
      })
    } catch (err) {
      console.warn('Failed to load project folders for sidebar', err)
      setProjectFolderIds((prev) => {
        const next = {
          ...prev,
          [targetProjectId]: [],
        }
        projectFolderIdsRef.current = next
        return next
      })
    } finally {
      const nextLoading = new Set(loadingProjectFolderIdsRef.current)
      nextLoading.delete(targetProjectId)
      loadingProjectFolderIdsRef.current = nextLoading
      setLoadingProjectFolderIds(nextLoading)
    }
  }, [])

  const getProjectFoldersByParent = React.useCallback((targetProjectId: string) => {
    const directIds = projectFolderIds[targetProjectId] ?? []
    const visibleIds = new Set<string>()

    for (const directId of directIds) {
      let cursor: string | null | undefined = directId
      while (cursor) {
        const folder = foldersById.get(cursor)
        if (!folder || visibleIds.has(folder.id)) break
        visibleIds.add(folder.id)
        cursor = folder.parent_folder_id ?? null
      }
    }

    const grouped = new Map<string | null, FolderRow[]>()
    for (const folder of folders) {
      if (!visibleIds.has(folder.id)) continue
      const key = folder.parent_folder_id ?? null
      grouped.set(key, [...(grouped.get(key) ?? []), folder])
    }
    for (const [key, rows] of grouped.entries()) {
      grouped.set(
        key,
        [...rows].sort((a, b) => {
          const diff = (a.sort_order ?? 0) - (b.sort_order ?? 0)
          if (diff !== 0) return diff
          return a.name.localeCompare(b.name)
        }),
      )
    }
    return grouped
  }, [folders, foldersById, projectFolderIds])

  React.useEffect(() => {
    if (currentFolderTrail.length === 0) return
    setExpandedFolderIds((prev) => {
      const next = new Set(prev)
      let changed = false
      for (const folder of currentFolderTrail) {
        if (next.has(folder.id)) continue
        next.add(folder.id)
        changed = true
      }
      return changed ? next : prev
    })
  }, [currentFolderTrail])

  React.useEffect(() => {
    if (!projectId) return
    setExpandedProjectIds((prev) => {
      if (prev.has(projectId)) return prev
      const next = new Set(prev)
      next.add(projectId)
      return next
    })
    void loadProjectFolderIds(projectId)
  }, [loadProjectFolderIds, projectId])

  React.useEffect(() => {
    if (!workspaceId || expandedProjectIds.size === 0) return
    for (const expandedProjectId of expandedProjectIds) {
      void loadProjectFolderIds(expandedProjectId)
    }
  }, [expandedProjectIds, loadProjectFolderIds, workspaceId])

  const toggleFolder = React.useCallback((folderId: string) => {
    setExpandedFolderIds((prev) => {
      const next = new Set(prev)
      if (next.has(folderId)) next.delete(folderId)
      else next.add(folderId)
      return next
    })
  }, [])

  const toggleProject = React.useCallback((targetProjectId: string) => {
    setExpandedProjectIds((prev) => {
      const next = new Set(prev)
      if (next.has(targetProjectId)) next.delete(targetProjectId)
      else next.add(targetProjectId)
      return next
    })
  }, [])

  const navigateToProjectFolder = React.useCallback((targetProjectId: string, folderId: string | null) => {
    const projectPath = `${base}/projects/${targetProjectId}`
    navigate(folderId ? `${projectPath}?folder=${encodeURIComponent(folderId)}` : projectPath)
  }, [base, navigate])

  const switcherData = React.useMemo(
    () => workspaces.map((w: Workspace) => ({ name: w.name, logo: w.logo })),
    [workspaces]
  )

  const handleWorkspaceSelect = React.useCallback(
    (name: string) => {
      const ws = workspaces.find((w: Workspace) => w.name === name)
      if (ws) {
        rememberActiveWorkspace(ws.id)
        navigate(`/workspace/${ws.id}/projects`)
      }
    },
    [navigate, workspaces]
  )

  if (!workspaceId) {
    return (
      <Sidebar collapsible="icon" role="navigation" aria-label="Primary">
        <SidebarHeader>
          <WorkspaceSwitcher
            workspaces={switcherData}
            currentWorkspace={currentWorkspace}
            onSelect={handleWorkspaceSelect}
            loading={loadingWorkspaces}
          />
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Workspace</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarNavLink
                to="/workspaces"
                icon={LayoutGrid}
                label="All Workspaces"
                isActiveOverride={(p) => p === "/workspaces" || p === "/workspaces/"}
              />
              <SidebarNavLink
                to="/account"
                icon={Settings}
                label="Account Settings"
                isActiveOverride={(p) => p.startsWith("/account")}
              />
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          {!loading && user ? (
            <NavUser
              user={{ id: user.id, name: user.name, email: user.email, avatar: user.avatar }}
            />
          ) : (
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton disabled={loading || loadingWorkspaces} asChild>
                  <a href="/auth">
                    <Users />
                    <span>Sign in</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          )}
        </SidebarFooter>
      </Sidebar>
    )
  }

  return (
    <Sidebar collapsible="icon" role="navigation" aria-label="Primary">
      <SidebarHeader>
        <WorkspaceSwitcher
          workspaces={switcherData}
          currentWorkspace={currentWorkspace}
          onSelect={handleWorkspaceSelect}
          loading={loadingWorkspaces}
        />
        <SidebarMenu className="sidebar-collapsible-hidden px-0">
          <SidebarNavLink
            to={`${base}/assets`}
            icon={SearchIcon}
            label="Search"
            className="h-9 rounded-lg bg-sidebar-accent/28 px-3 text-sidebar-foreground/52 hover:bg-sidebar-accent/42 hover:text-sidebar-foreground/75 data-[active=true]:bg-sidebar-accent/48 [&>svg]:text-sidebar-foreground/35"
            isActiveOverride={(p) => p === `${base}/assets` || p.startsWith(`${base}/assets/`)}
          />
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="gap-0">
        {/* RECENT */}
        {recentProjects.length > 0 && !showFolderTree && (
          <SidebarGroup className="mt-1">
            <SidebarGroupLabel>Recent</SidebarGroupLabel>
            <SidebarMenu>
              {recentProjects.map((c: { id: string; name: string }) => (
                <SidebarMenuItem key={c.id}>
                  <SidebarMenuButton
                    tooltip={c.name}
                    className="w-full min-w-0 justify-start"
                    onClick={() => navigate(`${base}/projects/${c.id}`)}
                  >
                    <Clock className="h-4 w-4" />
                    <span className="block truncate">{c.name}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        )}

        {/* WORK / PROJECT TREE */}
        <SidebarGroup className="pt-0">
          <SidebarSectionHeader
            label="Projects"
            onClick={() => navigate(`${base}/projects`)}
            actionLabel="New project"
            onAction={() => navigate(`${base}/projects/new`)}
          />
          <SidebarGroupContent>
            <div className="hidden group-data-[collapsible=icon]:block">
              <SidebarNavLink
                to={`${base}/projects`}
                icon={Folder}
                label="Projects"
                isActiveOverride={(p) => p.startsWith(`${base}/projects`) || isOnRoot}
              />
            </div>
            {allProjects.length > 0 && (
              <div className="mt-1 space-y-0.5 group-data-[collapsible=icon]:hidden">
                {allProjects.map((project) => {
                  const projectActive = isProjectBrowser && project.id === projectId
                  const projectRootActive = projectActive && !currentFolderId
                  const projectExpanded = expandedProjectIds.has(project.id)
                  const projectFoldersByParent = getProjectFoldersByParent(project.id)
                  const projectRootFolders = projectFoldersByParent.get(null) ?? []
                  const hasProjectFolders = projectRootFolders.length > 0

                  return (
                    <div key={project.id}>
                      <div
                        className={cn(
                          "group/project-row relative flex h-8 min-w-0 items-center gap-1 overflow-hidden rounded-md pr-2 text-[13px] transition-colors",
                          projectRootActive
                            ? "bg-sidebar-accent/48 font-semibold text-sidebar-foreground/92 before:absolute before:bottom-1.5 before:left-0 before:top-1.5 before:w-0.5 before:rounded-r-full before:bg-sidebar-primary/80"
                            : "font-medium text-sidebar-foreground/68 hover:bg-sidebar-accent/35 hover:text-sidebar-foreground/86",
                        )}
                        style={{ paddingLeft: 12 }}
                      >
                        {hasProjectFolders ? (
                          <button
                            type="button"
                            aria-label={projectExpanded ? "Collapse project" : "Expand project"}
                            className="grid h-5 w-5 shrink-0 place-items-center rounded-sm text-sidebar-foreground/42 hover:text-sidebar-foreground/75"
                            onClick={(event) => {
                              event.stopPropagation()
                              toggleProject(project.id)
                              if (!projectExpanded) void loadProjectFolderIds(project.id)
                            }}
                          >
                            <ChevronRight className={cn("h-3 w-3 transition-transform", projectExpanded && "rotate-90")} />
                          </button>
                        ) : (
                          <span className="h-5 w-5 shrink-0" />
                        )}
                        <button
                          type="button"
                          className="min-w-0 flex-1 overflow-hidden text-left"
                          onClick={() => navigate(`${base}/projects/${project.id}`)}
                        >
                          <span className="block truncate" title={project.name}>{project.name}</span>
                        </button>
                      </div>

                      {projectExpanded && hasProjectFolders && projectRootFolders.map((folder) => (
                        <SidebarFolderTreeNode
                          key={folder.id}
                          folder={folder}
                          depth={1}
                          currentFolderId={currentFolderId}
                          foldersByParent={projectFoldersByParent}
                          expandedFolderIds={expandedFolderIds}
                          onToggle={toggleFolder}
                          onSelect={(folderId) => navigateToProjectFolder(project.id, folderId)}
                          activeScope={projectActive}
                        />
                      ))}
                    </div>
                  )
                })}
              </div>
            )}
          </SidebarGroupContent>
        </SidebarGroup>

        {/* REVIEW */}
        <SidebarGroup>
          <SidebarSectionHeader
            label="Collections"
            onClick={() => navigate(`${base}/collections`)}
            actionLabel="New collection"
            onAction={() => navigate(`${base}/collections`)}
          />
          <SidebarGroupContent>
            <SidebarNavLink
              to={`${base}/collections`}
              icon={CollectionCardsIcon}
              label="All Collections"
              badge={collections.length > 0 ? collections.length : undefined}
              isActiveOverride={(p) => p === `${base}/collections` || p === `${base}/collections/`}
            />
            {collections.length > 0 && (
              <div className="mt-1 space-y-0.5 group-data-[collapsible=icon]:hidden">
                {collections.map((collection) => {
                  const active = currentCollectionId === collection.id
                  return (
                    <button
                      key={collection.id}
                      type="button"
                      className={cn(
                        "relative flex h-8 w-full min-w-0 items-center gap-2 overflow-hidden rounded-md px-3 text-left text-[13px] transition-colors",
                        active
                          ? "bg-sidebar-accent/48 font-semibold text-sidebar-foreground/88 before:absolute before:bottom-1.5 before:left-0 before:top-1.5 before:w-0.5 before:rounded-r-full before:bg-sidebar-primary/80 [&>svg]:text-sidebar-foreground/82"
                          : "text-sidebar-foreground/58 hover:bg-sidebar-accent/35 hover:text-sidebar-foreground/78",
                      )}
                      onClick={() => navigate(`${base}/collections/${collection.id}`)}
                    >
                      <CollectionLogoIcon collection={collection} />
                      <span className="block truncate" title={collection.name}>{collection.name}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarSectionHeader label="Quick Views" />
          <SidebarGroupContent>
            <SidebarNavLink
              to={`${base}/views/all`}
              label="All"
              badge={quickViewCounts.all || undefined}
              isActiveOverride={(p) => p.startsWith(`${base}/views/all`)}
            />
            <SidebarNavLink
              to={`${base}/views/needs-review`}
              label="Needs review"
              badge={quickViewCounts.needsReview || undefined}
              dotClassName="bg-amber-400/85"
              isActiveOverride={(p) => p.startsWith(`${base}/views/needs-review`)}
            />
            <SidebarNavLink
              to={`${base}/views/in-review`}
              label="In Review"
              badge={quickViewCounts.inReview || undefined}
              dotClassName="bg-sky-400/85"
              isActiveOverride={(p) => p.startsWith(`${base}/views/in-review`)}
            />
            <SidebarNavLink
              to={`${base}/views/approved`}
              label="Approved"
              badge={quickViewCounts.approved || undefined}
              dotClassName="bg-emerald-400/85"
              isActiveOverride={(p) => p.startsWith(`${base}/views/approved`)}
            />

            <SidebarNavLink
              to={`${base}/views/video`}
              icon={FileVideo}
              label="Video"
              badge={quickViewCounts.video || undefined}
              isActiveOverride={(p) => p.startsWith(`${base}/views/video`)}
            />
            <SidebarNavLink
              to={`${base}/views/image`}
              icon={FileImage}
              label="Image"
              badge={quickViewCounts.image || undefined}
              isActiveOverride={(p) => p.startsWith(`${base}/views/image`)}
            />
            <SidebarNavLink
              to={`${base}/views/pdf`}
              icon={FileText}
              label="PDFs"
              badge={quickViewCounts.pdf || undefined}
              isActiveOverride={(p) => p.startsWith(`${base}/views/pdf`)}
            />
            <SidebarNavLink
              to={`${base}/views/website-review`}
              icon={Globe2}
              label="Website review"
              badge={quickViewCounts.websiteReview || undefined}
              isActiveOverride={(p) => p.startsWith(`${base}/views/website-review`)}
            />

          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="mt-auto border-t border-sidebar-border/45 pt-3">
          <SidebarSectionHeader label="Admin" />
          <SidebarGroupContent>
            <NotificationDrawer
              workspaceId={workspaceId}
              unreadCount={unreadCount}
              onUnreadCountChange={setUnreadCount}
            />
            {can.connections && (
              <SidebarNavLink
                to={`${base}/connections`}
                icon={Link2}
                label={ytConnected ? 'Connections' : 'Connect YouTube'}
                isActiveOverride={(p) => p.startsWith(`${base}/connections`)}
              />
            )}
            {can.billing && (
              <SidebarNavLink
                to={`${base}/billing`}
                icon={CreditCard}
                label="Billing"
                badge={isOnTrial ? 'Trial' : undefined}
                isActiveOverride={(p) => p.startsWith(`${base}/billing`)}
              />
            )}
            <SidebarNavLink
              to={`${base}/teams`}
              icon={Users}
              label="Manage Team"
              isActiveOverride={(p) => p.startsWith('/teams')}
            />
            <SidebarNavLink
              to={`${base}/settings`}
              icon={Settings}
              label="Settings"
              isActiveOverride={(p) => p.startsWith(`${base}/settings`)}
            />
            <SidebarNavLink
              to={`${base}/help`}
              icon={HelpCircle}
              label="Help"
              isActiveOverride={(p) => p.startsWith(`${base}/help`)}
            />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        {!loading && user ? (
          <NavUser
            user={{ id: user.id, name: user.name, email: user.email, avatar: user.avatar }}
          />
        ) : (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton disabled={loading || loadingWorkspaces} asChild>
                <a href="/auth">
                  <Users />
                  <span>Sign in</span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        )}
      </SidebarFooter>
    </Sidebar>
  )
}
