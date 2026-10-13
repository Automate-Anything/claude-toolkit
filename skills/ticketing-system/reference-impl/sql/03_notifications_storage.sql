-- =====================================================================
-- 0260 — Ticketing: notifications, dev-email routing, comments, storage.
-- ---------------------------------------------------------------------
-- Wires the side effects the 0259 RPCs call (ticket_notify_assignment /
-- ticket_notify_status / add_ticket_comment), extends the direct-notification
-- allowlist so ticket events are LOUD (toast + web-push), and provisions the
-- private `tickets` storage bucket (1 GiB/file).
--
-- Email model (spec §A.4): a login recipient gets an in-app notifications row
-- (loud); PLUS, when the recipient is a DEV (email ∈ ticket_config.dev_emails),
-- a direct notification_outbox email is ALWAYS enqueued to the configured
-- dev_notify_email (effi@automateanything.ai) — the guaranteed channel, prefs
-- notwithstanding. A non-dev (Client staffer hand-back) gets an outbox email to
-- their own address, gated by their comment/assignment alert preference.
--
-- Idempotent (create or replace / if not exists / on conflict). See §A.4/§A.5.
-- =====================================================================

-- ── Direct-notification allowlist: add ticket types (loud bell + push) ──
-- Reproduces the 0190 list verbatim + the three ticket types.
create or replace function is_direct_notification_type(p_type text)
returns boolean language sql immutable set search_path = public as $$
  select p_type = any (array[
    'comment_mention',
    'task_assigned',
    'field_assignment',
    'service_owner',
    'review_assigned',
    'sign_request',
    'document_shared_direct',
    'ticket_assigned',        -- a ticket assigned to you (support model)
    'ticket_reopened',        -- your resolved ticket was reopened / sent back
    'ticket_comment'          -- a comment on a ticket you're on
  ]::text[]);
$$;
revoke execute on function is_direct_notification_type(text) from public;
grant  execute on function is_direct_notification_type(text) to authenticated, service_role;

-- ── Email-routing helpers ────────────────────────────────────────────
-- Is this profile one of the dev-team logins?
create or replace function ticket_is_dev(p_profile uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles pr, ticket_config cfg
     where pr.id = p_profile
       and lower(pr.email) = any (select lower(e) from unnest(cfg.dev_emails) e));
$$;
revoke execute on function ticket_is_dev(uuid) from public, anon;
grant  execute on function ticket_is_dev(uuid) to authenticated, service_role;

-- The address to email for a given profile: the shared dev inbox for a dev,
-- else the profile's own email.
create or replace function ticket_email_for(p_profile uuid)
returns text language sql stable security definer set search_path = public as $$
  select case when ticket_is_dev(p_profile)
              then (select dev_notify_email from ticket_config where id)
              else (select email from profiles where id = p_profile) end;
$$;
revoke execute on function ticket_email_for(uuid) from public, anon;
grant  execute on function ticket_email_for(uuid) to authenticated, service_role;

