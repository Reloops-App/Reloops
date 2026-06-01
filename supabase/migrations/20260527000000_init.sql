create extension if not exists pgcrypto;
create extension if not exists citext;

create type public.workspace_role as enum ('owner', 'admin', 'member', 'reviewer', 'billing');
create type public.asset_status as enum ('needs_review', 'in_review', 'approved', 'published', 'archived', 'deleted');
create type public.share_subject_type as enum ('asset', 'collection');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null default 'personal' check (type in ('personal', 'team')),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email citext,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  status text not null default 'active' check (status in ('active', 'archived', 'deleted')),
  logo_url text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_by_api_key_id uuid,
  updated_by uuid references auth.users(id) on delete set null,
  updated_by_api_key_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.workspace_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.workspace_role not null default 'member',
  invited_email citext,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'active' check (status in ('active', 'archived', 'deleted')),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_by_api_key_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.folders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  parent_folder_id uuid references public.folders(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, project_id, parent_folder_id, name)
);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  folder_id uuid references public.folders(id) on delete set null,
  parent_asset_id uuid references public.assets(id) on delete cascade,
  version_no integer not null default 1 check (version_no > 0),
  title text not null,
  description text,
  tags text[] not null default '{}'::text[],
  smart_tags text[] not null default '{}'::text[],
  status public.asset_status not null default 'needs_review',
  storage_path text not null,
  cover_image_url text,
  thumbnail_path text,
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null default 0,
  width integer,
  height integer,
  duration_ms integer,
  upload_batch_id uuid,
  upload_batch_total integer,
  uploaded_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_by uuid references auth.users(id) on delete set null,
  assigned_to uuid references auth.users(id) on delete set null,
  smart_description text,
  ai_description text,
  ai_metadata jsonb,
  usage_rights text,
  approval_status text,
  created_by_api_key_id uuid,
  uploaded_by_api_key_id uuid,
  assigned_to_api_key_id uuid,
  updated_by_api_key_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (parent_asset_id, version_no)
);

