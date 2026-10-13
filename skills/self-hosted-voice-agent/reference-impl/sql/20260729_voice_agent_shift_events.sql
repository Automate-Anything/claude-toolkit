-- Agent presence - shift-event ledger + transition RPC (Scope B2/B3).
--
-- voice_agent_shift_events records an agent's presence as SEGMENTS: one row per
-- online/paused span (offline = the absence of an open segment). ended_at IS
-- NULL = the segment is still open. This is the source of truth for the Agent
-- Activity report (online / idle / paused-by-reason time). Talk time comes from
-- call_segments (Scope C), NOT here.
--
-- Applied live 2026-07-29 to project <supabase-project> and verified.

CREATE TABLE IF NOT EXISTS public.voice_agent_shift_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  state text NOT NULL CHECK (state IN ('online','paused','offline')),
  pause_reason_id uuid REFERENCES public.voice_pause_reasons(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  source text NOT NULL DEFAULT 'softphone',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS voice_agent_shift_events_company_user_started_idx
  ON public.voice_agent_shift_events (company_id, user_id, started_at);
-- Fast lookup of a user's currently-open segment (close-before-open + sweeper).
CREATE INDEX IF NOT EXISTS voice_agent_shift_events_open_idx
  ON public.voice_agent_shift_events (user_id) WHERE ended_at IS NULL;

-- SELECT only for clients; all writes go through the SECDEF RPC below.
GRANT SELECT ON public.voice_agent_shift_events TO authenticated;
ALTER TABLE public.voice_agent_shift_events ENABLE ROW LEVEL SECURITY;

-- A user sees their own events; managers-and-up (privilege <= 3) and
-- owner/super_admin see the whole company (to pull reports).
CREATE POLICY voice_agent_shift_events_select ON public.voice_agent_shift_events
  FOR SELECT TO authenticated
  USING (
    NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.is_blocked = true)
    AND company_id = (SELECT get_my_company_id())
    AND (
      user_id = auth.uid()
      OR (SELECT is_owner_or_super_admin())
      OR public.role_privilege_level((SELECT get_my_role_id())) <= 3
    )
  );

-- Record a presence transition. Pattern B (client-callable): the caller records
-- their OWN shift only. Closes any open segment, then opens the new one. Pause
-- requires a company-owned reason. offline closes without opening a new segment.
CREATE OR REPLACE FUNCTION public.record_agent_shift_transition(
  p_company_id uuid,
  p_state text,
  p_location_id uuid DEFAULT NULL,
  p_pause_reason_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_new_id uuid;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE id = v_caller AND is_blocked = true) THEN
    RAISE EXCEPTION 'blocked';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_caller AND company_id = p_company_id) THEN
    RAISE EXCEPTION 'unauthorized: cross-tenant access attempt';
  END IF;
  IF p_state NOT IN ('online','paused','offline') THEN
    RAISE EXCEPTION 'invalid state: %', p_state;
  END IF;
  IF p_state = 'paused' THEN
    IF p_pause_reason_id IS NULL THEN
      RAISE EXCEPTION 'pause requires a reason';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.voice_pause_reasons
      WHERE id = p_pause_reason_id AND company_id = p_company_id
    ) THEN
      RAISE EXCEPTION 'invalid pause reason for this company';
    END IF;
  END IF;

  UPDATE public.voice_agent_shift_events
  SET ended_at = now(), updated_at = now()
  WHERE user_id = v_caller AND ended_at IS NULL;

  IF p_state = 'offline' THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.voice_agent_shift_events
    (company_id, user_id, location_id, state, pause_reason_id, started_at, source)
  VALUES
    (p_company_id, v_caller, p_location_id, p_state,
     CASE WHEN p_state = 'paused' THEN p_pause_reason_id ELSE NULL END,
     now(), 'softphone')
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.record_agent_shift_transition(uuid, text, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_agent_shift_transition(uuid, text, uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.record_agent_shift_transition(uuid, text, uuid, uuid) TO authenticated;
