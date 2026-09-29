-- Project sharing, part 1 of 2: allow share links whose subject is a project.
-- Kept in its own migration because Postgres can't use a newly added enum value
-- in the same transaction that adds it (part 2's check constraint uses it).
-- Fresh installs already get this value from 20260527000000_init.sql; this is a no-op there.
alter type public.share_subject_type add value if not exists 'project';
