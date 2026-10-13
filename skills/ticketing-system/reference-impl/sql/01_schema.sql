-- =====================================================================
-- 0258 — Ticketing module: schema (enums, tables, RLS, config).
-- ---------------------------------------------------------------------
-- Replaces the Google-Sheet bug/task tracker. Support model: Client staff
-- (admin/ops/consultant/inspector) FILE tickets; the dev team RESOLVES them.
-- Contractors are excluded everywhere. Numbered TKT-##### (global, no yearly
-- reset — like CUS-#####, via next_number('ticket', 0)).
--
-- This migration is pure schema. RPCs live in 0259; notifications/email/storage
-- in 0260; the optional sheet importer in 0261.
--
-- Forward-only + idempotent (create type guarded, if not exists, drop/create
-- policy). RLS ON for every table; writes flow through DEFINER RPCs (0259/0260),
-- so only *_read policies are permissive here.
-- See docs/superpowers/specs/2026-09-08-ticketing-system-design.md
-- =====================================================================

-- ── Enums ────────────────────────────────────────────────────────────
do $$ begin
  create type ticket_type as enum ('bug','feature_request','question','future_plan');
exception when duplicate_object then null; end $$;

do $$ begin
  create type ticket_priority as enum ('urgent','high','medium','low');
exception when duplicate_object then null; end $$;

do $$ begin
  create type ticket_status as enum
    ('new','triaged','in_progress','in_review','needs_client_input','blocked','done','wont_do');
exception when duplicate_object then null; end $$;

-- ── tickets ──────────────────────────────────────────────────────────
create table if not exists tickets (
  id                  bigint generated always as identity primary key,
  number              text not null unique,
  title               text not null,
  body                text not null default '',
  type                ticket_type     not null default 'bug',
  priority            ticket_priority not null default 'medium',
  status              ticket_status   not null default 'new',
  reporter_id         uuid not null references profiles(id),
  assignee_id         uuid references profiles(id),
  linked_entity_type  text check (linked_entity_type in ('project','proposal','customer','document')),
  linked_entity_id    bigint,
  due_date            date,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  resolved_at         timestamptz,
  deleted_at          timestamptz,
  -- linked_entity_type and _id are set together or both null.
  constraint tickets_link_pair_chk check (
    (linked_entity_type is null and linked_entity_id is null)
    or (linked_entity_type is not null and linked_entity_id is not null))
);
create index if not exists tickets_status_idx   on tickets(status)      where deleted_at is null;
create index if not exists tickets_assignee_idx on tickets(assignee_id) where deleted_at is null;
create index if not exists tickets_reporter_idx on tickets(reporter_id) where deleted_at is null;
create index if not exists tickets_link_idx     on tickets(linked_entity_type, linked_entity_id)
  where deleted_at is null;

-- ── labels (free-form, colored) ──────────────────────────────────────
create table if not exists ticket_labels (
  id         bigint generated always as identity primary key,
  name       text not null,
  color      text not null default 'emerald',   -- token key, mapped app-side (never raw hex)
  deleted_at timestamptz
);
create unique index if not exists ticket_labels_name_uq
  on ticket_labels(lower(name)) where deleted_at is null;

create table if not exists ticket_label_links (
  ticket_id bigint not null references tickets(id) on delete cascade,
  label_id  bigint not null references ticket_labels(id) on delete cascade,
  primary key (ticket_id, label_id)
);
create index if not exists ticket_label_links_label_idx on ticket_label_links(label_id);

-- ── watchers (notification recipients) ───────────────────────────────
create table if not exists ticket_watchers (
  ticket_id  bigint not null references tickets(id) on delete cascade,
  profile_id uuid   not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (ticket_id, profile_id)
);

-- ── events (audit timeline) ──────────────────────────────────────────
create table if not exists ticket_events (
  id         bigint generated always as identity primary key,
  ticket_id  bigint not null references tickets(id) on delete cascade,
  actor_id   uuid references profiles(id),
  kind       text not null,          -- created|status|reopened|assignee|priority|type|link
  from_value text,
  to_value   text,
  created_at timestamptz not null default now()
);
create index if not exists ticket_events_ticket_idx on ticket_events(ticket_id, created_at);

-- ── config (singleton) — the per-app knob the reusable skill parameterizes ──
create table if not exists ticket_config (
  id               boolean primary key default true check (id),   -- single row
  dev_notify_email text not null default 'effi@automateanything.ai',
  dev_emails       text[] not null default array[
    'effi6060@gmail.com','effie@automateanything.ai','effi@allautomateanything.com'
  ]::text[]
);
insert into ticket_config (id) values (true) on conflict (id) do nothing;

-- ── RLS ──────────────────────────────────────────────────────────────
alter table tickets            enable row level security;
alter table ticket_labels      enable row level security;
alter table ticket_label_links enable row level security;
alter table ticket_watchers    enable row level security;
alter table ticket_events      enable row level security;
alter table ticket_config      enable row level security;

-- tickets: readable by any non-contractor login; writes via DEFINER RPCs only.
drop policy if exists tickets_read on tickets;
create policy tickets_read on tickets for select to authenticated
  using (deleted_at is null and app_role() <> 'contractor');
drop policy if exists tickets_write on tickets;
create policy tickets_write on tickets for all to authenticated
  using (app_can_write() and app_role() <> 'contractor')
  with check (app_can_write() and app_role() <> 'contractor');

-- labels: read to non-contractors; writes via DEFINER RPCs only (upsert_ticket_label).
drop policy if exists ticket_labels_read on ticket_labels;
create policy ticket_labels_read on ticket_labels for select to authenticated
  using (deleted_at is null and app_role() <> 'contractor');

-- link/watcher/event tables: read to non-contractors; all writes via DEFINER RPCs.
drop policy if exists ticket_label_links_read on ticket_label_links;
create policy ticket_label_links_read on ticket_label_links for select to authenticated
  using (app_role() <> 'contractor');

drop policy if exists ticket_watchers_read on ticket_watchers;
create policy ticket_watchers_read on ticket_watchers for select to authenticated
  using (app_role() <> 'contractor');

drop policy if exists ticket_events_read on ticket_events;
create policy ticket_events_read on ticket_events for select to authenticated
  using (app_role() <> 'contractor');

-- config: readable by admin/ops (Settings surface); write via DEFINER only.
drop policy if exists ticket_config_read on ticket_config;
create policy ticket_config_read on ticket_config for select to authenticated
  using (app_role() in ('admin','ops'));
