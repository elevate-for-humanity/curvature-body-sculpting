-- Apply only to Curvature's dedicated Supabase project, never Elevate LMS.
begin;
create table if not exists public.curvature_requests (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  kind text not null check (kind in ('contact','appointment','application','invoice')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  status text not null default 'pending' check (status in ('pending','reviewing','closed')),
  created_at timestamptz not null default now()
);
alter table public.curvature_requests enable row level security;
revoke all on public.curvature_requests from public, anon, authenticated;
grant select, insert, update on public.curvature_requests to service_role;
create index if not exists curvature_requests_queue on public.curvature_requests(status, created_at);
commit;
