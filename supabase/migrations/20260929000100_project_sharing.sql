-- Project sharing, part 2 of 2: brings installs created before project sharing up to
-- the schema that 20260527000000_init.sql now creates for fresh installs. Every
-- statement is idempotent, so it is a no-op on fresh installs and safe to re-run.

alter table public.share_links
  add column if not exists project_id uuid references public.projects(id) on delete cascade,
  add column if not exists folder_id uuid references public.folders(id) on delete cascade,
  add column if not exists allow_upload boolean not null default false,
  add column if not exists password_hash text,
  add column if not exists folder_ids uuid[],
  add column if not exists asset_root_ids uuid[],
  add column if not exists access_count integer not null default 0,
  add column if not exists last_accessed_at timestamptz;

alter table public.assets
  add column if not exists uploaded_via_share_link_id uuid,
  add column if not exists uploaded_by_guest_name text,
  add column if not exists uploaded_by_guest_email citext,
  add column if not exists updated_by_guest_name text,
  add column if not exists updated_by_guest_email citext;

alter table public.asset_comments
  add column if not exists guest_author_token_hash text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'share_links_project_scope_check') then
    alter table public.share_links add constraint share_links_project_scope_check check (
      (subject_type = 'project' and project_id = subject_id)
      or (subject_type <> 'project' and project_id is null and folder_id is null and not allow_upload)
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'share_links_selection_requires_project_check') then
    alter table public.share_links add constraint share_links_selection_requires_project_check
      check ((folder_ids is null and asset_root_ids is null) or project_id is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'share_links_selection_not_empty_check') then
    alter table public.share_links add constraint share_links_selection_not_empty_check
      check (folder_ids is null or array_length(folder_ids, 1) > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'share_links_selection_assets_not_empty_check') then
    alter table public.share_links add constraint share_links_selection_assets_not_empty_check
      check (asset_root_ids is null or array_length(asset_root_ids, 1) > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'share_links_folder_id_selection_mutually_exclusive_check') then
    alter table public.share_links add constraint share_links_folder_id_selection_mutually_exclusive_check
      check (folder_id is null or (folder_ids is null and asset_root_ids is null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'assets_uploaded_via_share_link_fkey') then
    alter table public.assets add constraint assets_uploaded_via_share_link_fkey
      foreign key (uploaded_via_share_link_id) references public.share_links(id) on delete set null;
  end if;
end $$;

create index if not exists share_links_project_created_idx on public.share_links (project_id, created_at desc) where project_id is not null;
create index if not exists assets_guest_share_idx on public.assets (uploaded_via_share_link_id) where uploaded_via_share_link_id is not null;
