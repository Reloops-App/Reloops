import * as React from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import {
  Bell,
  CheckCheck,
  FileText,
  MessageCircle,
  MoreHorizontal,
  Search,
  UserRound,
} from "lucide-react";

import { invokeEdgeFunction } from "@/api/edge";
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type NotificationRow = {
  id: string;
  workspace_id: string;
  project_id?: string | null;
  asset_id?: string | null;
  notification_type: string;
  title: string;
  message?: string | null;
  target_url?: string | null;
  actor_guest_name?: string | null;
  read_at?: string | null;
  created_at: string;
  metadata?: Record<string, unknown> | null;
};

type NotificationTab = "all" | "mentions" | "reviews" | "files";

const tabFilters: Record<NotificationTab, (row: NotificationRow) => boolean> = {
  all: () => true,
  mentions: (row) => row.notification_type === "comment.mention",
  reviews: (row) => row.notification_type.startsWith("review.") || row.notification_type === "guest.feedback",
  files: (row) => row.notification_type.startsWith("file.") || row.notification_type.startsWith("asset.intelligence"),
};

function iconForType(type: string) {
  if (type === "comment.mention" || type === "comment.reply") return MessageCircle;
  if (type.startsWith("review.") || type === "guest.feedback") return UserRound;
  if (type.startsWith("file.") || type.startsWith("asset.intelligence")) return FileText;
  if (type.startsWith("search.")) return Search;
  return Bell;
}

function subtitleFor(row: NotificationRow) {
  if (row.notification_type.startsWith("asset.intelligence")) {
    return formatDistanceToNow(new Date(row.created_at), { addSuffix: true });
  }

  const projectName = typeof row.metadata?.project_name === "string" ? row.metadata.project_name : null;
  const assetTitle = typeof row.metadata?.asset_title === "string" ? row.metadata.asset_title : null;
  const context = projectName || assetTitle;
  const time = formatDistanceToNow(new Date(row.created_at), { addSuffix: true });
  return context ? `in ${context} · ${time}` : time;
}

