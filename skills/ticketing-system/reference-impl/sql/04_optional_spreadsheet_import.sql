-- =====================================================================
-- 0261 — Ticketing: optional one-shot importer for the legacy Google Sheet.
-- ---------------------------------------------------------------------
-- Seeds the ~28 rows from the old bug/task sheet as tickets so the board starts
-- with history, not empty. Idempotent by `import_key` (a stable hash of the
-- source task text) — re-running never duplicates. NOT run automatically; an
-- admin calls select import_sheet_tickets(<rows>) after review (see
-- scripts/ticketing/sheet-seed.json). Status/type/priority are pre-mapped in the
-- JSON payload; this RPC only inserts.
-- Forward-only + idempotent. See spec §A.8.
-- =====================================================================

alter table tickets add column if not exists import_key text;
create unique index if not exists tickets_import_key_uq on tickets(import_key)
  where import_key is not null;

-- p_rows: jsonb array of
--   {title, body?, type?, priority?, status?, import_key}
create or replace function import_sheet_tickets(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  r jsonb;
  v_num text;
  v_inserted int := 0;
  v_skipped  int := 0;
  v_key text;
begin
  if app_role() <> 'admin' then
    raise exception 'only an admin may import tickets' using errcode = '42501';
  end if;

  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_key := coalesce(nullif(r->>'import_key',''), md5(coalesce(r->>'title','')));
    if exists (select 1 from tickets where import_key = v_key) then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    if nullif(btrim(r->>'title'),'') is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_num := ticket_next_number();
    insert into tickets(number, title, body, type, priority, status, reporter_id, import_key,
                        resolved_at)
    values (
      v_num,
      btrim(r->>'title'),
      coalesce(r->>'body',''),
      coalesce(nullif(r->>'type','')::ticket_type, 'bug'),
      coalesce(nullif(r->>'priority','')::ticket_priority, 'medium'),
      coalesce(nullif(r->>'status','')::ticket_status, 'new'),
      v_uid,
      v_key,
      case when coalesce(nullif(r->>'status','')::ticket_status,'new') in ('done','wont_do')
           then now() else null end
    );
    v_inserted := v_inserted + 1;
  end loop;

  return jsonb_build_object('ok', true, 'inserted', v_inserted, 'skipped', v_skipped);
end $$;
revoke execute on function import_sheet_tickets(jsonb) from public, anon;
grant  execute on function import_sheet_tickets(jsonb) to authenticated;
