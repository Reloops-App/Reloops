import { corsHeaders, json } from "../_shared/cors.ts";
import { admin, requireUser, readBody, isWorkspaceMember } from "../_shared/admin.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeCollectionDefinition(current: unknown, body: Record<string, unknown>) {
  const base = isRecord(current) ? current : {};
  const incoming = isRecord(body.definition) ? body.definition : {};
  const currentSource = isRecord(base.source) ? base.source : {};
  const incomingSource = isRecord(incoming.source) ? incoming.source : {};
  const currentAppearance = isRecord(base.appearance) ? base.appearance : {};
  const incomingAppearance = isRecord(incoming.appearance) ? incoming.appearance : {};
  const currentGrouping = isRecord(base.grouping) ? base.grouping : {};
  const incomingGrouping = isRecord(incoming.grouping) ? incoming.grouping : {};
  const currentFields = isRecord(base.fields) ? base.fields : {};
  const incomingFields = isRecord(incoming.fields) ? incoming.fields : {};
  const currentFilters = isRecord(base.filters) ? base.filters : {};
  const incomingFilters = isRecord(incoming.filters) ? incoming.filters : {};
  const currentSort = isRecord(base.sort) ? base.sort : {};
  const incomingSort = isRecord(incoming.sort) ? incoming.sort : {};
  const currentHeader = isRecord(base.header) ? base.header : {};
  const incomingHeader = isRecord(incoming.header) ? incoming.header : {};
  const currentHeaderBackground = isRecord(currentHeader.background) ? currentHeader.background : {};
  const incomingHeaderBackground = isRecord(incomingHeader.background) ? incomingHeader.background : {};
  const currentHeaderIcon = isRecord(currentHeader.icon) ? currentHeader.icon : {};
  const incomingHeaderIcon = isRecord(incomingHeader.icon) ? incomingHeader.icon : {};

  return {
    ...base,
    ...incoming,
    source: {
      ...currentSource,
      ...incomingSource,
      ...("source_type" in body ? { type: body.source_type } : {}),
      ...("source_project_id" in body ? { project_id: body.source_project_id } : {}),
      ...("source_folder_id" in body ? { folder_id: body.source_folder_id } : {}),
    },
    appearance: {
      ...currentAppearance,
      ...incomingAppearance,
      ...("appearance" in body ? { mode: body.appearance } : {}),
    },
    grouping: {
      ...currentGrouping,
      ...incomingGrouping,
      ...("group_mode" in body ? { mode: body.group_mode } : {}),
    },
    fields: {
      ...currentFields,
      ...incomingFields,
      ...("visible_fields" in body ? { visible: body.visible_fields } : {}),
    },
    filters: {
      ...currentFilters,
      ...incomingFilters,
      ...("filters" in body ? { items: body.filters } : {}),
    },
    sort: {
      ...currentSort,
      ...incomingSort,
      ...("sort_key" in body ? { key: body.sort_key } : {}),
      ...("sort_dir" in body ? { dir: body.sort_dir } : {}),
    },
    header: {
      ...currentHeader,
      ...incomingHeader,
      background: {
        ...currentHeaderBackground,
        ...incomingHeaderBackground,
      },
      icon: {
        ...currentHeaderIcon,
        ...incomingHeaderIcon,
      },
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const user = await requireUser(req);
    const body = await readBody(req);
    const action = body.action ?? "list";
    const workspaceId = String(body.workspace_id ?? body.workspaceId ?? "");
    if (workspaceId && !await isWorkspaceMember(workspaceId, user.id)) return json({ error: "Forbidden" }, { status: 403 });

    if (action === "list") {
      const { data, error } = await admin.from("collections").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false });
      if (error) throw error;
      return json({ data });
    }
    if (action === "get") {
      const { data, error } = await admin.from("collections").select("*").eq("id", body.id ?? body.collection_id).single();
      if (error) throw error;
      return json({ data });
    }
    if (action === "create") {
      const { data, error } = await admin.from("collections").insert({
        workspace_id: workspaceId,
        name: body.name ?? "Untitled Collection",
        description: body.description ?? null,
        definition: body.definition ?? { version: 1 },
        created_by: user.id,
      }).select("*").single();
      if (error) throw error;
      return json({ data });
    }
    if (action === "update") {
      const patch: Record<string, unknown> = {};
      for (const key of ["name", "description"]) {
        if (key in body) patch[key] = body[key];
      }
      const { data: current } = await admin.from("collections").select("definition").eq("id", body.id ?? body.collection_id).maybeSingle();
      patch.definition = mergeCollectionDefinition(current?.definition, body);
      const { data, error } = await admin.from("collections").update({
        ...patch,
      }).eq("id", body.id ?? body.collection_id).select("*").single();
      if (error) throw error;
      return json({ data });
    }
    if (action === "delete") {
      const id = body.id ?? body.collection_id;
      const { error } = await admin.from("collections").delete().eq("id", id);
      if (error) throw error;
      return json({ data: { id } });
    }
    return json({ error: `Unsupported collections action: ${action}` }, { status: 400 });
  } catch (e) {
    if (e instanceof Response) return e;
    return json({ error: e?.message ?? "Collections failed" }, { status: 500 });
  }
});
