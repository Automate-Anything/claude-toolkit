-- Self-hosted voice agent: allow ai_provider = 'pipecat' on voice_numbers.
--
-- Tier 3 (EDIT of an existing CHECK constraint). Live definition pulled
-- 2026-09-22 via pg_constraint:
--   voice_numbers_ai_provider_check
--   CHECK (((ai_provider IS NULL) OR (ai_provider = 'retell'::text)))
--
-- Why: docs/plans/SELF_HOSTED_VOICE_AGENT_PLATFORM_PLAN.md. A number's
-- ai_provider decides which AI brain answers it: 'retell' (SIP-forward to
-- Retell) or 'pipecat' (cXML media stream to our own Pipecat runtime, voice-rt).
-- Every reader of ai_provider was audited and generalized in the same change
-- set (app-server: enableRole.ts, callableFloor.ts, tenantLookup.ts,
-- phoneNumbers/routes.ts, inboundLaml.ts, routes/webhooks.ts, ivrWalker.ts;
-- src/: phoneNumbersApi.ts, Communications.tsx). RLS on voice_numbers is
-- untouched (the constraint is value-level only; no policy references it).
--
-- Rollback: the reverse ALTER below the main statement (commented). Safe to
-- run only when no row has ai_provider='pipecat'.
--
-- ⛔ Apply ONLY with the owner's explicit approval (DB gate, tier 3).

ALTER TABLE public.voice_numbers
  DROP CONSTRAINT IF EXISTS voice_numbers_ai_provider_check;

ALTER TABLE public.voice_numbers
  ADD CONSTRAINT voice_numbers_ai_provider_check
  CHECK (ai_provider IS NULL OR ai_provider IN ('retell', 'pipecat'));

-- Rollback (only when no pipecat rows exist):
-- ALTER TABLE public.voice_numbers DROP CONSTRAINT IF EXISTS voice_numbers_ai_provider_check;
-- ALTER TABLE public.voice_numbers ADD CONSTRAINT voice_numbers_ai_provider_check
--   CHECK (ai_provider IS NULL OR ai_provider = 'retell');
