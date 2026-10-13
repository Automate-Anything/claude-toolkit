-- =====================================================================
-- 0259 — Ticketing module: RPCs (CRUD, status, assign, list, detail, labels,
--        watchers) + event logging.
-- ---------------------------------------------------------------------
-- All functions SECURITY DEFINER, guard→body→grant. Writes require app_can_write()
-- AND a non-contractor role. Notification/email side effects (ticket_notify_*)
-- and the ticket comment path live in 0260 and are called by runtime; PL/pgSQL
-- late-binds those calls, so creation order (0259 before 0260) is fine.
-- Idempotent (create or replace). See spec §A.2/§A.3.
-- =====================================================================

-- ── Write guard ──────────────────────────────────────────────────────
create or replace function ticket_guard_write() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (coalesce(app_can_write(), false) and app_role() <> 'contractor') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
end $$;
revoke execute on function ticket_guard_write() from public, anon;
grant  execute on function ticket_guard_write() to authenticated;

-- ── Legal status transitions (single source of truth; mirrored in status.ts) ──
create or replace function ticket_transition_ok(p_from ticket_status, p_to ticket_status)
returns boolean language sql immutable set search_path = public as $$
  select case p_from
    when 'new'                then p_to in ('triaged','in_progress','blocked','wont_do')
    when 'triaged'            then p_to in ('in_progress','needs_client_input','blocked','wont_do')
    when 'in_progress'        then p_to in ('in_review','needs_client_input','blocked','wont_do')
    when 'in_review'          then p_to in ('done','in_progress')
    when 'needs_client_input' then p_to in ('in_progress','triaged')
    when 'blocked'            then p_to in ('in_progress','triaged','wont_do')
    when 'done'               then p_to in ('in_progress')
    when 'wont_do'            then p_to in ('in_progress')
    else false
  end;
$$;

-- ── TKT-##### (global; next_number's year-0 counter, else-branch → plain int) ──
create or replace function ticket_next_number() returns text
language plpgsql security definer set search_path = public as $$
declare v text;
begin
  v := next_number('ticket', 0);          -- returns the raw integer as text
  return 'TKT-' || lpad(v, 5, '0');
end $$;
revoke execute on function ticket_next_number() from public, anon;
grant  execute on function ticket_next_number() to authenticated;

