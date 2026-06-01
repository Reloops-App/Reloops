import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
// Button not required here
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Users, HardDrive, ArrowRight } from 'lucide-react'
import { Separator } from '@/components/ui/separator'

function formatBytes(bytes?: number) {
    if (!bytes || bytes <= 0) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let i = 0
    let v = bytes
    while (v >= 1024 && i < units.length - 1) {
        v /= 1024
        i++
    }
    return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`
}

type WorkspaceWithMeta = {
    ws: { id: string; name: string; archived?: boolean }
    orgName?: string | null
    myOrgRole?: string
    projectsCount?: number
    assetsCount?: number
    storageBytes?: number
    sampleProjects?: { id: string; name: string }[]
    sampleAssets?: { id: string; title: string }[]
}

function initials(name?: string) {
    const parts = (name ?? '').trim().split(/\s+/).slice(0, 2)
    const i = parts.map(p => p[0]?.toUpperCase() ?? '').join('')
    return i || 'WS'
}

export default function WorkspaceCard({
    item,
    showAdminMetrics = false,
}: {
    item: WorkspaceWithMeta
    showAdminMetrics?: boolean
}) {
    const isArchived = item.ws.archived

    const projectsCount = item.projectsCount ?? 0
    const assetsCount = item.assetsCount ?? 0

    return (
        <Link to={`/workspace/${item.ws.id}/projects`} className="group block h-full">
            <Card
                className="
        relative h-full overflow-hidden rounded-lg border border-border/60
        bg-card/90 shadow-sm
        transition-all duration-200
        hover:-translate-y-0.5 hover:border-primary/25 hover:bg-card hover:shadow-md
      "
            >
                <CardHeader className="pb-3">
                    <div className="flex items-start gap-4">
                        {/* Monogram */}
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-base font-semibold text-primary ring-1 ring-primary/15 transition-colors group-hover:bg-primary/15">
                            {initials(item.ws.name)}
                        </div>

                        <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex items-center justify-between gap-2">
                                <CardTitle className="truncate text-base font-semibold tracking-tight transition-colors group-hover:text-primary">
                                    {item.ws.name}
                                </CardTitle>
                                {isArchived && (
                                    <Badge variant="secondary" className="h-5 rounded-md px-1.5 text-[10px] font-medium">
                                        Archived
                                    </Badge>
                                )}
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <div className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                                            <span className="truncate max-w-[120px]">{item.orgName ?? 'Personal'}</span>
                                        </div>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="text-xs">Organization</TooltipContent>
                                </Tooltip>

                                <Badge
                                    variant={item.myOrgRole === 'owner' ? 'default' : item.myOrgRole === 'admin' ? 'secondary' : 'outline'}
                                    className="h-5 rounded-md px-1.5 text-[10px] capitalize"
                                >
                                    {item.myOrgRole}
                                </Badge>
                            </div>
                        </div>
                    </div>
                </CardHeader>

                <CardContent className="space-y-4">
                    <Separator className="bg-border/40" />

                    {showAdminMetrics ? (
                        <div className="grid grid-cols-2 gap-3">
                            <div className="flex flex-col gap-1 rounded-md border border-border/50 bg-muted/20 p-2.5 transition-colors group-hover:bg-muted/35">
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                    <Users className="h-3.5 w-3.5" />
                                    <span>Projects</span>
                                </div>
                                <span className="text-lg font-semibold tabular-nums tracking-tight">{projectsCount}</span>
                            </div>

                            <div className="flex flex-col gap-1 rounded-md border border-border/50 bg-muted/20 p-2.5 transition-colors group-hover:bg-muted/35">
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                    <HardDrive className="h-3.5 w-3.5" />
                                    <span>Assets</span>
                                </div>
                                <span className="text-lg font-semibold tabular-nums tracking-tight">{assetsCount}</span>
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center justify-between rounded-md bg-muted/25 px-3 py-2 text-sm text-muted-foreground">
                            <span>Access Level</span>
                            <span className="font-medium text-foreground capitalize">{item.myOrgRole}</span>
                        </div>
                    )}

                    <div className="flex items-center justify-end pt-1">
                        <span className="flex items-center gap-1 text-xs font-medium text-primary opacity-0 transition-all duration-300 group-hover:translate-x-1 group-hover:opacity-100">
                            Open Workspace <ArrowRight className="h-3 w-3" />
                        </span>
                    </div>
                </CardContent>
            </Card>
        </Link>
    )
}