-- ── ticket_notify_assignment(ticket, assignee, actor) ────────────────
create or replace function ticket_notify_assignment(p_ticket bigint, p_assignee uuid, p_actor uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  t tickets%rowtype;
  v_link  text;
  v_title text;
  v_body  text;
  v_dev   boolean;
  v_to    text;
  v_send  boolean;
begin
  if p_assignee is null or p_assignee = p_actor then return; end if;  -- no self-notify
  select * into t from tickets where id = p_ticket;
  if not found then return; end if;

  v_link  := '/tickets/' || p_ticket;
  v_title := 'Ticket ' || t.number || ' assigned to you';
  v_body  := t.title;
  v_dev   := ticket_is_dev(p_assignee);
  v_to    := ticket_email_for(p_assignee);

  -- In-app (loud) — assignee always has a login (they're a profile).
  insert into notifications(recipient_id, type, title, body, link,
                            entity_type, entity_id, trigger_key)
  values (p_assignee, 'ticket_assigned', v_title, v_body, v_link,
          'ticket', p_ticket, 'ticket_assigned');

  -- Email: devs always (guaranteed inbox); staffers per their preference.
  v_send := v_dev or app_alert_enabled(p_assignee, 'ticket_assigned');
  if v_send and nullif(btrim(coalesce(v_to,'')),'') is not null then
    insert into notification_outbox(recipient_profile_id, channel, payload)
    values (case when v_dev then null else p_assignee end, 'email', jsonb_build_object(
      'to', v_to, 'trigger_key', 'ticket_assigned:' || p_ticket,
      'title', v_title, 'body', v_body, 'link', v_link));
  end if;
end $$;
revoke execute on function ticket_notify_assignment(bigint, uuid, uuid) from public, anon;
grant  execute on function ticket_notify_assignment(bigint, uuid, uuid) to authenticated, service_role;

-- ── ticket_notify_status(ticket, from, to, actor) — reopen only ──────
create or replace function ticket_notify_status(
  p_ticket bigint, p_from ticket_status, p_to ticket_status, p_actor uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  t tickets%rowtype;
  v_link text; v_title text; v_body text; v_to text; v_dev boolean; v_send boolean;
begin
  -- Only "sent back to the assignee": in_review/done → in_progress.
  if not (p_from in ('in_review','done') and p_to = 'in_progress') then return; end if;
  select * into t from tickets where id = p_ticket;
  if not found or t.assignee_id is null or t.assignee_id = p_actor then return; end if;

  v_link  := '/tickets/' || p_ticket;
  v_title := 'Ticket ' || t.number || ' was reopened';
  v_body  := t.title;
  v_dev   := ticket_is_dev(t.assignee_id);
  v_to    := ticket_email_for(t.assignee_id);

  insert into notifications(recipient_id, type, title, body, link,
                            entity_type, entity_id, trigger_key)
  values (t.assignee_id, 'ticket_reopened', v_title, v_body, v_link,
          'ticket', p_ticket, 'ticket_reopened');

  v_send := v_dev or app_alert_enabled(t.assignee_id, 'ticket_assigned');
  if v_send and nullif(btrim(coalesce(v_to,'')),'') is not null then
    insert into notification_outbox(recipient_profile_id, channel, payload)
    values (case when v_dev then null else t.assignee_id end, 'email', jsonb_build_object(
      'to', v_to, 'trigger_key', 'ticket_reopened:' || p_ticket,
      'title', v_title, 'body', v_body, 'link', v_link));
  end if;
end $$;
revoke execute on function ticket_notify_status(bigint, ticket_status, ticket_status, uuid) from public, anon;
grant  execute on function ticket_notify_status(bigint, ticket_status, ticket_status, uuid) to authenticated, service_role;

-- ── add_ticket_comment(ticket, body) → comment jsonb ─────────────────
-- Isolated from the shared add_record_comment (which hard-restricts to
-- proposal|project). Same @mention semantics; adds ticket watchers + a comment
-- notification to the assignee, with dev-email routing.
create or replace function add_ticket_comment(p_id bigint, p_body text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  t      tickets%rowtype;
  v_body text := btrim(p_body);
  v_link text;
  v_c    comments%rowtype;
  m      record;
  v_to   text; v_dev boolean;
begin
  if v_uid is null then raise exception 'not authorized' using errcode = '42501'; end if;
  if app_role() = 'contractor' then raise exception 'not authorized' using errcode = '42501'; end if;
  if nullif(v_body,'') is null then raise exception 'comment body is required' using errcode = '23502'; end if;
  select * into t from tickets where id = p_id and deleted_at is null;
  if not found then raise exception 'ticket % not found', p_id using errcode = 'P0002'; end if;

  v_link := '/tickets/' || p_id;
  insert into comments(entity_type, entity_id, author_id, body)
  values ('ticket', p_id, v_uid, v_body) returning * into v_c;

  -- commenter watches the ticket
  insert into ticket_watchers(ticket_id, profile_id) values (p_id, v_uid) on conflict do nothing;

  -- @mentions: record, watch, notify (loud) + email (dev-routed)
  for m in
    select distinct pr.id as profile_id
    from regexp_matches(v_body, '@([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})', 'g') as g(parts)
    join profiles pr on lower(pr.email) = lower(g.parts[1])
    where pr.is_active and pr.id <> v_uid
  loop
    insert into comment_mentions(comment_id, mentioned_profile_id)
      values (v_c.id, m.profile_id) on conflict do nothing;
    insert into ticket_watchers(ticket_id, profile_id) values (p_id, m.profile_id) on conflict do nothing;

    if app_alert_enabled(m.profile_id, 'comment_mention') then
      insert into notifications(recipient_id, type, title, body, link,
                                entity_type, entity_id, trigger_key)
      values (m.profile_id, 'comment_mention',
              'You were mentioned on ticket ' || t.number, v_body, v_link,
              'ticket', p_id, 'comment_mention');
    end if;
    v_dev := ticket_is_dev(m.profile_id);
    v_to  := ticket_email_for(m.profile_id);
    if (v_dev or app_alert_enabled(m.profile_id, 'comment_mention'))
       and nullif(btrim(coalesce(v_to,'')),'') is not null then
      insert into notification_outbox(recipient_profile_id, channel, payload)
      values (case when v_dev then null else m.profile_id end, 'email', jsonb_build_object(
        'to', v_to, 'trigger_key', 'ticket_mention:' || p_id || ':' || v_c.id,
        'title', 'You were mentioned on ticket ' || t.number,
        'body', v_body, 'link', v_link));
    end if;
  end loop;

  -- notify the assignee of a new comment (if not the author and not just mentioned)
  if t.assignee_id is not null and t.assignee_id <> v_uid
     and not exists (select 1 from comment_mentions cm
                      where cm.comment_id = v_c.id and cm.mentioned_profile_id = t.assignee_id) then
    insert into notifications(recipient_id, type, title, body, link,
                              entity_type, entity_id, trigger_key)
    values (t.assignee_id, 'ticket_comment',
            'New comment on ticket ' || t.number, v_body, v_link,
            'ticket', p_id, 'ticket_comment');
    v_dev := ticket_is_dev(t.assignee_id);
    v_to  := ticket_email_for(t.assignee_id);
    if (v_dev or app_alert_enabled(t.assignee_id, 'comment_mention'))
       and nullif(btrim(coalesce(v_to,'')),'') is not null then
      insert into notification_outbox(recipient_profile_id, channel, payload)
      values (case when v_dev then null else t.assignee_id end, 'email', jsonb_build_object(
        'to', v_to, 'trigger_key', 'ticket_comment:' || p_id || ':' || v_c.id,
        'title', 'New comment on ticket ' || t.number,
        'body', v_body, 'link', v_link));
    end if;
  end if;

  return jsonb_build_object('id', v_c.id, 'body', v_c.body,
                            'author_id', v_c.author_id, 'created_at', v_c.created_at);
end $$;
revoke execute on function add_ticket_comment(bigint, text) from public, anon;
grant  execute on function add_ticket_comment(bigint, text) to authenticated;

-- ── config setter (admin/ops) ────────────────────────────────────────
create or replace function set_ticket_notify_email(p_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if app_role() not in ('admin','ops') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if nullif(btrim(p_email),'') is null then
    raise exception 'email is required' using errcode = '23502';
  end if;
  update ticket_config set dev_notify_email = btrim(p_email) where id;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function set_ticket_notify_email(text) from public, anon;
grant  execute on function set_ticket_notify_email(text) to authenticated;

-- ── Storage: private `tickets` bucket, 1 GiB/file ────────────────────
insert into storage.buckets (id, name, public) values ('tickets','tickets', false)
  on conflict (id) do nothing;
update storage.buckets
   set file_size_limit = 1073741824,      -- 1 GiB (extension denylist enforced app-side)
       allowed_mime_types = null
 where id = 'tickets';

-- Path convention: 'tickets/<ticketId>/<ts>-<name>'. Read to non-contractors when
-- the ticket exists; writes to app writers (non-contractor). Mirrors 0057.
drop policy if exists tickets_storage_read on storage.objects;
create policy tickets_storage_read on storage.objects for select to authenticated
  using (
    bucket_id = 'tickets'
    and app_role() <> 'contractor'
    and split_part(name, '/', 1) = 'tickets'
    and exists (select 1 from tickets t
                 where t.id = nullif(split_part(name, '/', 2), '')::bigint and t.deleted_at is null)
  );
drop policy if exists tickets_storage_insert on storage.objects;
create policy tickets_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'tickets' and app_can_write() and app_role() <> 'contractor');
drop policy if exists tickets_storage_update on storage.objects;
create policy tickets_storage_update on storage.objects for update to authenticated
  using (bucket_id = 'tickets' and app_can_write() and app_role() <> 'contractor')
  with check (bucket_id = 'tickets' and app_can_write() and app_role() <> 'contractor');
drop policy if exists tickets_storage_delete on storage.objects;
create policy tickets_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'tickets' and app_can_write() and app_role() <> 'contractor');
