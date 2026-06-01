export type Assignee = { id: string; name: string; avatarUrl?: string };

export type ProjectCardProps = {
  project: Project;
  workspaceId: string;
  workspaceLabel?: string;
  className?: string;
};

export interface Project {
    id: string;
    name: string;
    status?: 'active' | 'archived' | 'deleted' | string;
    workspace_id: string;
    assets?: {
      id: string;
      name: string;
      mime_type: string;   // mime type
      size_bytes?: number;
      created_at?: string;
      cover_url?: string;
    }[];
    // Raw fields from the table:
    created_at: string; // ISO; Project card formats it
    // Enriched fields for the card:
    assetsCount?: number;
    assetsApproved?: number;
    assetsPending?: number;
    previewImageUrl?: string;
    previewImages?: string[];
    members?: { name: string; avatarUrl?: string, id: string }[];
    reviewlinksCount?: number; // number of reviewlinks for this project
    workspace_name?: string; // not always present
}
