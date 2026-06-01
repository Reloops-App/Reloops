"use client"

import * as React from "react"
// load organizations where current user is owner/admin instead of using workspace param
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import {
  Check,
  Copy,
  Edit,
  EyeOff,
  ExternalLink,
  Eye,
  Mail,
  Plus,
  Repeat,
  Trash,
  UploadCloud,
  Users,
  KeyRound,
} from "lucide-react"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { invokeEdgeFunction } from "@/api/edge"
import { toast } from "sonner"
import { getAvatarInitials, AVATAR_FALLBACK_CLASS } from "@/lib/avatar-utils"
import { supabase } from "@/lib/supabaseClient"
import { cn } from "@/lib/utils"
import { useParams } from "react-router-dom"
import { InviteOrgMemberDialog } from "@/components/team/InviteOrgMemberDialog"
import openClawColorIcon from "@/assets/openclaw-color.png"
import n8nLogoWhite from "@/assets/n8n-logo-white.svg"


type OrgMember = {
  user_id: string
  role: "owner" | "admin" | "member" | "billing"
  profile?: { id: string; display_name?: string | null; avatar_url?: string | null }
}

type Reviewer = {
  user_id: string
  role: string
  email?: string | null
  profile?: { id: string; display_name?: string | null; avatar_url?: string | null }
  project?: { id: string; name?: string | null }
}

type Invitation = {
  id: string
  organization_id?: string | null
  project_id?: string | null
  email: string
  status: "pending" | "accepted" | "denied" | string
  created_at?: string | null
  created_by?: string | null
}

type OrgOption = {
  id: string
  name: string
}

type ApiAgentKey = {
  id: string
  name: string
  provider?: string | null
  icon_url?: string | null
  prefix: string
  created_at?: string | null
  last_used_at?: string | null
  raw_key?: string | null
}

type AgentProviderPreset = {
  id: string
  label: string
  subtitle: string
  iconUrl?: string
  avatarClassName?: string
  toneClassName: string
}

type WorkspaceResolveResponse = {
  data?: {
    organization?: OrgOption | null
  } | null
}

type AdminOrgsResponse = {
  data?: OrgOption[] | null
}

type ApiKeysListResponse = {
  data?: ApiAgentKey[] | null
}

type ApiKeyCreateResponse = {
  data?: ApiAgentKey | null
}

const AGENT_PROVIDER_PRESETS: AgentProviderPreset[] = [
  {
    id: "custom",
    label: "Custom",
    subtitle: "Bring your own integration",
    iconUrl: openClawColorIcon,
    avatarClassName: "bg-white",
    toneClassName: "border-zinc-900/20 bg-zinc-950 text-white",
  },
  {
    id: "api-client",
    label: "API Client",
    subtitle: "General API access",
    avatarClassName: "bg-muted/40",
    toneClassName: "border-slate-500/30 bg-slate-500/10 text-slate-700",
  },
  {
    id: "review-tool",
    label: "Review Tool",
    subtitle: "Review and approval workflow",
    toneClassName: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
  },
  {
    id: "import-tool",
    label: "Import Tool",
    subtitle: "Asset import workflow",
    toneClassName: "border-orange-500/30 bg-orange-500/10 text-orange-700",
  },
  {
    id: "webhook",
    label: "Webhook",
    subtitle: "Event integration",
    toneClassName: "border-sky-500/30 bg-sky-500/10 text-sky-700",
  },
  {
    id: "search",
    label: "Search",
    subtitle: "Asset search integration",
    toneClassName: "border-cyan-500/30 bg-cyan-500/10 text-cyan-700",
  },
  {
    id: "zapier",
    label: "Zapier",
    subtitle: "Automation",
    iconUrl: "https://cdn.simpleicons.org/zapier/ff5a1f",
    toneClassName: "border-amber-500/30 bg-amber-500/10 text-amber-700",
  },
  {
    id: "n8n",
    label: "n8n",
    subtitle: "Workflow automation",
    iconUrl: n8nLogoWhite,
    avatarClassName: "bg-[#101828]",
    toneClassName: "border-rose-500/30 bg-rose-500/10 text-rose-700",
  },
  {
    id: "media-api",
    label: "Media API",
    subtitle: "External media service",
    toneClassName: "border-violet-500/30 bg-violet-500/10 text-violet-700",
  },
  {
    id: "video-tool",
    label: "Video Tool",
    subtitle: "External video service",
    toneClassName: "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-700",
  },
]

function getProviderPreset(provider?: string | null) {
  return AGENT_PROVIDER_PRESETS.find((preset) => preset.id === provider) ?? null
}

