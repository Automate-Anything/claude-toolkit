-- Evolution proxy pool: store per-proxy lease lifecycle so the superadmin pool view
-- can show when a lease expires and whether auto-renew is on, WITHOUT calling the
-- IPRoyal API on every page load. Populated by the evolutionProxyHeal cron's existing
-- bulk order sweep (it already fetches expire_date + auto_extend for every order) and
-- at buy time. Bright Data has no fixed lease / no auto-extend (billed until the zone
-- is deleted), so both stay NULL for BD rows.
--
-- Service-role-only table (RLS on, no grants/policies): merchants never touch it, so
-- no policy/grant/resource changes are needed. Additive, nullable columns only.
ALTER TABLE public.evolution_proxies
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_extend      boolean;

COMMENT ON COLUMN public.evolution_proxies.lease_expires_at IS
  'IPRoyal lease end: when the IP is deleted from IPRoyal if auto-renew is off. NULL for Bright Data (billed until the zone is deleted) or when unknown. Stamped by the evolutionProxyHeal cron + at buy time.';
COMMENT ON COLUMN public.evolution_proxies.auto_extend IS
  'IPRoyal auto-extend (renew) on? NULL = unknown / not applicable (Bright Data has no lease to renew). Stamped by the evolutionProxyHeal cron + at buy time.';