export function NotificationDrawer({
  workspaceId,
  unreadCount,
  onUnreadCountChange,
}: {
  workspaceId: string;
  unreadCount: number;
  onUnreadCountChange: (count: number) => void;
}) {
  const navigate = useNavigate();
  const { state: sidebarState, isMobile } = useSidebar();
  const [open, setOpen] = React.useState(false);
  const [tab, setTab] = React.useState<NotificationTab>("all");
  const [loading, setLoading] = React.useState(false);
  const [rows, setRows] = React.useState<NotificationRow[]>([]);
  const [flyoutTop, setFlyoutTop] = React.useState(72);
  const [flyoutLeft, setFlyoutLeft] = React.useState(272);
  const closeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = React.useRef<HTMLDivElement | null>(null);

  const updateFlyoutPosition = React.useCallback(() => {
    if (typeof window === "undefined") return;
    const triggerRect = triggerRef.current?.getBoundingClientRect();
    const panelHeight = Math.min(640, window.innerHeight - 24);
    const panelWidth = Math.min(390, window.innerWidth - 24);
    const targetTop = triggerRect
      ? triggerRect.top + (triggerRect.height / 2) - (panelHeight / 2)
      : 72;
    const maxTop = Math.max(12, window.innerHeight - panelHeight - 12);
    const targetLeft = triggerRect
      ? triggerRect.right + 8
      : sidebarState === "collapsed"
        ? 56
        : 264;
    const maxLeft = Math.max(12, window.innerWidth - panelWidth - 12);
    setFlyoutTop(Math.min(Math.max(targetTop, 12), maxTop));
    setFlyoutLeft(Math.min(Math.max(targetLeft, 12), maxLeft));
  }, [sidebarState]);

  const clearCloseTimer = React.useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const showFlyout = React.useCallback(() => {
    clearCloseTimer();
    updateFlyoutPosition();
    setOpen(true);
  }, [clearCloseTimer, updateFlyoutPosition]);

  const hideFlyoutSoon = React.useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => setOpen(false), 180);
  }, [clearCloseTimer]);

  React.useEffect(() => clearCloseTimer, [clearCloseTimer]);

  React.useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", updateFlyoutPosition);
    window.addEventListener("scroll", updateFlyoutPosition, true);
    return () => {
      window.removeEventListener("resize", updateFlyoutPosition);
      window.removeEventListener("scroll", updateFlyoutPosition, true);
    };
  }, [open, updateFlyoutPosition]);

  const load = React.useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const [{ data: listData }, { data: countData }] = await Promise.all([
        invokeEdgeFunction<{ data?: NotificationRow[] }>("notifications", {
          body: { action: "list", workspace_id: workspaceId, limit: 80 },
        }),
        invokeEdgeFunction<{ data?: { count?: number } }>("notifications", {
          body: { action: "unread-count", workspace_id: workspaceId },
        }),
      ]);
      setRows(Array.isArray(listData?.data) ? listData.data : []);
      onUnreadCountChange(Number(countData?.data?.count ?? 0) || 0);
    } finally {
      setLoading(false);
    }
  }, [onUnreadCountChange, workspaceId]);

  React.useEffect(() => {
    if (open) void load();
  }, [load, open]);

  const filteredRows = React.useMemo(
    () => rows.filter(tabFilters[tab]),
    [rows, tab],
  );

  async function markRead(row: NotificationRow) {
    if (row.read_at) return;
    setRows((current) => current.map((item) => item.id === row.id ? { ...item, read_at: new Date().toISOString() } : item));
    onUnreadCountChange(Math.max(0, unreadCount - 1));
    await invokeEdgeFunction("notifications", {
      body: { action: "mark-read", workspace_id: workspaceId, notification_id: row.id },
    });
  }

  async function markUnread(row: NotificationRow) {
    if (!row.read_at) return;
    setRows((current) => current.map((item) => item.id === row.id ? { ...item, read_at: null } : item));
    onUnreadCountChange(unreadCount + 1);
    await invokeEdgeFunction("notifications", {
      body: { action: "mark-unread", workspace_id: workspaceId, notification_id: row.id },
    });
  }

  async function markAllRead() {
    setRows((current) => current.map((row) => ({ ...row, read_at: row.read_at ?? new Date().toISOString() })));
    onUnreadCountChange(0);
    await invokeEdgeFunction("notifications", {
      body: { action: "mark-all-read", workspace_id: workspaceId },
    });
  }

  async function openNotification(row: NotificationRow) {
    await markRead(row);
    setOpen(false);
    if (row.target_url) navigate(row.target_url);
  }

  const flyoutStyle = React.useMemo(
    () => ({
      top: isMobile ? "0.75rem" : `${flyoutTop}px`,
      left: `${flyoutLeft}px`,
      width: `min(390px, calc(100vw - ${flyoutLeft}px - 0.75rem))`,
    }) as React.CSSProperties,
    [flyoutLeft, flyoutTop, isMobile],
  );

  const flyout = (
    <div className="fixed inset-0 z-[1000] pointer-events-none">
      <div
        className={cn(
          "fixed rounded-xl bg-sidebar transition-opacity duration-150",
          open ? "opacity-100" : "opacity-0",
        )}
        style={flyoutStyle}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-label="Notifications"
        className={cn(
          "fixed isolate z-[1001] flex h-[min(640px,calc(100vh-1.5rem))] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-xl border border-sidebar-border bg-sidebar text-sidebar-foreground shadow-2xl outline-none ring-1 ring-black/10 transition-all duration-150",
          open
            ? "pointer-events-auto translate-x-0 opacity-100"
            : "pointer-events-none -translate-x-1 opacity-0",
        )}
        style={flyoutStyle}
        tabIndex={-1}
        onMouseEnter={showFlyout}
        onMouseLeave={hideFlyoutSoon}
      >
      <div className="border-b border-sidebar-border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold tracking-normal">Notifications</h2>
            <p className="mt-0.5 text-xs text-sidebar-foreground/55">Review activity, mentions, and file updates</p>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" onClick={markAllRead} disabled={unreadCount === 0}>
              <CheckCheck className="h-4 w-4" />
              <span className="sr-only">Mark all read</span>
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">More notification actions</span>
            </Button>
          </div>
        </div>
        <Tabs value={tab} onValueChange={(value) => setTab(value as NotificationTab)}>
          <TabsList className="mt-3 grid h-9 w-full grid-cols-4 bg-transparent p-0">
            <TabsTrigger value="all" className="gap-1 rounded-md border border-transparent px-2 text-sidebar-foreground/65 data-[state=active]:border-sidebar-border data-[state=active]:bg-sidebar-accent data-[state=active]:text-sidebar-accent-foreground">
              All {unreadCount > 0 ? <span className="rounded-full bg-sidebar-primary px-1.5 text-[10px] text-sidebar-primary-foreground">{unreadCount}</span> : null}
            </TabsTrigger>
            <TabsTrigger value="mentions" className="rounded-md border border-transparent px-2 text-sidebar-foreground/65 data-[state=active]:border-sidebar-border data-[state=active]:bg-sidebar-accent data-[state=active]:text-sidebar-accent-foreground">
              Mentions
            </TabsTrigger>
            <TabsTrigger value="reviews" className="rounded-md border border-transparent px-2 text-sidebar-foreground/65 data-[state=active]:border-sidebar-border data-[state=active]:bg-sidebar-accent data-[state=active]:text-sidebar-accent-foreground">
              Reviews
            </TabsTrigger>
            <TabsTrigger value="files" className="rounded-md border border-transparent px-2 text-sidebar-foreground/65 data-[state=active]:border-sidebar-border data-[state=active]:bg-sidebar-accent data-[state=active]:text-sidebar-accent-foreground">
              Files
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {loading ? (
          <div className="space-y-4 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="h-16 animate-pulse rounded-lg bg-sidebar-accent/50" />
            ))}
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="flex min-h-[320px] flex-col items-center justify-center px-8 text-center">
            <div className="grid h-12 w-12 place-items-center rounded-full bg-sidebar-accent">
              <Bell className="h-5 w-5 text-sidebar-foreground/60" />
            </div>
            <div className="mt-4 text-sm font-medium">No notifications yet</div>
            <div className="mt-1 text-sm text-sidebar-foreground/60">
              Important review activity, comments, assignments, and approvals will appear here.
            </div>
          </div>
        ) : (
          <div className="divide-y divide-sidebar-border">
            {filteredRows.map((row) => {
              const Icon = iconForType(row.notification_type);
              const unread = !row.read_at;
              return (
                <div
                  key={row.id}
                  role="button"
                  tabIndex={0}
                  className="group flex w-full gap-3 px-4 py-4 text-left transition-colors hover:bg-sidebar-accent/70"
                  onClick={() => void openNotification(row)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      void openNotification(row);
                    }
                  }}
                >
                  <div className="relative mt-0.5">
                    {unread ? <span className="absolute -left-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-500" /> : null}
                    <div className="grid h-9 w-9 place-items-center rounded-full bg-sidebar-accent text-sidebar-foreground/60 group-hover:text-sidebar-accent-foreground">
                      <Icon className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={cn("text-sm leading-5", unread ? "font-semibold text-sidebar-foreground" : "font-medium text-sidebar-foreground/80")}>
                      {row.title}
                    </div>
                    {row.message ? (
                      <div className="mt-1 line-clamp-2 text-xs leading-5 text-sidebar-foreground/60">
                        {row.message}
                      </div>
                    ) : null}
                    <div className="mt-1 text-xs text-sidebar-foreground/50">
                      {subtitleFor(row)}
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="mt-0.5 h-8 w-8 shrink-0 text-sidebar-foreground/45 opacity-0 transition-opacity hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-hover:opacity-100 focus:opacity-100"
                        onClick={(event) => event.stopPropagation()}
                        aria-label="Notification actions"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {unread ? (
                        <DropdownMenuItem
                          onClick={(event) => {
                            event.stopPropagation();
                            void markRead(row);
                          }}
                        >
                          Mark as read
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          onClick={(event) => {
                            event.stopPropagation();
                            void markUnread(row);
                          }}
                        >
                          Mark as unread
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>
      </div>
    </div>
  );

  return (
    <SidebarMenuItem>
        <div
          ref={triggerRef}
          className="relative"
          onMouseEnter={showFlyout}
          onMouseLeave={hideFlyoutSoon}
          onFocus={showFlyout}
          onBlur={(event) => {
            const nextTarget = event.relatedTarget as Node | null;
            if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
              hideFlyoutSoon();
            }
          }}
        >
          <SidebarMenuButton
            tooltip="Notifications"
            aria-expanded={open}
            aria-haspopup="dialog"
            data-state={open ? "open" : "closed"}
            className={cn(
              "relative w-full min-w-0 justify-start rounded-lg text-sidebar-foreground/72",
              "hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground",
              "data-[state=open]:bg-sidebar-accent/85 data-[state=open]:text-sidebar-accent-foreground",
            )}
            onClick={() => setOpen((current) => !current)}
          >
            <Bell />
            <span className="block truncate">Notifications</span>
            {unreadCount > 0 ? (
              <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-sidebar-accent px-1.5 text-[10px] font-semibold leading-4 text-sidebar-foreground/75">
                {unreadCount}
              </span>
            ) : null}
          </SidebarMenuButton>
          {typeof document !== "undefined" ? createPortal(flyout, document.body) : null}
        </div>
      </SidebarMenuItem>
  );
}