function AgentAvatar({
  name,
  provider,
  iconUrl,
  className,
}: {
  name: string
  provider?: string | null
  iconUrl?: string | null
  className?: string
}) {
  const preset = getProviderPreset(provider)
  const resolvedIcon = iconUrl || preset?.iconUrl || null

  return (
    <Avatar className={cn("border border-border/60", preset?.avatarClassName, className)}>
      {resolvedIcon ? <AvatarImage src={resolvedIcon} alt={name} /> : null}
      <AvatarFallback className={cn("text-xs font-semibold", preset?.toneClassName ?? AVATAR_FALLBACK_CLASS)}>
        {provider === "custom" && !resolvedIcon ? <KeyRound className="h-4 w-4" /> : getAvatarInitials(name || preset?.label || "API")}
      </AvatarFallback>
    </Avatar>
  )
}

function formatAgentDate(value?: string | null) {
  if (!value) return "Never"
  return new Date(value).toLocaleDateString()
}

const AGENT_SECRET_CACHE_KEY = "reloops-agent-secret-cache-v1"

function readAgentSecretCache(): Record<string, string> {
  if (typeof window === "undefined") return {}

  try {
    const raw = window.localStorage.getItem(AGENT_SECRET_CACHE_KEY)
    if (!raw) return {}

    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" ? parsed as Record<string, string> : {}
  } catch {
    return {}
  }
}

function writeAgentSecretCache(cache: Record<string, string>) {
  if (typeof window === "undefined") return

  try {
    window.localStorage.setItem(AGENT_SECRET_CACHE_KEY, JSON.stringify(cache))
  } catch {
    // Ignore localStorage quota and privacy mode failures.
  }
}

function makeAgentSecretCacheId(organizationId: string, apiKeyId: string) {
  return `${organizationId}:${apiKeyId}`
}

