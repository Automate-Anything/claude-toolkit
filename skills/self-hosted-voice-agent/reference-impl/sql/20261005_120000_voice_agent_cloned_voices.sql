-- Cloned voices for the self-hosted phone agent ("create your own voice").
-- A company records/uploads a sample, we POST it to Cartesia /voices/clone, and
-- store the returned Cartesia voice id here so it joins the merchant's pickable
-- voice list. Company-scoped, location-nullable (a clone belongs to the company;
-- a location can select it). Tier 2 ADD: no such table exists (verified live).
--
-- Consent: `consent_text` + `consent_at` capture the explicit authorization the
-- UI collects before cloning (even though Cartesia does not force it).

CREATE TABLE IF NOT EXISTS public.voice_agent_cloned_voices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  location_id    uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  cartesia_voice_id text NOT NULL,
  name           text NOT NULL,
  gender         text NOT NULL DEFAULT 'female' CHECK (gender IN ('male','female')),
  language       text NOT NULL DEFAULT 'en',
  created_by     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  consent_text   text,
  consent_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS voice_agent_cloned_voices_company_idx
  ON public.voice_agent_cloned_voices (company_id);

-- Grants (layer 1 of the two-layer model) then RLS (layer 2).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.voice_agent_cloned_voices TO authenticated;

ALTER TABLE public.voice_agent_cloned_voices ENABLE ROW LEVEL SECURITY;

-- SELECT: blocked check FIRST, then same-company.
CREATE POLICY voice_agent_cloned_voices_select ON public.voice_agent_cloned_voices
  FOR SELECT TO authenticated
  USING (
    NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.is_blocked = true)
    AND company_id = public.get_my_company_id()
  );

-- INSERT: same-company only (blocked check first).
CREATE POLICY voice_agent_cloned_voices_insert ON public.voice_agent_cloned_voices
  FOR INSERT TO authenticated
  WITH CHECK (
    NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.is_blocked = true)
    AND company_id = public.get_my_company_id()
  );

-- UPDATE: same-company both sides.
CREATE POLICY voice_agent_cloned_voices_update ON public.voice_agent_cloned_voices
  FOR UPDATE TO authenticated
  USING (
    NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.is_blocked = true)
    AND company_id = public.get_my_company_id()
  )
  WITH CHECK (company_id = public.get_my_company_id());

-- DELETE: same-company.
CREATE POLICY voice_agent_cloned_voices_delete ON public.voice_agent_cloned_voices
  FOR DELETE TO authenticated
  USING (
    NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.is_blocked = true)
    AND company_id = public.get_my_company_id()
  );