-- ── create_ticket(p jsonb) → {ok,id,number} ──────────────────────────
-- p: {title, body?, type?, priority?, assignee_id?, linked_entity_type?,
--     linked_entity_id?, due_date?, label_ids?[]}
create or replace function create_ticket(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_id  bigint;
  v_num text;
  v_assignee uuid := nullif(p->>'assignee_id','')::uuid;
  v_ltype text := nullif(p->>'linked_entity_type','');
  v_lid   bigint := nullif(p->>'linked_entity_id','')::bigint;
  v_label bigint;
begin
  perform ticket_guard_write();
  if nullif(btrim(p->>'title'),'') is null then
    raise exception 'title is required' using errcode = '23502';
  end if;

  v_num := ticket_next_number();
  insert into tickets(number, title, body, type, priority, status, reporter_id,
                      assignee_id, linked_entity_type, linked_entity_id, due_date)
  values (v_num, btrim(p->>'title'), coalesce(p->>'body',''),
          coalesce(nullif(p->>'type','')::ticket_type,'bug'),
          coalesce(nullif(p->>'priority','')::ticket_priority,'medium'),
          'new', v_uid, v_assignee, v_ltype, v_lid,
          nullif(p->>'due_date','')::date)
  returning id into v_id;

  -- labels
  if p ? 'label_ids' then
    for v_label in select x::bigint from jsonb_array_elements_text(p->'label_ids') as x loop
      insert into ticket_label_links(ticket_id, label_id) values (v_id, v_label)
      on conflict do nothing;
    end loop;
  end if;

  -- watchers: reporter + assignee
  insert into ticket_watchers(ticket_id, profile_id) values (v_id, v_uid)
    on conflict do nothing;
  if v_assignee is not null then
    insert into ticket_watchers(ticket_id, profile_id) values (v_id, v_assignee)
      on conflict do nothing;
  end if;

  insert into ticket_events(ticket_id, actor_id, kind, to_value)
    values (v_id, v_uid, 'created', v_num);

  if v_assignee is not null then
    perform ticket_notify_assignment(v_id, v_assignee, v_uid);
  end if;

  return jsonb_build_object('ok', true, 'id', v_id, 'number', v_num);
end $$;
revoke execute on function create_ticket(jsonb) from public, anon;
grant  execute on function create_ticket(jsonb) to authenticated;

-- ── update_ticket(p_id, p jsonb) → {ok:true} ─────────────────────────
-- Editable: title, body, type, priority, linked_entity_*, due_date, label_ids.
-- (Status → set_ticket_status; assignee → assign_ticket.)
create or replace function update_ticket(p_id bigint, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_old tickets%rowtype;
  v_label bigint;
begin
  perform ticket_guard_write();
  select * into v_old from tickets where id = p_id and deleted_at is null;
  if not found then raise exception 'ticket % not found', p_id using errcode = 'P0002'; end if;

  update tickets set
    title    = coalesce(nullif(btrim(p->>'title'),''), title),
    body     = coalesce(p->>'body', body),
    type     = coalesce(nullif(p->>'type','')::ticket_type, type),
    priority = coalesce(nullif(p->>'priority','')::ticket_priority, priority),
    linked_entity_type = case when p ? 'linked_entity_type'
                              then nullif(p->>'linked_entity_type','') else linked_entity_type end,
    linked_entity_id   = case when p ? 'linked_entity_id'
                              then nullif(p->>'linked_entity_id','')::bigint else linked_entity_id end,
    due_date = case when p ? 'due_date' then nullif(p->>'due_date','')::date else due_date end,
    updated_at = now()
  where id = p_id;

  if p ? 'priority' and nullif(p->>'priority','')::ticket_priority is distinct from v_old.priority then
    insert into ticket_events(ticket_id, actor_id, kind, from_value, to_value)
      values (p_id, v_uid, 'priority', v_old.priority::text, p->>'priority');
  end if;
  if p ? 'linked_entity_type' then
    insert into ticket_events(ticket_id, actor_id, kind, from_value, to_value)
      values (p_id, v_uid, 'link', v_old.linked_entity_type, nullif(p->>'linked_entity_type',''));
  end if;

  -- replace label set when provided
  if p ? 'label_ids' then
    delete from ticket_label_links where ticket_id = p_id;
    for v_label in select x::bigint from jsonb_array_elements_text(p->'label_ids') as x loop
      insert into ticket_label_links(ticket_id, label_id) values (p_id, v_label)
        on conflict do nothing;
    end loop;
  end if;

  return jsonb_build_object('ok', true);
end $$;
revoke execute on function update_ticket(bigint, jsonb) from public, anon;
grant  execute on function update_ticket(bigint, jsonb) to authenticated;

-- ── set_ticket_status(p_id, p_status, p_note?) → {ok:true,status} ────
create or replace function set_ticket_status(p_id bigint, p_status ticket_status, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_old tickets%rowtype;
  v_reopen boolean;
begin
  perform ticket_guard_write();
  select * into v_old from tickets where id = p_id and deleted_at is null;
  if not found then raise exception 'ticket % not found', p_id using errcode = 'P0002'; end if;

  if v_old.status = p_status then
    return jsonb_build_object('ok', true, 'status', p_status);   -- no-op
  end if;
  if not ticket_transition_ok(v_old.status, p_status) then
    raise exception 'cannot move a ticket from % to %', v_old.status, p_status using errcode = 'P0001';
  end if;

  v_reopen := v_old.status in ('in_review','done') and p_status = 'in_progress';

  update tickets set
    status = p_status,
    resolved_at = case when p_status in ('done','wont_do') then now()
                       when p_status = 'in_progress' then null
                       else resolved_at end,
    updated_at = now()
  where id = p_id;

  insert into ticket_events(ticket_id, actor_id, kind, from_value, to_value)
    values (p_id, v_uid, case when v_reopen then 'reopened' else 'status' end,
            v_old.status::text, p_status::text);

  if nullif(btrim(coalesce(p_note,'')),'') is not null then
    perform add_ticket_comment(p_id, p_note);
  end if;

  perform ticket_notify_status(p_id, v_old.status, p_status, v_uid);
  return jsonb_build_object('ok', true, 'status', p_status);
end $$;
revoke execute on function set_ticket_status(bigint, ticket_status, text) from public, anon;
grant  execute on function set_ticket_status(bigint, ticket_status, text) to authenticated;

-- ── assign_ticket(p_id, p_assignee) → {ok:true} ─────────────────────
create or replace function assign_ticket(p_id bigint, p_assignee uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_old tickets%rowtype;
begin
  perform ticket_guard_write();
  select * into v_old from tickets where id = p_id and deleted_at is null;
  if not found then raise exception 'ticket % not found', p_id using errcode = 'P0002'; end if;
  if v_old.assignee_id is not distinct from p_assignee then
    return jsonb_build_object('ok', true);   -- no-op
  end if;
  if p_assignee is not null and not exists (select 1 from profiles where id = p_assignee) then
    raise exception 'assignee not found' using errcode = 'P0002';
  end if;

  update tickets set assignee_id = p_assignee, updated_at = now() where id = p_id;

  if p_assignee is not null then
    insert into ticket_watchers(ticket_id, profile_id) values (p_id, p_assignee)
      on conflict do nothing;
  end if;

  -- Store display NAMES (not UUIDs) so the timeline reads "assigned to Alex".
  insert into ticket_events(ticket_id, actor_id, kind, from_value, to_value)
    values (p_id, v_uid, 'assignee',
            (select full_name from profiles where id = v_old.assignee_id),
            (select full_name from profiles where id = p_assignee));

  if p_assignee is not null then
    perform ticket_notify_assignment(p_id, p_assignee, v_uid);
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function assign_ticket(bigint, uuid) from public, anon;
grant  execute on function assign_ticket(bigint, uuid) to authenticated;

-- ── get_tickets(p jsonb) → {items:[...], counts:{status:n}} ──────────
-- filters (all optional): status[], priority[], type[], assignee_id, label_id,
--   linked_entity_type, mine(bool), q(text)
create or replace function get_tickets(p jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_status   text[] := case when p ? 'status'   then array(select jsonb_array_elements_text(p->'status'))   else null end;
  v_priority text[] := case when p ? 'priority' then array(select jsonb_array_elements_text(p->'priority')) else null end;
  v_type     text[] := case when p ? 'type'     then array(select jsonb_array_elements_text(p->'type'))     else null end;
  v_assignee uuid   := nullif(p->>'assignee_id','')::uuid;
  v_label    bigint := nullif(p->>'label_id','')::bigint;
  v_ltype    text   := nullif(p->>'linked_entity_type','');
  v_mine     boolean:= coalesce((p->>'mine')::boolean, false);
  v_q        text   := nullif(btrim(p->>'q'),'');
  v_uid      uuid   := auth.uid();
  v_items    jsonb;
  v_counts   jsonb;
begin
  if app_role() = 'contractor' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- shared predicate (everything except the status filter) via a CTE
  with base as (
    select t.*
    from tickets t
    where t.deleted_at is null
      and (v_priority is null or t.priority::text = any(v_priority))
      and (v_type     is null or t.type::text     = any(v_type))
      and (v_assignee is null or t.assignee_id = v_assignee)
      and (v_ltype    is null or t.linked_entity_type = v_ltype)
      and (not v_mine or t.reporter_id = v_uid or t.assignee_id = v_uid)
      and (v_q is null or t.title ilike '%'||v_q||'%' or t.number ilike '%'||v_q||'%'
                       or t.body ilike '%'||v_q||'%')
      and (v_label is null or exists (
             select 1 from ticket_label_links ll where ll.ticket_id = t.id and ll.label_id = v_label))
  )
  select
    coalesce((
      select jsonb_agg(row_to_json(x)::jsonb order by x.updated_at desc)
      from (
        select b.id, b.number, b.title, b.type, b.priority, b.status,
               b.assignee_id, ap.full_name as assignee_name,
               b.reporter_id, rp.full_name as reporter_name,
               b.linked_entity_type, b.linked_entity_id, b.due_date, b.updated_at,
               (select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'name',l.name,'color',l.color)
                                          order by l.name), '[]'::jsonb)
                  from ticket_label_links ll join ticket_labels l
                    on l.id = ll.label_id and l.deleted_at is null
                 where ll.ticket_id = b.id) as labels,
               (select count(*) from attachments a
                 where a.entity_type = 'ticket' and a.entity_id = b.id) as attachment_count,
               (select count(*) from comments c
                 where c.entity_type = 'ticket' and c.entity_id = b.id) as comment_count
        from base b
        left join profiles ap on ap.id = b.assignee_id
        left join profiles rp on rp.id = b.reporter_id
        where (v_status is null or b.status::text = any(v_status))
      ) x
    ), '[]'::jsonb),
    coalesce((
      select jsonb_object_agg(status, n)
      from (select status::text as status, count(*) as n from base group by status) s
    ), '{}'::jsonb)
  into v_items, v_counts;

  return jsonb_build_object('items', v_items, 'counts', v_counts);
end $$;
revoke execute on function get_tickets(jsonb) from public, anon;
grant  execute on function get_tickets(jsonb) to authenticated;

-- ── get_ticket_detail(p_id) → full ticket + relations ────────────────
create or replace function get_ticket_detail(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if app_role() = 'contractor' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'id', t.id, 'number', t.number, 'title', t.title, 'body', t.body,
    'type', t.type, 'priority', t.priority, 'status', t.status,
    'reporter_id', t.reporter_id, 'reporter_name', rp.full_name,
    'assignee_id', t.assignee_id, 'assignee_name', ap.full_name,
    'linked_entity_type', t.linked_entity_type, 'linked_entity_id', t.linked_entity_id,
    'due_date', t.due_date, 'created_at', t.created_at, 'updated_at', t.updated_at,
    'resolved_at', t.resolved_at,
    'labels', (select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'name',l.name,'color',l.color)
                                         order by l.name), '[]'::jsonb)
                 from ticket_label_links ll join ticket_labels l
                   on l.id = ll.label_id and l.deleted_at is null
                where ll.ticket_id = t.id),
    'watchers', (select coalesce(jsonb_agg(jsonb_build_object('profile_id',w.profile_id,
                                                              'full_name',wp.full_name)), '[]'::jsonb)
                   from ticket_watchers w join profiles wp on wp.id = w.profile_id
                  where w.ticket_id = t.id),
    'attachments', (select coalesce(jsonb_agg(jsonb_build_object(
                            'id',a.id,'file_path',a.file_path,'file_name',a.file_name,
                            'content_type',a.content_type,'byte_size',a.byte_size,
                            'created_at',a.created_at) order by a.created_at), '[]'::jsonb)
                      from attachments a
                     where a.entity_type = 'ticket' and a.entity_id = t.id),
    'comments', (select coalesce(jsonb_agg(jsonb_build_object(
                          'id',c.id,'body',c.body,'author_id',c.author_id,
                          'author_name',cp.full_name,'created_at',c.created_at)
                          order by c.created_at), '[]'::jsonb)
                   from comments c left join profiles cp on cp.id = c.author_id
                  where c.entity_type = 'ticket' and c.entity_id = t.id),
    'events', (select coalesce(jsonb_agg(jsonb_build_object(
                        'id',e.id,'kind',e.kind,'from_value',e.from_value,'to_value',e.to_value,
                        'actor_id',e.actor_id,'actor_name',ep.full_name,'created_at',e.created_at)
                        order by e.created_at), '[]'::jsonb)
                 from ticket_events e left join profiles ep on ep.id = e.actor_id
                where e.ticket_id = t.id)
  )
  into v
  from tickets t
  left join profiles rp on rp.id = t.reporter_id
  left join profiles ap on ap.id = t.assignee_id
  where t.id = p_id and t.deleted_at is null;

  if v is null then raise exception 'ticket % not found', p_id using errcode = 'P0002'; end if;
  return v;