export default function Teams() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const iconInputRef = React.useRef<HTMLInputElement | null>(null)
  const [organizationId, setOrganizationId] = React.useState<string | null>(null)
  const [orgs, setOrgs] = React.useState<OrgOption[]>([])
  const [members, setMembers] = React.useState<OrgMember[]>([])
  const [reviewers, setReviewers] = React.useState<Reviewer[]>([])
  const [invitations, setInvitations] = React.useState<Invitation[]>([])
  const [apiKeys, setApiKeys] = React.useState<ApiAgentKey[]>([])
  const [canManageApiKeys, setCanManageApiKeys] = React.useState(true)
  const [loading, setLoading] = React.useState(false)
  const [inviteOpen, setInviteOpen] = React.useState(false)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [pendingRemoveUser, setPendingRemoveUser] = React.useState<string | null>(null)
  const [isComposerOpen, setIsComposerOpen] = React.useState(false)
  const [creatingAgent, setCreatingAgent] = React.useState(false)
  const [uploadingAgentIcon, setUploadingAgentIcon] = React.useState(false)
  const [createdAgent, setCreatedAgent] = React.useState<ApiAgentKey | null>(null)
  const [agentName, setAgentName] = React.useState("")
  const [selectedProvider, setSelectedProvider] = React.useState<string>("open-claw")
  const [customIconUrl, setCustomIconUrl] = React.useState<string | null>(null)
  const [refreshNonce, setRefreshNonce] = React.useState(0)
  const [secretCache, setSecretCache] = React.useState<Record<string, string>>({})
  const [revealedSecrets, setRevealedSecrets] = React.useState<Record<string, boolean>>({})

  const [updatingRoles, setUpdatingRoles] = React.useState<Record<string, boolean>>({})
  const [removingMemberId, setRemovingMemberId] = React.useState<string | null>(null)
  const [editingRoles, setEditingRoles] = React.useState<Record<string, boolean>>({})
  const [roleEdits, setRoleEdits] = React.useState<Record<string, OrgMember["role"]>>({})



  const isMockOrg = (id: string | null) => !!id && id.startsWith("mock-org-")
  const isMockUser = (id: string) => id.startsWith("mock-user-")

  const getCachedSecretForKey = React.useCallback((apiKeyId: string) => {
    if (!organizationId) return null
    return secretCache[makeAgentSecretCacheId(organizationId, apiKeyId)] ?? null
  }, [organizationId, secretCache])

  const storeSecretForKey = React.useCallback((apiKeyId: string, rawKey: string) => {
    if (!organizationId || !rawKey) return

    const cacheId = makeAgentSecretCacheId(organizationId, apiKeyId)
    const fullCache = { ...readAgentSecretCache(), [cacheId]: rawKey }
    writeAgentSecretCache(fullCache)
    setSecretCache((prev) => ({ ...prev, [cacheId]: rawKey }))
    setRevealedSecrets((prev) => ({ ...prev, [apiKeyId]: true }))
  }, [organizationId])

  const removeSecretForKey = React.useCallback((apiKeyId: string) => {
    if (!organizationId) return

    const cacheId = makeAgentSecretCacheId(organizationId, apiKeyId)
    const fullCache = { ...readAgentSecretCache() }
    delete fullCache[cacheId]
    writeAgentSecretCache(fullCache)
    setSecretCache((prev) => {
      if (!(cacheId in prev)) return prev
      const next = { ...prev }
      delete next[cacheId]
      return next
    })
    setRevealedSecrets((prev) => {
      if (!(apiKeyId in prev)) return prev
      const next = { ...prev }
      delete next[apiKeyId]
      return next
    })
  }, [organizationId])

  const resetAgentComposer = React.useCallback(() => {
    setAgentName("")
    setSelectedProvider("open-claw")
    setCustomIconUrl(null)
    setUploadingAgentIcon(false)
  }, [])

  React.useEffect(() => {
    if (!organizationId) return

    const fullCache = readAgentSecretCache()
    const scopedCache = Object.fromEntries(
      Object.entries(fullCache).filter(([cacheId]) => cacheId.startsWith(`${organizationId}:`))
    )

    setSecretCache(scopedCache)
    setRevealedSecrets({})
  }, [organizationId])

  // Load organizations where the current user is owner/admin, then load members for selected org


  React.useEffect(() => {
    const loadOrgs = async () => {
      setLoading(true)
      try {
        // If we are in a workspace context, load that workspace's organization
        if (workspaceId) {
          const { data, error } = await invokeEdgeFunction<WorkspaceResolveResponse>("workspace", {
            body: { action: "resolve", workspace_id: workspaceId },
          })
          if (error) throw error
          const payload = data?.data ?? null
          const org = payload?.organization ?? null
          if (org?.id) {
            setOrgs([{ id: org.id, name: org.name }])
            setOrganizationId(org.id)
            setLoading(false)
            return
          }
        }


        // Fallback: fetch organizations where current user is owner/admin
        const { data, error } = await invokeEdgeFunction<AdminOrgsResponse>("workspace", {
          body: { action: "admin-orgs" },
        })
        if (error) throw error

        const orgList = Array.isArray(data?.data) ? data.data : []
        setOrgs(orgList)
        if (orgList.length > 0) {
          setOrganizationId((current) => current ?? orgList[0].id)
        }
      } catch (e) {
        console.error(e)
      } finally {
        setLoading(false)
      }
    }
    loadOrgs()
  }, [workspaceId])

  // Consolidate data loading when organizationId changes
  React.useEffect(() => {
    if (!organizationId) return

    const fetchAllData = async () => {
      setLoading(true)
      try {
        await Promise.all([
          // 1. Members
          invokeEdgeFunction("org-members", {
            body: { action: "list", organization_id: organizationId },
          }).then(({ data, error }) => {
            if (error) throw error
            const rows = Array.isArray(data) ? data : Array.isArray((data as any)?.data) ? (data as any).data : []
            setMembers(rows)
          }),

          // 2. Reviewers
          invokeEdgeFunction("org-members", {
            body: { action: "list-project-reviewers", organization_id: organizationId },
          }).then(({ data, error }) => {
            if (error) throw error
            const rows = Array.isArray(data) ? data : Array.isArray((data as any)?.data) ? (data as any).data : []
            setReviewers(rows)
          }),

          // 3. Invitations
          invokeEdgeFunction("invite", {
            body: { action: "list", organizationId },
          }).then(({ data, error }) => {
            // Handle edge case where invite function might return error in body or strict http error
            if (error) throw error
            setInvitations(Array.isArray(data) ? (data as Invitation[]) : [])
          }),

          invokeEdgeFunction<ApiKeysListResponse>("api-keys", {
            body: { action: "list", organization_id: organizationId },
          }).then(({ data, error }) => {
            if (error) {
              if (error.status === 403) {
                setCanManageApiKeys(false)
                setApiKeys([])
                return
              }
              throw error
            }

            const payload = Array.isArray(data?.data) ? data.data : []
            setCanManageApiKeys(true)
            setApiKeys(payload)
          }),
        ])

      } catch (e) {
        console.error("Failed to load team data", e)
        toast.error("Failed to load some team data")
      } finally {
        setLoading(false)
      }
    }

    fetchAllData()
  }, [organizationId, refreshNonce])

  const resendInvitation = async (email: string) => {
    if (!organizationId) return
    try {
      // call the existing invite function to re-create/send an invite
      const { error } = await invokeEdgeFunction('invite', {
        body: { action: 'org', organizationId, emails: [email], role: "member" }, // role could be adjusted or stored in invitation
      })
      if (error) throw error
      toast.success("Invite resent")
      setTimeout(() => setRefreshNonce((value) => value + 1), 600)
    } catch (e) {
      console.error("Resend invite failed", e)
      toast.error("Failed to resend invite")
    }
  }

  const cancelInvitation = async (invId: string) => {
    if (!organizationId) return
    try {
      // optimistic UI
      setInvitations((prev) => prev.map((inv) => inv.id === invId ? { ...inv, status: 'denied' } : inv))
      const { error } = await invokeEdgeFunction("invite", {
        body: { action: "revoke", organizationId, invitationId: invId },
      })
      if (error) throw error
      toast.success("Invitation canceled")
      setTimeout(() => setRefreshNonce((value) => value + 1), 200)
    } catch (e) {
      console.error("Failed to cancel invitation", e)
      toast.error("Failed to cancel invitation (check permissions)")
      setRefreshNonce((value) => value + 1)
    }
  }



  const updateRole = async (userId: string, role: OrgMember["role"]) => {
    if (!organizationId) return
    setUpdatingRoles((s) => ({ ...s, [userId]: true }))
    try {
      if (isMockUser(userId) || isMockOrg(organizationId)) {
        // demo-only: pretend it worked
        setMembers((prev) => prev.map((m) => (m.user_id === userId ? { ...m, role } : m)))
        toast.success("(demo) Role updated")
      } else {
        const { error } = await invokeEdgeFunction("org-members", {
          body: { action: "update-role", organization_id: organizationId, user_id: userId, role },
        })
        if (error) throw error
        // optimistic reload

        setMembers((prev) => prev.map((m) => (m.user_id === userId ? { ...m, role } : m)))
        toast.success("Role updated")
      }
    } catch (e) {
      console.error(e)
      toast.error("Failed to update role")
    } finally {
      setUpdatingRoles((s) => ({ ...s, [userId]: false }))
    }
  }

  // open confirmation modal first
  const removeMember = (userId: string) => {
    setPendingRemoveUser(userId)
    setConfirmOpen(true)
  }

  const confirmRemove = async () => {
    const userId = pendingRemoveUser
    if (!userId || !organizationId) return
    setRemovingMemberId(userId)
    try {
      if (isMockUser(userId) || isMockOrg(organizationId)) {
        setMembers((prev) => prev.filter((m) => m.user_id !== userId))
        toast.success("(demo) Member removed")
      } else {
        const { error } = await invokeEdgeFunction("org-members", {
          body: { action: "remove-member", organization_id: organizationId, user_id: userId },
        })
        if (error) throw error
        setMembers((prev) => prev.filter((m) => m.user_id !== userId))
        toast.success("Member removed")
      }
    } catch (e) {
      console.error(e)
      toast.error("Failed to remove member")
    } finally {
      setRemovingMemberId(null)
      setConfirmOpen(false)
      setPendingRemoveUser(null)
    }
  }



  const openProject = (projectId?: string | null) => {
    if (!projectId) {
      toast.error('No project link available')
      return
    }
    // open project in new tab — update route as needed
    window.open(`/projects/${projectId}`, '_blank')
  }

  function removeUserFromProject(userId: string, projectId: string | undefined): void {
    console.info("removeUserFromProject not implemented yet", { userId, projectId })
    toast.info("Project reviewer removal is not implemented yet")
  }

  const handleAgentIconUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !organizationId) return

    setUploadingAgentIcon(true)
    try {
      const fileExt = file.name.split(".").pop()
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-")
      const filePath = `developer-keys/${organizationId}/${Date.now()}-${safeName}${fileExt ? "" : ".png"}`

      const { error: uploadErr } = await supabase.storage
        .from("avatars")
        .upload(filePath, file, { upsert: true })

      if (uploadErr) throw uploadErr

      const { data } = supabase.storage.from("avatars").getPublicUrl(filePath)
      setCustomIconUrl(data?.publicUrl ?? null)
      toast.success("Custom icon uploaded")
    } catch (e) {
      console.error("Developer key icon upload failed", e)
      toast.error("Failed to upload custom icon")
    } finally {
      setUploadingAgentIcon(false)
      if (e.currentTarget) e.currentTarget.value = ""
    }
  }

  const handleCreateAgent = async () => {
    if (!organizationId || !agentName.trim()) return

    setCreatingAgent(true)
    try {
      const { data, error } = await invokeEdgeFunction<ApiKeyCreateResponse>("api-keys", {
        body: {
          action: "create",
          organization_id: organizationId,
          name: agentName.trim(),
          provider: selectedProvider || null,
          icon_url: customIconUrl,
        },
      })

      if (error) throw error

      const newAgent = data?.data ?? undefined
      if (!newAgent) throw new Error("Missing API key payload")

      if (newAgent.raw_key) {
        storeSecretForKey(newAgent.id, newAgent.raw_key)
      }
      setCreatedAgent(newAgent)
      setApiKeys((prev) => [newAgent, ...prev])
      setCanManageApiKeys(true)
      setIsComposerOpen(false)
      resetAgentComposer()
      toast.success("Developer key created")
    } catch (e) {
      console.error("Developer key creation failed", e)
      toast.error(e instanceof Error ? e.message : "Could not create developer key")
    } finally {
      setCreatingAgent(false)
    }
  }

  const handleDeleteAgent = async (id: string) => {
    try {
      const { error } = await invokeEdgeFunction("api-keys", {
        body: { action: "delete", id },
      })

      if (error) throw error

      setApiKeys((prev) => prev.filter((key) => key.id !== id))
      removeSecretForKey(id)
      toast.success("Developer key revoked")
    } catch (e) {
      console.error("Developer key revoke failed", e)
      toast.error("Could not revoke developer key")
    }
  }

  const copyToClipboard = async (text: string) => {
    if (!text) {
      toast.error("No key available to copy")
      return
    }

    try {
      await navigator.clipboard.writeText(text)
      toast.success("Copied to clipboard")
    } catch (e) {
      console.error("Copy failed", e)
      toast.error("Failed to copy")
    }
  }

  // InviteInput removed — simplified invite dialog uses single email + role

  const agentCount = apiKeys.length
  const reusableSecretCount = apiKeys.filter((key) => Boolean(getCachedSecretForKey(key.id))).length
  const showComposer = isComposerOpen || agentCount === 0

  return (
    <div className="min-h-screen w-full bg-background/50 p-4 sm:p-8">
      <div className="mx-auto max-w-7xl space-y-8">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Team Management</h1>
            <p className="text-base text-muted-foreground">
              Manage members, roles, and pending invitations for your organization.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-[240px]">
              <Select value={organizationId ?? ""} onValueChange={(v) => setOrganizationId(v)}>
                <SelectTrigger className="h-10 shadow-sm">
                  <SelectValue placeholder={orgs.length > 0 ? orgs[0].name : "Select Organization"} />
                </SelectTrigger>
                <SelectContent>
                  {orgs.map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => setInviteOpen(true)} disabled={!organizationId || loading} className="h-10 px-4 shadow-sm transition-all hover:shadow-md">
              <Plus className="mr-2 h-4 w-4" />
              Invite Member
            </Button>
          </div>
        </div>

        <Separator className="bg-border/60" />

        <Card className="border-border/50 bg-card/50 shadow-sm">
          <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <KeyRound className="h-5 w-5 text-primary" />
                  Developer Keys
                </CardTitle>
                <Badge variant="outline">Team level</Badge>
              </div>
              <CardDescription className="max-w-2xl">
                Create and manage reusable API keys for local integrations. Generated keys can be revealed and copied again on this browser if they were created locally in this session history.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {reusableSecretCount > 0 ? (
                <Badge variant="secondary">{reusableSecretCount} reusable {reusableSecretCount === 1 ? "key" : "keys"}</Badge>
              ) : null}
              <Button
                onClick={() => {
                  setIsComposerOpen((current) => !current)
                  if (!isComposerOpen) setCreatedAgent(null)
                }}
                disabled={!organizationId || !canManageApiKeys}
                variant={showComposer ? "outline" : "default"}
              >
                <Plus className="mr-2 h-4 w-4" />
                {showComposer ? "Close" : "Add Developer Key"}
              </Button>
            </div>
          </CardHeader>

          <CardContent className="space-y-5">
            {!canManageApiKeys ? (
              <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
                Only organization owners and admins can view or manage developer keys.
              </div>
            ) : null}

            {createdAgent ? (
              <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <AgentAvatar
                      name={createdAgent.name}
                      provider={createdAgent.provider}
                      iconUrl={createdAgent.icon_url}
                      className="h-10 w-10"
                    />
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {createdAgent.name} is ready
                      </p>
                      <p className="text-sm text-muted-foreground">
                        The raw key is cached on this browser, so you can copy it again from the key row below.
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" onClick={() => copyToClipboard(getCachedSecretForKey(createdAgent.id) ?? createdAgent.raw_key ?? "")}>
                      <Copy className="mr-2 h-4 w-4" />
                      Copy key
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setCreatedAgent(null)}>
                      Dismiss
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}

            {showComposer && canManageApiKeys ? (
              <div className="rounded-lg border border-border/60 bg-background p-4">
                <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
                  <div className="space-y-5">
                    <div className="grid gap-2">
                      <Label htmlFor="agent-name">Key name</Label>
                      <Input
                        id="agent-name"
                        placeholder="Review automation"
                        value={agentName}
                        onChange={(e) => setAgentName(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Use a clear label so your team can recognize what this key is for.
                      </p>
                    </div>

                    <div className="grid gap-2">
                      <Label>Provider</Label>
                      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        {AGENT_PROVIDER_PRESETS.map((preset) => {
                          const isActive = selectedProvider === preset.id
                          return (
                            <button
                              key={preset.id}
                              type="button"
                              onClick={() => setSelectedProvider(preset.id)}
                              className={cn(
                                "flex items-center gap-3 rounded-lg border px-3 py-3 text-left transition-colors",
                                isActive
                                  ? "border-foreground/20 bg-muted"
                                  : "border-border/60 hover:bg-muted/40"
                              )}
                            >
                              <AgentAvatar name={preset.label} provider={preset.id} className="h-8 w-8" />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium text-foreground">{preset.label}</p>
                                <p className="truncate text-xs text-muted-foreground">{preset.subtitle}</p>
                              </div>
                              {isActive ? <Check className="h-4 w-4 text-muted-foreground" /> : null}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4 rounded-lg border border-border/60 bg-muted/20 p-4">
                    <div className="space-y-2">
                      <Label>Preview</Label>
                      <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-background px-3 py-3">
                        <AgentAvatar
                          name={agentName || "Developer Key"}
                          provider={selectedProvider || null}
                          iconUrl={customIconUrl}
                          className="h-10 w-10"
                        />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">{agentName || "Developer Key"}</p>
                          <p className="text-xs text-muted-foreground">
                            {getProviderPreset(selectedProvider)?.label ?? "Custom provider"}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label>Custom icon</Label>
                        {customIconUrl ? (
                          <Button variant="ghost" size="sm" onClick={() => setCustomIconUrl(null)}>
                            Remove
                          </Button>
                        ) : null}
                      </div>
                      <input
                        ref={iconInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleAgentIconUpload}
                        className="hidden"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full justify-start"
                        onClick={() => iconInputRef.current?.click()}
                        disabled={uploadingAgentIcon}
                      >
                        <UploadCloud className="mr-2 h-4 w-4" />
                        {uploadingAgentIcon ? "Uploading..." : "Upload custom icon"}
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        Optional. If you skip this, the provider icon is used.
                      </p>
                    </div>

                    <div className="flex gap-2 pt-2">
                      {agentCount > 0 ? (
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setIsComposerOpen(false)
                            resetAgentComposer()
                          }}
                        >
                          Cancel
                        </Button>
                      ) : null}
                      <Button onClick={handleCreateAgent} disabled={!agentName.trim() || creatingAgent} className="ml-auto">
                        {creatingAgent ? "Generating..." : "Get Developer Key"}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">Developer key registry</p>
                  <p className="text-sm text-muted-foreground">
                    {agentCount === 0
                      ? "No developer keys created yet."
                      : "Reveal, copy, or revoke keys directly from the list."}
                  </p>
                </div>
                {agentCount > 0 ? (
                  <Badge variant="outline">{agentCount} {agentCount === 1 ? "key" : "keys"}</Badge>
                ) : null}
              </div>

              {loading && apiKeys.length === 0 ? (
                <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
                  Loading developer keys...
                </div>
              ) : apiKeys.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/60 bg-muted/10 px-4 py-8 text-center">
                  <KeyRound className="mx-auto h-5 w-5 text-muted-foreground" />
                  <p className="mt-3 text-sm font-medium text-foreground">No developer keys yet</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Create a reusable key for local scripts, webhooks, and integrations.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {apiKeys.map((key) => {
                    const cachedSecret = getCachedSecretForKey(key.id)
                    const isRevealed = Boolean(revealedSecrets[key.id])

                    return (
                      <div key={key.id} className="rounded-lg border border-border/60 bg-background px-4 py-4">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0 space-y-3">
                            <div className="flex items-start gap-3">
                              <AgentAvatar
                                name={key.name}
                                provider={key.provider}
                                iconUrl={key.icon_url}
                                className="h-10 w-10"
                              />
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="truncate text-sm font-medium text-foreground">{key.name}</p>
                                  {key.provider ? (
                                    <Badge variant="outline">
                                      {getProviderPreset(key.provider)?.label ?? key.provider}
                                    </Badge>
                                  ) : null}
                                  {key.icon_url ? <Badge variant="secondary">Custom icon</Badge> : null}
                                  {cachedSecret ? <Badge variant="secondary">Local copy available</Badge> : null}
                                </div>
                                <p className="mt-1 font-mono text-xs text-muted-foreground">{key.prefix}</p>
                                <p className="mt-2 text-xs text-muted-foreground">
                                  Created {formatAgentDate(key.created_at)} • {key.last_used_at ? `Last used ${formatAgentDate(key.last_used_at)}` : "Not used yet"}
                                </p>
                              </div>
                            </div>

                            {cachedSecret ? (
                              <div className="space-y-2">
                                {isRevealed ? (
                                  <Input readOnly value={cachedSecret} className="font-mono text-xs sm:text-sm" />
                                ) : null}
                                {!isRevealed ? (
                                  <p className="text-xs text-muted-foreground">
                                    Raw key is stored on this browser. Use reveal or copy again when needed.
                                  </p>
                                ) : null}
                              </div>
                            ) : (
                              <p className="text-xs text-muted-foreground">
                                Raw key is not available on this browser anymore. Create a new one if you need a fresh secret.
                              </p>
                            )}
                          </div>

                          <div className="flex flex-wrap gap-2 lg:justify-end">
                            {cachedSecret ? (
                              <>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setRevealedSecrets((prev) => ({ ...prev, [key.id]: !prev[key.id] }))}
                                >
                                  {isRevealed ? <EyeOff className="mr-2 h-4 w-4" /> : <Eye className="mr-2 h-4 w-4" />}
                                  {isRevealed ? "Hide" : "Reveal"}
                                </Button>
                                <Button variant="secondary" size="sm" onClick={() => copyToClipboard(cachedSecret)}>
                                  <Copy className="mr-2 h-4 w-4" />
                                  Copy
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => removeSecretForKey(key.id)}>
                                  Forget local copy
                                </Button>
                              </>
                            ) : null}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => handleDeleteAgent(key.id)}
                            >
                              Revoke
                            </Button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Members Section */}
        <Card className="border-border/50 bg-card/50 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Users className="h-5 w-5 text-primary" />
              Organization Members
            </CardTitle>
            <CardDescription>
              People with access to all workspaces in this organization.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading && members.length === 0 ? (
              <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                Loading members...
              </div>
            ) : members.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="rounded-full bg-muted p-3">
                  <Users className="h-6 w-6 text-muted-foreground" />
                </div>
                <h3 className="mt-4 text-lg font-medium">No members yet</h3>
                <p className="mt-2 text-sm text-muted-foreground max-w-sm">
                  Invite your team to start collaborating.
                </p>
              </div>
            ) : (
              <div className="rounded-md border border-border/50">
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow>
                      <TableHead className="pl-4">Member</TableHead>
                      <TableHead className="w-[180px]">Role</TableHead>
                      <TableHead className="w-[140px] text-right pr-4">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {members.map((m) => (
                      <TableRow key={m.user_id} className="hover:bg-muted/20">
                        <TableCell className="pl-4">
                          <div className="flex items-center gap-3">
                            <Avatar className="h-9 w-9 border border-border/50">
                              {m.profile?.avatar_url ? (
                                <AvatarImage src={m.profile.avatar_url} />
                              ) : (
                                <AvatarFallback className={AVATAR_FALLBACK_CLASS}>{getAvatarInitials(m.profile?.display_name)}</AvatarFallback>
                              )}
                            </Avatar>
                            <div className="flex flex-col">
                              <span className="text-sm font-medium text-foreground">{m.profile?.display_name ?? "Unknown User"}</span>
                              {/* <span className="text-xs text-muted-foreground">user@example.com</span> */}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {editingRoles[m.user_id] ? (
                            <Select
                              onValueChange={(val) => setRoleEdits((s) => ({ ...s, [m.user_id]: val as OrgMember["role"] }))}
                              value={roleEdits[m.user_id] ?? m.role}
                            >
                              <SelectTrigger className="h-8 w-[140px]">
                                <SelectValue placeholder="Role" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="owner">Owner</SelectItem>
                                <SelectItem value="admin">Admin</SelectItem>
                                <SelectItem value="member">Member</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : (
                            <Badge variant="outline" className="capitalize font-normal">
                              {m.role}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right pr-4">
                          <div className="flex justify-end gap-2">
                            {editingRoles[m.user_id] ? (
                              <>
                                <Button
                                  size="sm"
                                  onClick={async () => {
                                    const newRole = roleEdits[m.user_id] ?? m.role
                                    await updateRole(m.user_id, newRole)
                                    setEditingRoles((s) => ({ ...s, [m.user_id]: false }))
                                    setRoleEdits((s) => { const next = { ...s }; delete next[m.user_id]; return next })
                                  }}
                                  disabled={!!updatingRoles[m.user_id]}
                                  className="h-8"
                                >
                                  <Check className="h-3.5 w-3.5 mr-1.5" />Save
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => { setEditingRoles((s) => ({ ...s, [m.user_id]: false })); setRoleEdits((s) => { const next = { ...s }; delete next[m.user_id]; return next }) }}
                                  className="h-8"
                                >
                                  Cancel
                                </Button>
                              </>
                            ) : (
                              <>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                  onClick={() => { setEditingRoles((s) => ({ ...s, [m.user_id]: true })); setRoleEdits((s) => ({ ...s, [m.user_id]: m.role })); }}
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                  onClick={() => removeMember(m.user_id)}
                                  disabled={removingMemberId === m.user_id || !!updatingRoles[m.user_id] || m.role === "owner"}
                                  title={m.role === "owner" ? "Cannot remove organization owner" : undefined}
                                >
                                  {removingMemberId === m.user_id ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Trash className="h-4 w-4" />}
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Invitations section */}
        <div className="grid gap-8 lg:grid-cols-2">
          <Card className="border-border/50 bg-card/50 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Mail className="h-5 w-5 text-primary" />
                Pending Invitations
              </CardTitle>
              <CardDescription>
                Invitations sent but not yet accepted.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading && invitations.length === 0 ? (
                <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
                  Loading...
                </div>
              ) : invitations.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center text-sm text-muted-foreground">
                  <p>No pending invitations.</p>
                </div>
              ) : (
                <div className="rounded-md border border-border/50">
                  <Table>
                    <TableHeader className="bg-muted/30">
                      <TableRow>
                        <TableHead className="pl-4">Email</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right pr-4">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invitations.map((inv) => (
                        <TableRow key={inv.id} className="hover:bg-muted/20">
                          <TableCell className="pl-4 font-medium">{inv.email}</TableCell>
                          <TableCell>
                            <Badge variant={inv.status === 'pending' ? 'secondary' : 'outline'} className="capitalize font-normal text-xs">
                              {inv.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right pr-4">
                            <div className="flex justify-end gap-1">
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => resendInvitation(inv.email)} title="Resend invitation">
                                <Repeat className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => cancelInvitation(inv.id)} disabled={inv.status !== "pending"}>
                                <Trash className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Reviewers (project-scoped reviewers) */}
          <Card className="border-border/50 bg-card/50 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Eye className="h-5 w-5 text-primary" />
                Project Reviewers
              </CardTitle>
              <CardDescription>
                Guests with access to specific projects only.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading && reviewers.length === 0 ? (
                <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
                  Loading...
                </div>
              ) : reviewers.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center text-sm text-muted-foreground">
                  <p>No project-specific reviewers found.</p>
                </div>
              ) : (
                <div className="rounded-md border border-border/50">
                  <Table>
                    <TableHeader className="bg-muted/30">
                      <TableRow>
                        <TableHead className="pl-4">Reviewer</TableHead>
                        <TableHead>Project</TableHead>
                        <TableHead className="text-right pr-4">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reviewers.map((r) => (
                        <TableRow key={`${r.user_id}-${r.project?.id ?? 'none'}`} className="hover:bg-muted/20">
                          <TableCell className="pl-4">
                            <div className="flex items-center gap-2">
                              <Avatar className="h-6 w-6">
                                <AvatarFallback className={`text-[10px] ${AVATAR_FALLBACK_CLASS}`}>{getAvatarInitials(r.profile?.display_name)}</AvatarFallback>
                              </Avatar>
                              <span className="text-sm font-medium truncate max-w-[100px]">{r.profile?.display_name ?? r.email ?? "User"}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <button
                              onClick={() => openProject(r.project?.id)}
                              className="text-sm text-primary hover:underline flex items-center gap-1 max-w-[120px]"
                            >
                              <span className="truncate">{r.project?.name ?? 'Unknown'}</span>
                              <ExternalLink className="h-3 w-3 opacity-50" />
                            </button>
                          </TableCell>
                          <TableCell className="text-right pr-4">
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => removeUserFromProject(r.user_id, r.project?.id)} title="Remove from project">
                              <Trash className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <InviteOrgMemberDialog
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          organizationId={organizationId}
          onInviteSent={(invitation) => setInvitations((prev) => [...prev, invitation])}
        />

        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Remove Member</DialogTitle>
              <DialogDescription>
                Are you sure you want to remove this member? They will lose access to all projects in this organization.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="mt-4">
              <Button variant="outline" onClick={() => { setConfirmOpen(false); setPendingRemoveUser(null); }}>Cancel</Button>
              <Button variant="destructive" onClick={confirmRemove}>Remove Member</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
