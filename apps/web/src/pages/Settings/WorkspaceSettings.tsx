import React from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { supabase } from "@/lib/supabaseClient"
import { invokeEdgeFunction } from "@/api/edge"

import {
  Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { getAvatarInitials, AVATAR_FALLBACK_CLASS } from "@/lib/avatar-utils"
import { Progress } from "@/components/ui/progress"
import { toast } from "sonner"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import {
  Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import {
  Popover, PopoverTrigger, PopoverContent,
} from "@/components/ui/popover"
import {
  Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem,
} from "@/components/ui/command"
import { Check, ChevronsUpDown } from "lucide-react"

/* ------------------------------------------------------------------ */
/* Types (match your schema)                                           */
/* ------------------------------------------------------------------ */
interface Org {
  id: string;
  name: string;
  billing_plans?: {
    code: string;
    name: string;
    max_seats: number;
    max_storage_bytes: number;
    metadata: any;
  }
}
type Workspace = { id: string; name: string | null; logo_url: string | null; organization_id: string }
type WorkspaceSettingsPayload = {
  workspace: Workspace | null
  organization: Org | null
  orgs?: Org[]
  orgWorkspaces?: Workspace[]
  orgWorkspaceCount?: number
  orgUserCount?: number
  wsStorageUsed?: number
  orgStorageUsed?: number
}
type WorkspaceSettingsResponse = {
  data?: WorkspaceSettingsPayload | null
}

/* ------------------------------------------------------------------ */
/* Utilities                                                           */
/* ------------------------------------------------------------------ */
function formatBytes(bytes: number) {
  if (!bytes) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}

function getOrgLimits(org: Org | null) {
  const planDetails = org?.billing_plans

  if (planDetails) {
    return {
      storage_limit_bytes: Number(planDetails.max_storage_bytes) || (1 * 1024 * 1024 * 1024),
      user_limit: planDetails.max_seats === null ? Infinity : Number(planDetails.max_seats),
      workspace_limit: 10,
    }
  }

  return {
    storage_limit_bytes: 1 * 1024 * 1024 * 1024,
    user_limit: 1,
    workspace_limit: 1,
  }
}

/* ------------------------------------------------------------------ */
/* Switchers                                                           */
/* ------------------------------------------------------------------ */
function OrgSwitcher({
  orgs, activeId, onChange,
}: { orgs: Org[]; activeId?: string | null; onChange: (id: string) => void }) {
  const [open, setOpen] = React.useState(false)
  const active = orgs.find(o => o.id === activeId)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" className="h-7 px-2">
          {active?.name ?? "Organization"} <ChevronsUpDown className="ml-1 h-4 w-4 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-64">
        <Command>
          <CommandInput placeholder="Switch org..." />
          <CommandList>
            <CommandEmpty>No organizations.</CommandEmpty>
            <CommandGroup>
              {orgs.map(o => (
                <CommandItem key={o.id} onSelect={() => { onChange(o.id); setOpen(false) }}>
                  <Check className={`mr-2 h-4 w-4 ${o.id === activeId ? "opacity-100" : "opacity-0"}`} />
                  {o.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function WorkspaceSwitcher({
  workspaces, activeId, onChange,
}: { workspaces: Workspace[]; activeId?: string | null; onChange: (id: string) => void }) {
  const [open, setOpen] = React.useState(false)
  const active = workspaces.find(w => w.id === activeId)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" className="h-7 px-2">
          {active?.name ?? "Workspace"} <ChevronsUpDown className="ml-1 h-4 w-4 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-72">
        <Command>
          <CommandInput placeholder="Switch workspace..." />
          <CommandList>
            <CommandEmpty>No workspaces.</CommandEmpty>
            <CommandGroup>
              {workspaces.map(w => (
                <CommandItem key={w.id} onSelect={() => { onChange(w.id); setOpen(false) }}>
                  <Check className={`mr-2 h-4 w-4 ${w.id === activeId ? "opacity-100" : "opacity-0"}`} />
                  {w.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/* ------------------------------------------------------------------ */
/* Org Usage & Limits                                                   */
/* ------------------------------------------------------------------ */
function OrgUsageAndLimits({
  org, storageUsedBytes, userCount, workspaceCount
}: {
  org: Org
  storageUsedBytes: number
  userCount: number
  workspaceCount: number
}) {
  const limits = getOrgLimits(org)
  const storageLimit = limits.storage_limit_bytes
  const storagePct = Math.min(100, Math.round((storageUsedBytes / storageLimit) * 100))
  const usersPct = limits.user_limit === Infinity ? 0 : Math.min(100, Math.round((userCount / limits.user_limit) * 100))
  const wssPct = Math.min(100, Math.round((workspaceCount / limits.workspace_limit) * 100))

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2 justify-between">
          <div className="flex items-center gap-2">
            <CardTitle>Organization usage & limits</CardTitle>
            <Badge variant="secondary">Local OSS limits</Badge>
          </div>
        </div>
        <CardDescription>
          Usage is tracked at the <span className="font-medium">{org.name}</span> level for users, workspaces, and storage.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2 sm:max-w-lg">
          <div className="flex justify-between text-sm">
            <span>Storage</span><span>{storagePct}%</span>
          </div>
          <Progress value={storagePct} />
          <p className="text-xs text-muted-foreground">
            {formatBytes(storageUsedBytes)} of {formatBytes(storageLimit)} used org-wide.
          </p>
        </div>

        {/* Users */}
        <div className="space-y-2 sm:max-w-lg">
          <div className="flex justify-between text-sm">
            <span>Users</span>
            <span>{userCount} / {limits.user_limit === Infinity ? "Unlimited" : limits.user_limit} {limits.user_limit === Infinity ? "" : `(${usersPct}%)`}</span>
          </div>
          <Progress value={usersPct} />
        </div>

        <div className="space-y-2 sm:max-w-lg">
          <div className="flex justify-between text-sm">
            <span>Workspaces</span>
            <span>{workspaceCount} / {limits.workspace_limit} ({wssPct}%)</span>
          </div>
          <Progress value={wssPct} />
        </div>
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function WorkspaceSettings() {
  const { workspaceId } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)

  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [uploading, setUploading] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)

  const [name, setName] = React.useState("")
  const [logoUrl, setLogoUrl] = React.useState<string | null>(null)
  const [initialName, setInitialName] = React.useState("")
  const [initialLogoUrl, setInitialLogoUrl] = React.useState<string | null>(null)

  const [org, setOrg] = React.useState<Org | null>(null)
  const [orgs, setOrgs] = React.useState<Org[]>([])
  const [orgWorkspaces, setOrgWorkspaces] = React.useState<Workspace[]>([])

  // org-wide usage
  const [orgStorageUsed, setOrgStorageUsed] = React.useState(0)
  const [orgUserCount, setOrgUserCount] = React.useState(0)
  const [orgWorkspaceCount, setOrgWorkspaceCount] = React.useState(0)

  // workspace usage
  const [wsStorageUsed, setWsStorageUsed] = React.useState(0)

  const isDirty = name !== initialName || logoUrl !== initialLogoUrl
  const [confirmInput, setConfirmInput] = React.useState("")

  React.useEffect(() => {
    if (!workspaceId) return
    let mounted = true

      ; (async () => {
        setLoading(true)
        try {
          const { data, error } = await invokeEdgeFunction<WorkspaceSettingsResponse>("workspace", {
            body: { action: "settings", workspace_id: workspaceId },
          })
          if (error) throw error

          const payload = data?.data ?? null
          const ws = payload?.workspace ?? null

          if (!ws) throw new Error("Workspace not found")

          if (!mounted) return

          setName(ws.name ?? "")
          setLogoUrl(ws.logo_url ?? null)
          setInitialName(ws.name ?? "")
          setInitialLogoUrl(ws.logo_url ?? null)

          setOrg(payload?.organization ?? null)
          setOrgs(Array.isArray(payload?.orgs) ? payload.orgs : [])
          setOrgWorkspaces(Array.isArray(payload?.orgWorkspaces) ? payload.orgWorkspaces : [])
          setOrgWorkspaceCount(Number(payload?.orgWorkspaceCount ?? 0) || 0)
          setOrgUserCount(Number(payload?.orgUserCount ?? 0) || 0)
          setWsStorageUsed(Number(payload?.wsStorageUsed ?? 0) || 0)
          setOrgStorageUsed(Number(payload?.orgStorageUsed ?? 0) || 0)

        } catch (e) {
          console.error("Failed to load workspace settings", e)
          toast("Failed to load workspace settings")
        } finally {
          if (mounted) setLoading(false)
        }
      })()

    return () => { mounted = false }
  }, [workspaceId])

  const handleSave = async () => {
    if (!workspaceId) return
    setSaving(true)
    try {
      const { error } = await invokeEdgeFunction("workspace", {
        method: "PATCH",
        body: { id: workspaceId, name, logo_url: logoUrl }
      })
      if (error) throw error
      setInitialName(name)
      setInitialLogoUrl(logoUrl)
      toast("Workspace updated")
    } catch (e) {
      console.error(e)
      toast("Could not update workspace")
    } finally {
      setSaving(false)
    }
  }

  const handleUploadClick = () => fileInputRef.current?.click()

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !workspaceId) return
    setUploading(true)
    try {
      const filePath = `workspace_${workspaceId}/${Date.now()}_${file.name}`
      const { error: uploadErr } = await supabase.storage
        .from("workspaces")
        .upload(filePath, file, { upsert: true })
      if (uploadErr) throw uploadErr

      const { data: urlData } = supabase.storage.from("workspaces").getPublicUrl(filePath)
      const publicUrl = urlData?.publicUrl ?? null
      setLogoUrl(publicUrl)
      toast("Image uploaded; press Save to apply")
    } catch (e) {
      console.error(e)
      toast("Image upload failed")
    } finally {
      setUploading(false)
      if (e.currentTarget) e.currentTarget.value = ""
    }
  }

  const handleDelete = async () => {
    if (!workspaceId) return
    setDeleting(true)
    try {
      const { error } = await invokeEdgeFunction("workspace", {
        method: "DELETE",
        body: { id: workspaceId }
      })
      if (error) throw error
      toast("Workspace deleted")
      navigate("/workspaces")
    } catch (e) {
      console.error(e)
      toast("Could not delete workspace")
    } finally {
      setDeleting(false)
    }
  }

  const handleOrgChange = (id: string) => {
    searchParams.set("orgId", id)
    setSearchParams(searchParams, { replace: true })
    navigate(`/orgs/${id}/workspaces`)
  }
  const handleWorkspaceChange = (id: string) => navigate(`/workspaces/${id}/settings`)

  if (!workspaceId) return <div className="p-6">Workspace not specified</div>

  const limits = getOrgLimits(org)
  const orgStoragePct = Math.min(100, Math.round((orgStorageUsed / limits.storage_limit_bytes) * 100))

  return (
    <div className="max-w-4xl mx-auto px-4 pb-24 space-y-8">
      {/* Context header */}
      <div className="space-y-1 pt-6">
        <div className="flex flex-wrap items-center gap-3">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <OrgSwitcher orgs={orgs} activeId={org?.id ?? null} onChange={handleOrgChange} />
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <WorkspaceSwitcher
                    workspaces={orgWorkspaces}
                    activeId={workspaceId}
                    onChange={handleWorkspaceChange}
                  />
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>Settings</BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <Badge variant="outline">Organization</Badge>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Workspace settings</h1>
        <p className="text-sm text-muted-foreground">
          You’re editing <span className="font-medium">{name || "Workspace"}</span> in{" "}
          <span className="font-medium">{org?.name ?? "Organization"}</span>.
        </p>
      </div>

      {/* WORKSPACE PROFILE */}
      <Card>
        <CardHeader>
          <CardTitle>Workspace profile</CardTitle>
          <CardDescription>Update the name and image visible to members.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-4">
              <Skeleton className="size-16 rounded-full" />
              <div className="grid gap-3 w-full sm:max-w-md">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-10 w-full" />
                <div className="flex gap-2">
                  <Skeleton className="h-8 w-32" />
                  <Skeleton className="h-8 w-20" />
                </div>
                <Skeleton className="h-3 w-40" />
              </div>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-center gap-6">
              <div className="flex flex-col items-center gap-3">
                <Avatar className="size-16">
                  {logoUrl ? <AvatarImage src={logoUrl} alt="Workspace logo" /> : (
                    <AvatarFallback className={`text-lg ${AVATAR_FALLBACK_CLASS}`}>{getAvatarInitials(name || "W")}</AvatarFallback>
                  )}
                </Avatar>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="hidden"
                  disabled={uploading}
                />

                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={handleUploadClick} disabled={uploading}>
                    {uploading ? "Uploading…" : "Upload image"}
                  </Button>
                  {logoUrl && (
                    <Button variant="ghost" size="sm" onClick={() => setLogoUrl(null)}>
                      Remove
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">Use a square image for best results.</p>
              </div>

              <div className="grid gap-2 w-full sm:max-w-md">
                <Label htmlFor="ws-name">Name</Label>
                <Input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Workspace name" />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ORG USAGE & LIMITS */}
      {org ? (
        <OrgUsageAndLimits
          org={org}
          storageUsedBytes={orgStorageUsed}
          userCount={orgUserCount}
          workspaceCount={orgWorkspaceCount}
        />
      ) : (
        <Card><CardContent className="p-6"><Skeleton className="h-20 w-full" /></CardContent></Card>
      )}

      {/* WORKSPACE STORAGE (counts toward org) */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>Storage (this workspace)</CardTitle>
            <Badge variant="secondary">Counts toward org storage</Badge>
          </div>
          <CardDescription>
            This workspace’s storage contributes to your organization total ({orgStoragePct}% used).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <>
              <Skeleton className="h-2 w-full" />
              <div className="flex items-center justify-between text-xs">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-12" />
              </div>
            </>
          ) : (
            <>
              <div className="space-y-2 sm:max-w-lg">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-sm font-medium">{formatBytes(orgStorageUsed)} / {formatBytes(limits.storage_limit_bytes)}</span>
                </div>
                <Progress value={(orgStorageUsed / limits.storage_limit_bytes) * 100} className="h-1.5" />
              </div>
            </>
          )}
        </CardContent>
      </Card>
      {/* DANGER ZONE */}
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-destructive">Danger zone</CardTitle>
          <CardDescription>
            Deleting this workspace also removes its projects and assets. This action can’t be undone.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:max-w-md">
            <Label htmlFor="confirm">Type DELETE to confirm</Label>
            <Input
              id="confirm"
              placeholder="DELETE"
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
            />
          </div>
        </CardContent>
        <CardFooter className="justify-end">
          <Dialog>
            <DialogTrigger asChild>
              <Button
                variant="destructive"
                disabled={deleting || confirmInput.trim().toUpperCase() !== "DELETE"}
              >
                {deleting ? "Deleting…" : "Delete workspace"}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete workspace?</DialogTitle>
                <DialogDescription>
                  This will permanently remove the workspace and all projects.
                </DialogDescription>
              </DialogHeader>
              <Separator />
              <DialogFooter>
                <Button variant="ghost">Cancel</Button>
                <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
                  Confirm deletion
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardFooter>
      </Card>

      {/* Sticky save bar */}
      {isDirty && (
        <div className="fixed inset-x-0 bottom-0 border-t bg-background/70 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="mx-auto max-w-4xl px-4">
            <div className="flex items-center justify-end gap-2 py-3">
              <Button
                variant="outline"
                onClick={() => {
                  setName(initialName)
                  setLogoUrl(initialLogoUrl)
                  setConfirmInput("")
                }}
              >
                Discard
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