end $$;
revoke execute on function get_ticket_detail(bigint) from public, anon;
grant  execute on function get_ticket_detail(bigint) to authenticated;

-- ── labels ───────────────────────────────────────────────────────────
create or replace function list_ticket_labels()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'color',color) order by name), '[]'::jsonb)
  from ticket_labels where deleted_at is null;
$$;
revoke execute on function list_ticket_labels() from public, anon;
grant  execute on function list_ticket_labels() to authenticated;

create or replace function upsert_ticket_label(p_id bigint, p_name text, p_color text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  perform ticket_guard_write();
  if nullif(btrim(p_name),'') is null then
    raise exception 'label name is required' using errcode = '23502';
  end if;
  if p_id is null then
    insert into ticket_labels(name, color) values (btrim(p_name), coalesce(nullif(p_color,''),'emerald'))
    returning id into v_id;
  else
    update ticket_labels set name = btrim(p_name), color = coalesce(nullif(p_color,''),color)
     where id = p_id returning id into v_id;
    if v_id is null then raise exception 'label % not found', p_id using errcode = 'P0002'; end if;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke execute on function upsert_ticket_label(bigint, text, text) from public, anon;
grant  execute on function upsert_ticket_label(bigint, text, text) to authenticated;

-- ── watch / unwatch ──────────────────────────────────────────────────
create or replace function watch_ticket(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform ticket_guard_write();
  insert into ticket_watchers(ticket_id, profile_id) values (p_id, auth.uid())
    on conflict do nothing;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function watch_ticket(bigint) from public, anon;
grant  execute on function watch_ticket(bigint) to authenticated;

create or replace function unwatch_ticket(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform ticket_guard_write();
  delete from ticket_watchers where ticket_id = p_id and profile_id = auth.uid();
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function unwatch_ticket(bigint) from public, anon;
grant  execute on function unwatch_ticket(bigint) to authenticated;
