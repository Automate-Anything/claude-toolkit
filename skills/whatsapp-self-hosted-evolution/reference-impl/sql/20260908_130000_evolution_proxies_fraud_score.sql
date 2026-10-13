-- Add a queryable numeric IPQS fraud score to the per-channel proxy pool.
-- Previously only stored as text inside `health` (e.g. "ipqs:94 proxy ..."); this
-- column makes the bad-IP RATE and thresholds queryable directly. NULL = unscreened
-- (IPQS not configured, or the lookup failed - screening fails open). Written
-- alongside `health` at every screen point (buy-time + claim-time).
--
-- evolution_proxies is service-role only (RLS enabled, no anon/authenticated grants),
-- so this new nullable column needs no policy or grant change and is never client-exposed.
ALTER TABLE public.evolution_proxies
  ADD COLUMN IF NOT EXISTS fraud_score integer;

COMMENT ON COLUMN public.evolution_proxies.fraud_score IS
  'Last IPQS fraud_score (0-100) recorded for this IP; NULL = unscreened. Mirrors the numeric part of health.';
