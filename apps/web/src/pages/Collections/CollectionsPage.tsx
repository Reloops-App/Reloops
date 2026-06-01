"use client"

import { useEffect, useMemo, useState } from "react"
import { useNavigate, useParams, useLocation } from "react-router-dom"
import { invokeEdgeFunction } from "@/api/edge"
import { refreshSupabaseSessionViaHttp } from "@/lib/supabaseAuthApi"
import { normalizeAssets, mimeKind, groupByRoot } from "@/lib/assetUtils"
import { changeAssetStatus, downloadFile } from "@/lib/utils"
import { isLikelyWebsiteScreenshot } from "@/components/review/website-review-utils"
import CampaignFilters from "../Campaign/components/CampaignFilters"
import AssetCard from "../Campaign/components/AssetCard"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@radix-ui/react-separator"

type SortKey = "createdAt" | "name" | "sizeBytes" | "status"
type SortDir = "asc" | "desc"

export default function CollectionsPage() {
    const { workspaceId, collectionName } = useParams<{ workspaceId: string; collectionName: string }>()
    const navigate = useNavigate()
    const location = useLocation()

    const [assets, setAssets] = useState<any[]>([])
    const [loading, setLoading] = useState(false)
    const [loadError, setLoadError] = useState<string | null>(null)

    // filters / sort state (re-used from campaign filters)
    const [assetSearch, setAssetSearch] = useState("")
    const [statusFilter, setStatusFilter] = useState<"all" | "none" | "needs_review" | "in_review" | "approved">("all")
    const [kindFilter, setKindFilter] = useState<string>("all")
    const [sortKey, setSortKey] = useState<SortKey>("createdAt")
    const [sortDir, setSortDir] = useState<SortDir>("desc")

    // assignments filter
    const [assignFilter, setAssignFilter] = useState<string>("all")
    const [orgMembers] = useState<any[]>([])

    // map route collection -> default filters
    useEffect(() => {
        if (!collectionName) {
            setStatusFilter("all")
            setKindFilter("all")
            return
        }
        const f = collectionName.toLowerCase()
        if (f === "all") {
            setStatusFilter("all")
            setKindFilter("all")
        } else if (f === "needs-review") {
            setStatusFilter("needs_review")
            setKindFilter("all")
        } else if (f === "in-review") {
            setStatusFilter("in_review")
            setKindFilter("all")
        } else if (f === "approved") {
            setStatusFilter("approved")
            setKindFilter("all")
        } else if (f === "video") {
            setKindFilter("Video")
            setStatusFilter("all")
        } else if (f === "image") {
            setKindFilter("Image")
            setStatusFilter("all")
        } else if (f === "pdf" || f === "pdfs") {
            setKindFilter("Pdf")
            setStatusFilter("all")
        } else if (f === "website-review") {
            setKindFilter("all")
            setStatusFilter("all")
        } else {
            setStatusFilter("all")
            setKindFilter("all")
        }
    }, [collectionName, location.key])

    // Fetch workspace assets (MVP: client-side filtering)
    useEffect(() => {
        if (!workspaceId) return
        let isMounted = true
        let didRetry = false

        const loadWithTimeout = async (ms: number) => {
            const controller = new AbortController()
            const t = window.setTimeout(() => controller.abort(), ms)
            try {
                return await invokeEdgeFunction<{ data: any[] }>("asset", {
                    body: { action: "list", workspace_id: workspaceId, limit: 1000 },
                    signal: controller.signal,
                })
            } finally {
                window.clearTimeout(t)
            }
        }
        async function load() {
            setLoading(true)
            setLoadError(null)
            try {
                const { data, error } = await loadWithTimeout(15_000)

                if (error) throw error
                if (!isMounted) return
                const rows = Array.isArray((data as any)?.data) ? (data as any).data : (Array.isArray(data) ? (data as any) : [])
                setAssets(normalizeAssets(rows))
            } catch (err: any) {
                console.error("CollectionsPage: failed to load assets", err)
                if (!isMounted) return

                const message = typeof err?.message === "string" ? err.message : ""
                const isAbort = err?.status === 0 && message.toLowerCase().includes("abort")

                if (isAbort && !didRetry) {
                    didRetry = true
                    try {
                        await refreshSupabaseSessionViaHttp()
                        const retry = await loadWithTimeout(15_000)
                        if (retry.error) throw retry.error
                        const rows = Array.isArray((retry.data as any)?.data) ? (retry.data as any).data : []
                        setAssets(normalizeAssets(rows))
                        return
                    } catch (e) {
                        console.error("CollectionsPage: retry after refresh failed", e)
                    }
                }

                setAssets([])
                setLoadError("Couldn’t load assets. Please refresh the page and try again.")
            } finally {
                if (isMounted) setLoading(false)
            }
        }
        void load()
        return () => {
            isMounted = false
        }
    }, [workspaceId])

    const availableKinds = useMemo(() => {
        const kinds = new Set<string>()
        assets.forEach((a) => kinds.add(capitalize(mimeKind(a.type))))
        const order = ["Image", "Video", "Audio", "Pdf", "Text", "Application", "Other"]
        const present = Array.from(kinds)
        present.sort((a, b) => {
            const ai = order.indexOf(a)
            const bi = order.indexOf(b)
            return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi) || a.localeCompare(b)
        })
        return present
    }, [assets])

    const filteredAssets = useMemo(() => {
        const q = assetSearch.trim().toLowerCase()
        
        // 1. Group all fetched assets into stacks (versions)
        const stacksMap = groupByRoot(assets);
        
        // 2. For each stack, pick the latest version to represent it in the collection
        const latestVersions = Array.from(stacksMap.values()).map((stack: any[]) => {
            // groupByRoot already sorts them descending by version_no / createdAt
            return stack[0]; 
        });

        // 3. Filter the representative assets
        const res = latestVersions.filter((a: any) => {
            const raw = a.__raw ?? {}
            const searchableText = [
                a.name,
                a.type,
                a.description,
                raw.description,
                a.smart_description,
                raw.smart_description,
                a.ai_description,
                raw.ai_description,
                raw.aiDescription,
                raw.generated_description,
                raw.auto_description,
                raw.caption,
                raw.alt_text,
                ...(Array.isArray(a.tags) ? a.tags : []),
                ...(Array.isArray(a.smart_tags) ? a.smart_tags : []),
                ...(Array.isArray(raw.ai_tags) ? raw.ai_tags : []),
            ].filter(Boolean).join(" ").toLowerCase()
            const matchesSearch = !q || searchableText.includes(q)
            const kind = capitalize(mimeKind(a.type))
            const matchesKind = kindFilter === "all" ? true : kind === kindFilter
            const matchesWebsiteReview = collectionName?.toLowerCase() === "website-review"
                ? isLikelyWebsiteScreenshot({
                    title: a.name ?? raw.title ?? null,
                    storage_path: raw.storage_path ?? raw.path ?? raw.url ?? a.url ?? null,
                    mime_type: a.type ?? raw.mime_type ?? null,
                    width: typeof raw.width === "number" ? raw.width : null,
                    height: typeof raw.height === "number" ? raw.height : null,
                })
                : true
            const stat = a.status ?? null
            const col = stat === "needs_review" || stat === "in_review" || stat === "approved" ? stat : "none"
            const matchesStatus = statusFilter === "all" ? true : (statusFilter === "none" ? col === "none" : col === statusFilter)
            return matchesSearch && matchesKind && matchesWebsiteReview && matchesStatus
        })

        // 4. Sort the filtered representatives
        res.sort((a, b) => {
            const dir = sortDir === "asc" ? 1 : -1
            if (sortKey === "name") return dir * ((a.name || "").localeCompare(b.name || ""))
            if (sortKey === "createdAt") {
                const at = a.createdAt ? new Date(a.createdAt).getTime() : 0
                const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0
                return dir * (at - bt)
            }
            if (sortKey === "sizeBytes") {
                const asz = a.sizeBytes ?? -1
                const bsz = b.sizeBytes ?? -1
                return dir * (asz - bsz)
            }
            const orderMap: Record<string, number> = { none: 0, needs_review: 1, in_review: 2, approved: 3 }
            const ac = orderMap[a.status ?? "none"] ?? 0
            const bc = orderMap[b.status ?? "none"] ?? 0
            return dir * (ac - bc)
        })

        return res
    }, [assets, assetSearch, kindFilter, statusFilter, sortKey, sortDir])

    const handleDownload = (asset: any) => {
        const rawUrl = asset.url || asset.storage_path;
        if (!rawUrl) return;

        let downloadUrl = "";
        if (rawUrl.startsWith("http")) {
            downloadUrl = rawUrl;
        } else {
            const proxy = import.meta.env.VITE_ASSET_PUBLIC_BASE_URL || "";
            const base = proxy.endsWith("/") ? proxy.slice(0, -1) : proxy;
            const path = rawUrl.startsWith("/") ? rawUrl : `/${rawUrl}`;
            downloadUrl = `${base}${path}`;
        }

        void downloadFile(downloadUrl, asset.name || asset.title || "asset");
    };

    function capitalize(s: string) {
        if (!s) return ""
        const low = String(s).toLowerCase()
        if (low === "pdf") return "Pdf"
        return low.charAt(0).toUpperCase() + low.slice(1)
    }

    async function handleStatusChange(assetId: string, newStatus: 'approved' | 'in_review' | 'needs_review' | null) {
        const prev = assets
        setAssets((curr) => curr.map((a) => (a.id === assetId ? { ...a, status: newStatus } : a)))
        try {
            if (newStatus === null) {
                await changeAssetStatus(assetId, "archived" as any)
            } else {
                await changeAssetStatus(assetId, newStatus as any)
            }
        } catch (err) {
            console.error("Failed to change status:", err)
            setAssets(prev)
        }
    }

    function handleAssetClick(asset: any) {
        const projectId = asset.__raw?.project_id ?? asset.__raw?.projectId ?? null
        if (projectId) {
            navigate(`/workspace/${workspaceId}/projects/${projectId}/assets/${asset.id}`)
        } else {
            // Fallback for workspace-level assets
            navigate(`/workspace/${workspaceId}/assets/${asset.id}`)
        }
    }

    function clearFilters() {
        setAssetSearch("")
        setStatusFilter("all")
        setKindFilter("all")
        setSortKey("createdAt")
        setSortDir("desc")
        setAssignFilter("all")
    }

    return (
        <div>
            <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
                <div className="flex items-center gap-2 px-4">
                    <SidebarTrigger className="-ml-1" />
                    <Separator
                        orientation="vertical"
                        className="mr-2 data-[orientation=vertical]:h-4"
                    />
                    <Breadcrumb>
                        <BreadcrumbList>
                            <BreadcrumbItem>
                                <BreadcrumbLink>
                                    Collections
                                </BreadcrumbLink>
                            </BreadcrumbItem>
                            <BreadcrumbSeparator className="hidden md:block" />
                            <BreadcrumbItem>
                                <BreadcrumbPage>
                                    {(() => {
                                        if (!collectionName) return "All"
                                        const raw = collectionName.replace(/-/g, " ")
                                        const lower = raw.toLowerCase()
                                        if (lower === "image" || lower === "images") return "Images"
                                        if (lower === "video" || lower === "videos") return "Videos"
                                        if (lower === "pdf" || lower === "pdfs") return "PDFs"
                                        if (lower === "website review") return "Website review"
                                        const cap = raw.charAt(0).toUpperCase() + raw.slice(1)
                                        return cap
                                    })()}
                                </BreadcrumbPage>
                            </BreadcrumbItem>
                        </BreadcrumbList>
                    </Breadcrumb>
                </div>
            </header>
            <div className="p-6 space-y-4">
                <div className="flex items-center justify-between">
                    <h1 className="text-2xl font-semibold">{(() => {
                        if (!collectionName) return "All"
                        const raw = collectionName.replace(/-/g, " ")
                        const lower = raw.toLowerCase()
                        if (lower === "image" || lower === "images") return "Images"
                        if (lower === "video" || lower === "videos") return "Videos"
                        if (lower === "pdf" || lower === "pdfs") return "PDFs"
                        if (lower === "website review") return "Website review"
                        const cap = raw.charAt(0).toUpperCase() + raw.slice(1)
                        return cap
                    })()}</h1>
                    
                </div>

                <CampaignFilters
                    assetSearch={assetSearch}
                    setAssetSearch={setAssetSearch}
                    statusFilter={statusFilter as any}
                    setStatusFilter={(v: any) => setStatusFilter(v as any)}
                    assignFilter={assignFilter}
                    setAssignFilter={setAssignFilter}
                    kindFilter={kindFilter}
                    setKindFilter={setKindFilter}
                    sortKey={sortKey as any}
                    setSortKey={(k: any) => setSortKey(k as SortKey)}
                    sortDir={sortDir}
                    setSortDir={(d: any) => setSortDir(d as SortDir)}
                    clearFilters={clearFilters}
                    availableKinds={availableKinds}
                    orgMembers={orgMembers}
                    filteredCount={filteredAssets.length}
                    workspaceId={workspaceId ?? ""}
                    projectId={"all"}
                    onUpload={() => { }}
                    onInvite={() => { }}
                    defaultSortKey="createdAt"
                />

                {loading ? (
                    <div className="text-sm text-muted-foreground">Loading assets...</div>
                ) : loadError ? (
                    <div className="text-sm text-red-600">{loadError}</div>
                ) : filteredAssets.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No assets found.</div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {filteredAssets.map((a) => (
                            <AssetCard
                                key={a.id}
                                asset={a}
                                onClick={() => handleAssetClick(a)}
                                onStatusChange={(_id: string, newStatus) => void handleStatusChange(_id, newStatus as any)}
                                onDownload={handleDownload}
                                onDelete={(asset) => {
                                    void handleStatusChange(asset.id, "deleted" as any)
                                }}
                                stackCount={1}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
