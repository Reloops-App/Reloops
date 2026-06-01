import { admin } from "./supabaseAdmin.ts";

const ACTIVE_ORG_MEMBER_ROLES = ["owner", "admin", "member", "billing"] as const;

export async function isOrgMemberOfWorkspace(workspaceId: string, userId: string): Promise<boolean> {
  const { data: ws, error: wsError } = await admin
    .from("workspaces")
    .select("organization_id")
    .eq("id", workspaceId)
    .maybeSingle();

  if (wsError || !ws) {
    console.error("Workspace lookup error:", wsError);
    return false;
  }

  const { data: membership, error: memberError } = await admin
    .from("organization_members")
    .select("role")
    .eq("organization_id", ws.organization_id)
    .eq("user_id", userId)
    .in("role", [...ACTIVE_ORG_MEMBER_ROLES])
    .limit(1)
    .maybeSingle();

  if (memberError) {
    console.error("Membership check error:", memberError);
    return false;
  }

  return Boolean(membership);
}

export async function canAccessProject(projectId: string, userId: string): Promise<boolean> {
  const { data: project, error: projectError } = await admin
    .from("projects")
    .select("id, workspace_id")
    .eq("id", projectId)
    .maybeSingle();

  if (projectError || !project) {
    console.error("Project lookup error:", projectError);
    return false;
  }

  if (await isOrgMemberOfWorkspace(project.workspace_id, userId)) {
    return true;
  }

  const { data: membership, error: membershipError } = await admin
    .from("project_memberships")
    .select("project_id")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    console.error("Project membership lookup error:", membershipError);
    return false;
  }

  return Boolean(membership);
}

// Check if a user is a member of a given workspace
export async function isMemberOfWorkspace(workspaceId: string, userId: string): Promise<boolean> {
  // 1. Check Organization Membership (Owners, Admins, Members)
  if (await isOrgMemberOfWorkspace(workspaceId, userId)) return true;

  // 2. Check Project Memberships (Guests / Direct Invites)
  const { data: userProjects } = await admin
    .from("project_memberships")
    .select("project_id")
    .eq("user_id", userId);
    
  if (userProjects && userProjects.length > 0) {
    const projectIds = userProjects.map((p: any) => p.project_id);
    const { data: matchingProj } = await admin
      .from("projects")
      .select("id")
      .eq("workspace_id", workspaceId)
      .in("id", projectIds)
      .limit(1)
      .maybeSingle();
      
    if (matchingProj) return true;
  }

  return false;
}

// Check if a user is an admin (owner/admin) of the organization that owns the given workspace
export async function isOrgAdminOfWorkspace(workspaceId: string, userId: string): Promise<boolean> {
  const { data: ws, error: wsError } = await admin
    .from("workspaces")
    .select("organization_id")
    .eq("id", workspaceId)
    .maybeSingle();

  if (wsError || !ws) {
    console.error("Workspace lookup error:", wsError);
    return false;
  }

  const { data: membership, error: memberError } = await admin
    .from("organization_members")
    .select("role")
    .eq("organization_id", ws.organization_id)
    .eq("user_id", userId)
    .in("role", ["owner", "admin"])
    .limit(1)
    .maybeSingle();

  if (memberError) {
    console.error("Membership check error:", memberError);
    return false;
  }

  return Boolean(membership);
}
