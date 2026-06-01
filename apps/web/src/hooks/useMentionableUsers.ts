import { useState, useEffect } from "react";
import { invokeEdgeFunction } from "@/api/edge";

export type MentionableUser = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  email?: string | null;
  role?: string;
  category: 'org_member' | 'project_reviewer' | 'project_collaborator' | 'recent_collaborator';
  categoryLabel: string;
  priority?: number; // for sorting within categories
};

export type MentionUsersByCategory = {
  org_members: MentionableUser[];
  project_reviewers: MentionableUser[];
  project_collaborators: MentionableUser[];
  recent_collaborators: MentionableUser[];
};

type UseMentionableUsersOptions = {
  projectId?: string | null;
  organizationId?: string | null;
  workspaceId?: string | null;
  assetId?: string | null; // for loading recent collaborators on specific asset
};

export function useMentionableUsers({
  projectId,
  organizationId,
  workspaceId,
  assetId,
}: UseMentionableUsersOptions = {}) {
  const [users, setUsers] = useState<MentionableUser[]>([]);
  const [usersByCategory, setUsersByCategory] = useState<MentionUsersByCategory>({
    org_members: [],
    project_reviewers: [],
    project_collaborators: [],
    recent_collaborators: [],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const loadUsers = async () => {
      if (!projectId && !organizationId) {
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const { data, error } = await invokeEdgeFunction('get-mentionable-users', {
          body: { projectId, organizationId, assetId }
        });

        if (error) throw error;
        if (!mounted) return;

        const allUsers: MentionableUser[] = Array.isArray(data?.users)
          ? data.users.filter((user: Partial<MentionableUser> | null): user is MentionableUser => (
            Boolean(user) &&
            typeof user?.id === "string" &&
            user.id.length > 0
          ))
          : [];

        // Sort users within each category by priority
        const sortedUsers = allUsers.sort((a, b) => {
          // First sort by category priority
          const categoryPriority = {
            'recent_collaborator': 1,
            'project_reviewer': 2,
            'project_collaborator': 3,
            'org_member': 4,
          };

          const categoryDiff = (categoryPriority[a.category as keyof typeof categoryPriority] ?? 99) - (categoryPriority[b.category as keyof typeof categoryPriority] ?? 99);
          if (categoryDiff !== 0) return categoryDiff;

          // Then by role priority within category
          const priorityA = a.priority || 999;
          const priorityB = b.priority || 999;
          if (priorityA !== priorityB) return priorityA - priorityB;

          // Finally by display name
          const nameA = a.display_name || a.id;
          const nameB = b.display_name || b.id;
          return nameA.localeCompare(nameB);
        });

        // Group by category
        const grouped: MentionUsersByCategory = {
          org_members: sortedUsers.filter(u => u.category === 'org_member'),
          project_reviewers: sortedUsers.filter(u => u.category === 'project_reviewer'),
          project_collaborators: sortedUsers.filter(u => u.category === 'project_collaborator'),
          recent_collaborators: sortedUsers.filter(u => u.category === 'recent_collaborator'),
        };

        console.log('🎯 Final mentionable users:', {
          totalUsers: sortedUsers.length,
          orgMembers: grouped.org_members.length,
          projectReviewers: grouped.project_reviewers.length,
          projectCollaborators: grouped.project_collaborators.length,
          recentCollaborators: grouped.recent_collaborators.length
        });

        setUsers(sortedUsers);
        setUsersByCategory(grouped);
      } catch (e: any) {
        if (!mounted) return;
        console.error("Failed to load mentionable users:", e);
        setError(e.message || "Failed to load users");
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    loadUsers();

    return () => {
      mounted = false;
    };
  }, [projectId, organizationId, workspaceId, assetId]);

  return {
    users,
    usersByCategory,
    loading,
    error,
  };
}