create table public.asset_comments (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  parent_id uuid references public.asset_comments(id) on delete cascade,
  author_user_id uuid references auth.users(id) on delete set null,
  guest_name text,
  guest_email citext,
  author_api_key_id uuid,
  body text not null,
  media_ms integer,
  marker jsonb,
  ms_offset integer,
  drawing_json jsonb,
  media_ms_start integer,
  media_ms_end integer,
  status text not null default 'active' check (status in ('active', 'completed', 'deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.collections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  description text,
  definition jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  provider text,
  icon_url text,
  key_hash text,
  prefix text,
  last_used_at timestamptz,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.asset_history (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  event_type text not null,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_api_key_id uuid references public.api_keys(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  email citext not null,
  role public.workspace_role not null default 'member',
  status text not null default 'pending' check (status in ('pending', 'accepted', 'denied', 'revoked')),
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  invited_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.collection_asset_links (
  collection_id uuid not null references public.collections(id) on delete cascade,
  asset_root_id uuid not null references public.assets(id) on delete cascade,
  state text not null default 'include' check (state in ('include', 'exclude')),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (collection_id, asset_root_id)
);

create table public.project_asset_links (
  project_id uuid not null references public.projects(id) on delete cascade,
  asset_root_id uuid not null references public.assets(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (project_id, asset_root_id)
);

create table public.share_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  subject_type public.share_subject_type not null,
  subject_id uuid not null,
  token text not null unique,
  asset_id uuid references public.assets(id) on delete cascade,
  parent_asset_id uuid references public.assets(id) on delete cascade,
  token_hash text,
  can_comment boolean not null default true,
  allow_download boolean not null default true,
  allow_comments boolean not null default true,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.asset_intelligence_jobs (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  upload_batch_id uuid not null,
  upload_batch_total int not null default 1 check (upload_batch_total > 0),
  requested_by_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed')),
  attempts int not null default 0,
  max_attempts int not null default 3,
  locked_by text,
  lease_expires_at timestamptz,
  error text,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index assets_workspace_project_idx on public.assets (workspace_id, project_id, created_at desc);
create index assets_parent_idx on public.assets (coalesce(parent_asset_id, id), version_no desc);
create index assets_tags_idx on public.assets using gin (tags);
create index comments_asset_idx on public.asset_comments (asset_id, created_at asc);
create index collections_workspace_idx on public.collections (workspace_id, updated_at desc);
create index workspaces_organization_idx on public.workspaces (organization_id);
create index organization_members_user_idx on public.organization_members (user_id);
create index asset_history_asset_idx on public.asset_history (asset_id, created_at desc);
create index asset_history_workspace_created_idx on public.asset_history (workspace_id, created_at desc);
create index api_keys_organization_idx on public.api_keys (organization_id);
create unique index api_keys_key_hash_unique_idx on public.api_keys (key_hash) where key_hash is not null;
create index project_asset_links_asset_root_project_idx on public.project_asset_links (asset_root_id, project_id);
create index share_links_asset_created_idx on public.share_links (asset_id, created_at desc);
create unique index share_links_token_hash_unique_idx on public.share_links (token_hash) where token_hash is not null;
create index asset_intelligence_jobs_claim_idx on public.asset_intelligence_jobs (status, lease_expires_at, created_at);
create index asset_intelligence_jobs_asset_idx on public.asset_intelligence_jobs (asset_id, created_at desc);
create index asset_intelligence_jobs_batch_idx on public.asset_intelligence_jobs (upload_batch_id, workspace_id, project_id);
create unique index asset_intelligence_jobs_upload_asset_once_idx on public.asset_intelligence_jobs (asset_id, upload_batch_id);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at before update on public.profiles for each row execute function public.touch_updated_at();
create trigger organizations_touch_updated_at before update on public.organizations for each row execute function public.touch_updated_at();
create trigger workspaces_touch_updated_at before update on public.workspaces for each row execute function public.touch_updated_at();
create trigger projects_touch_updated_at before update on public.projects for each row execute function public.touch_updated_at();
create trigger folders_touch_updated_at before update on public.folders for each row execute function public.touch_updated_at();
create trigger assets_touch_updated_at before update on public.assets for each row execute function public.touch_updated_at();
create trigger comments_touch_updated_at before update on public.asset_comments for each row execute function public.touch_updated_at();
create trigger collections_touch_updated_at before update on public.collections for each row execute function public.touch_updated_at();
create trigger asset_intelligence_jobs_touch_updated_at before update on public.asset_intelligence_jobs for each row execute function public.touch_updated_at();

create or replace function public.enqueue_asset_intelligence_job_for_asset()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.asset_intelligence_jobs (
    asset_id,
    workspace_id,
    project_id,
    upload_batch_id,
    upload_batch_total,
    requested_by_user_id
  )
  values (
    new.id,
    new.workspace_id,
    new.project_id,
    coalesce(new.upload_batch_id, gen_random_uuid()),
    coalesce(new.upload_batch_total, 1),
    new.uploaded_by
  )
  on conflict (asset_id, upload_batch_id) do nothing;

  return new;
end;
$$;

create trigger assets_enqueue_asset_intelligence
  after insert on public.assets
  for each row execute function public.enqueue_asset_intelligence_job_for_asset();

create or replace function public.claim_asset_intelligence_job(
  worker_id text,
  lease_seconds int default 300
)
returns setof public.asset_intelligence_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_id uuid;
begin
  select id
  into claimed_id
  from public.asset_intelligence_jobs
  where
    (
      status = 'queued'
      or (
        status = 'processing'
        and lease_expires_at is not null
        and lease_expires_at < now()
      )
    )
    and attempts < max_attempts
  order by created_at asc
  for update skip locked
  limit 1;

  if claimed_id is null then
    return;
  end if;

  return query
  update public.asset_intelligence_jobs
  set
    status = 'processing',
    attempts = attempts + 1,
    locked_by = worker_id,
    lease_expires_at = now() + make_interval(secs => greatest(lease_seconds, 30)),
    updated_at = now(),
    error = null
  where id = claimed_id
  returning *;
end;
$$;

create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
  )
  or exists (
    select 1
    from public.workspaces w
    join public.organization_members om on om.organization_id = w.organization_id
    where w.id = target_workspace_id
      and om.user_id = auth.uid()
  );
$$;

create or replace function public.is_workspace_owner(target_workspace_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.role = 'owner'
  )
  or exists (
    select 1
    from public.workspaces w
    join public.organization_members om on om.organization_id = w.organization_id
    where w.id = target_workspace_id
      and om.user_id = auth.uid()
      and om.role = 'owner'
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  organization_id uuid;
  workspace_id uuid;
  profile_name text;
begin
  profile_name := coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1), 'User');

  insert into public.profiles (id, email, display_name, avatar_url)
  values (new.id, new.email, profile_name, new.raw_user_meta_data->>'avatar_url')
  on conflict (id) do nothing;

  insert into public.organizations (name, type, created_by)
  values (profile_name || '''s Organization', 'personal', new.id)
  returning id into organization_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (organization_id, new.id, 'owner');

  insert into public.workspaces (organization_id, name, created_by)
  values (organization_id, profile_name || '''s Workspace', new.id)
  returning id into workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (workspace_id, new.id, 'owner');

  insert into public.projects (workspace_id, name, description, created_by)
  values (workspace_id, 'First Project', 'A starting point for reviews.', new.id);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.projects enable row level security;
alter table public.folders enable row level security;
alter table public.assets enable row level security;
alter table public.asset_comments enable row level security;
alter table public.collections enable row level security;
alter table public.collection_asset_links enable row level security;
alter table public.project_asset_links enable row level security;
alter table public.share_links enable row level security;
alter table public.api_keys enable row level security;
alter table public.asset_history enable row level security;
alter table public.asset_intelligence_jobs enable row level security;
alter table public.invitations enable row level security;

create policy profiles_select on public.profiles for select using (true);
create policy profiles_update_own on public.profiles for update using (auth.uid() = id);

create policy organizations_select_member on public.organizations for select using (
  exists (
    select 1 from public.organization_members om
    where om.organization_id = organizations.id
      and om.user_id = auth.uid()
  )
);
create policy organizations_insert_auth on public.organizations for insert with check (auth.uid() = created_by);
create policy organizations_update_owner on public.organizations for update using (
  exists (
    select 1 from public.organization_members om
    where om.organization_id = organizations.id
      and om.user_id = auth.uid()
      and om.role = 'owner'
  )
);

create policy organization_members_select_member on public.organization_members for select using (
  user_id = auth.uid()
);
create policy organization_members_insert_owner on public.organization_members for insert with check (
  organization_members.user_id = auth.uid()
  and organization_members.role = 'owner'
);
create policy organization_members_update_owner on public.organization_members for update using (
  user_id = auth.uid()
);
create policy organization_members_delete_owner on public.organization_members for delete using (
  user_id = auth.uid()
);

create policy workspaces_select_member on public.workspaces for select using (public.is_workspace_member(id));
create policy workspaces_insert_auth on public.workspaces for insert with check (auth.uid() = created_by);
create policy workspaces_update_owner on public.workspaces for update using (public.is_workspace_owner(id));
create policy workspaces_delete_owner on public.workspaces for delete using (public.is_workspace_owner(id));

create policy workspace_members_select_member on public.workspace_members for select using (public.is_workspace_member(workspace_id));
create policy workspace_members_insert_owner on public.workspace_members for insert with check (
  public.is_workspace_owner(workspace_id)
  or exists (
    select 1 from public.workspaces w
    where w.id = workspace_members.workspace_id
      and w.created_by = auth.uid()
      and workspace_members.user_id = auth.uid()
      and workspace_members.role = 'owner'
  )
);
create policy workspace_members_update_owner on public.workspace_members for update using (public.is_workspace_owner(workspace_id));
create policy workspace_members_delete_owner on public.workspace_members for delete using (public.is_workspace_owner(workspace_id));

create policy projects_all_member on public.projects for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy folders_all_member on public.folders for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy assets_all_member on public.assets for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy comments_select_member on public.asset_comments for select using (
  exists (select 1 from public.assets a where a.id = asset_comments.asset_id and public.is_workspace_member(a.workspace_id))
);
create policy comments_insert_member on public.asset_comments for insert with check (
  exists (select 1 from public.assets a where a.id = asset_comments.asset_id and public.is_workspace_member(a.workspace_id))
);
create policy comments_update_author_or_member on public.asset_comments for update using (
  author_user_id = auth.uid()
  or exists (select 1 from public.assets a where a.id = asset_comments.asset_id and public.is_workspace_member(a.workspace_id))
);

create policy collections_all_member on public.collections for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy collection_links_all_member on public.collection_asset_links for all using (
  exists (select 1 from public.collections c where c.id = collection_asset_links.collection_id and public.is_workspace_member(c.workspace_id))
) with check (
  exists (select 1 from public.collections c where c.id = collection_asset_links.collection_id and public.is_workspace_member(c.workspace_id))
);
create policy project_asset_links_all_member on public.project_asset_links for all using (
  exists (select 1 from public.projects p where p.id = project_asset_links.project_id and public.is_workspace_member(p.workspace_id))
) with check (
  exists (
    select 1
    from public.projects p
    join public.assets a on a.id = project_asset_links.asset_root_id
    where p.id = project_asset_links.project_id
      and a.workspace_id = p.workspace_id
      and public.is_workspace_member(p.workspace_id)
  )
);
create policy share_links_all_member on public.share_links for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy api_keys_all_member on public.api_keys for all using (
  exists (
    select 1 from public.workspaces w
    where w.organization_id = api_keys.organization_id
      and public.is_workspace_member(w.id)
  )
) with check (
  exists (
    select 1 from public.workspaces w
    where w.organization_id = api_keys.organization_id
      and public.is_workspace_member(w.id)
  )
);
create policy asset_history_select_member on public.asset_history for select using (
  exists (select 1 from public.assets a where a.id = asset_history.asset_id and public.is_workspace_member(a.workspace_id))
);
create policy asset_history_insert_member on public.asset_history for insert with check (
  exists (select 1 from public.assets a where a.id = asset_history.asset_id and public.is_workspace_member(a.workspace_id))
);
create policy asset_intelligence_jobs_select_member on public.asset_intelligence_jobs for select using (
  public.is_workspace_member(workspace_id)
);
create policy invitations_all_member on public.invitations for all using (
  workspace_id is null or public.is_workspace_member(workspace_id)
) with check (
  workspace_id is null or public.is_workspace_member(workspace_id)
);

do $$
begin
  insert into storage.buckets (id, name)
  values
    ('assets', 'assets'),
    ('thumbnails', 'thumbnails'),
    ('avatars', 'avatars'),
    ('workspaces', 'workspaces')
  on conflict (id) do update set name = excluded.name;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'storage'
      and table_name = 'buckets'
      and column_name = 'public'
  ) then
    execute $bucket_sql$
      update storage.buckets
      set public = (id in ('thumbnails', 'avatars', 'workspaces'))
      where id in ('assets', 'thumbnails', 'avatars', 'workspaces')
    $bucket_sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'storage'
      and table_name = 'buckets'
      and column_name = 'file_size_limit'
  ) then
    execute $bucket_sql$
      update storage.buckets
      set file_size_limit = case id
        when 'assets' then 2147483648
        else 10485760
      end
      where id in ('assets', 'thumbnails', 'avatars', 'workspaces')
    $bucket_sql$;
  end if;
end $$;

create policy storage_assets_select_member on storage.objects for select using (
  bucket_id = 'assets'
  and public.is_workspace_member(((storage.foldername(name))[1])::uuid)
);

create policy storage_assets_insert_member on storage.objects for insert with check (
  bucket_id = 'assets'
  and public.is_workspace_member(((storage.foldername(name))[1])::uuid)
);

create policy storage_assets_update_member on storage.objects for update using (
  bucket_id = 'assets'
  and public.is_workspace_member(((storage.foldername(name))[1])::uuid)
);

create policy storage_thumbnails_select_public on storage.objects for select using (bucket_id = 'thumbnails');
create policy storage_avatars_select_public on storage.objects for select using (bucket_id = 'avatars');
create policy storage_workspaces_select_public on storage.objects for select using (bucket_id = 'workspaces');

create policy storage_thumbnails_insert_member on storage.objects for insert with check (
  bucket_id = 'thumbnails'
  and public.is_workspace_member(((storage.foldername(name))[1])::uuid)
);

create policy storage_avatars_insert_auth on storage.objects for insert with check (
  bucket_id = 'avatars' and auth.uid() is not null
);

create policy storage_workspaces_insert_auth on storage.objects for insert with check (
  bucket_id = 'workspaces' and auth.uid() is not null
);

create policy storage_avatars_update_auth on storage.objects for update using (
  bucket_id = 'avatars' and auth.uid() is not null
);

create policy storage_workspaces_update_auth on storage.objects for update using (
  bucket_id = 'workspaces' and auth.uid() is not null
);
