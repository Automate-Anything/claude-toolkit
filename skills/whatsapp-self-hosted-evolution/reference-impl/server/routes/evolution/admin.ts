/**
 * Super-admin endpoints for the Evolution rollout. Two jobs:
 *   1. View the per-channel PROXY POOL + yield stats (evolution_proxies).
 *   2. Pick which COMPANIES use Evolution for NEW WhatsApp channels
 *      (whatsapp_provider_overrides).
 *
 * Mounted under requireSuperAdmin at /api/whapi/admin/evolution. Both source tables
 * are service-role only, so this reads/writes them via supabaseAdmin (which is the
 * ONLY path merchants can never take). proxy_url credentials are masked in responses.
 */
import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../../config/supabase.js';
import { config } from '../../config/env.js';
import { requireSuperAdmin } from '../../middleware/superAdminAuth.js';
import { syncEvolutionProxyLeaseInfo } from '../../jobs/evolutionProxyHeal.js';
import { isBrightdataConfigured, brightdataGetBalance } from '../../whatsapp/evolution/brightdataClient.js';

export const evolutionAdminRouter: Router = Router();
evolutionAdminRouter.use(requireSuperAdmin);

/** Never leak the proxy password to the UI: strip it, keep host:port + user. */
function maskProxyUrl(url: string): string {
  try {
    const u = new URL(url);
    const cred = u.username ? `${u.username}:***@` : '';
    return `${u.protocol}//${cred}${u.hostname}${u.port ? ':' + u.port : ''}`;
  } catch {
    return '(unparseable)';
  }
}

// Row shapes for the service-role reads below (these tables are not in the
// generated Database types, so we describe just the columns we select).
interface ProxyRow {
  id: number;
  proxy_url: string;
  label: string | null;
  status: string | null;
  health: string | null;
  fraud_score: number | null;
  provider: string | null;
  provider_order_id: string | null;
  assigned_channel_id: number | null;
  notes: string | null;
  last_checked_at: string | null;
  assigned_at: string | null;
  lease_expires_at: string | null;
  auto_extend: boolean | null;
  created_at: string | null;
  updated_at: string | null;
}
interface ChannelRow {
  id: number;
  company_id: string | null;
  channel_name: string | null;
  companies?: { company_name?: string | null } | null;
}
interface ProviderStats {
  provider: string;
  total: number;
  screened: number;
  clean: number;
  dirty: number;
  unscreened: number;
  available: number;
  assigned: number;
  dead: number;
}
interface OverrideRow {
  company_id: string;
  provider: string | null;
  note: string | null;
  updated_at: string | null;
  companies?: { company_name?: string | null } | null;
}
interface CompanyRow { id: string; company_name: string | null }
interface OverrideMini { company_id: string; provider: string }

// ─── GET /proxies - the pool + aggregate yield stats ─────────────────────────
evolutionAdminRouter.get('/proxies', async (_req: Request, res: Response) => {
  const { data: rows, error } = await supabaseAdmin
    .from('evolution_proxies')
    .select('id, proxy_url, label, status, health, fraud_score, provider, provider_order_id, assigned_channel_id, notes, last_checked_at, assigned_at, lease_expires_at, auto_extend, created_at, updated_at')
    .order('created_at', { ascending: false });
  if (error) { res.status(500).json({ error: 'DB lookup failed', detail: error.message }); return; }
  const proxies = (rows ?? []) as unknown as ProxyRow[];

  // Which company/channel each assigned proxy serves.
  const channelIds = [...new Set(proxies.map((p) => p.assigned_channel_id).filter((x): x is number => typeof x === 'number'))];
  const chById = new Map<number, { company_id: string | null; company_name: string | null; channel_name: string | null }>();
  if (channelIds.length > 0) {
    const { data: chs } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('id, company_id, channel_name, companies(company_name)')
      .in('id', channelIds);
    for (const c of (chs ?? []) as unknown as ChannelRow[]) {
      chById.set(c.id, { company_id: c.company_id ?? null, company_name: c.companies?.company_name ?? null, channel_name: c.channel_name ?? null });
    }
  }

  const threshold = config.evolutionProxyFraudThreshold;
  const statsByProvider: Record<string, ProviderStats> = {};
  const list = proxies.map((p) => {
    const prov = p.provider ?? '(none)';
    const s = (statsByProvider[prov] ??= { provider: prov, total: 0, screened: 0, clean: 0, dirty: 0, unscreened: 0, available: 0, assigned: 0, dead: 0 });
    s.total += 1;
    if (p.fraud_score == null) s.unscreened += 1;
    else { s.screened += 1; if (p.fraud_score < threshold) s.clean += 1; else s.dirty += 1; }
    if (p.status === 'available') s.available += 1;
    else if (p.status === 'assigned') s.assigned += 1;
    else if (p.status === 'dead') s.dead += 1;
    const ch = p.assigned_channel_id != null ? chById.get(p.assigned_channel_id) : null;
    return {
      id: p.id,
      provider: p.provider,
      status: p.status,
      health: p.health,
      fraud_score: p.fraud_score,
      proxy: maskProxyUrl(p.proxy_url),
      label: p.label,
      notes: p.notes,
      provider_order_id: p.provider_order_id,
      assigned_channel_id: p.assigned_channel_id,
      company_id: ch?.company_id ?? null,
      company_name: ch?.company_name ?? null,
      channel_name: ch?.channel_name ?? null,
      last_checked_at: p.last_checked_at,
      assigned_at: p.assigned_at,
      lease_expires_at: p.lease_expires_at,
      auto_extend: p.auto_extend,
      created_at: p.created_at,
      updated_at: p.updated_at,
    };
  });
  const stats = Object.values(statsByProvider).map((s: ProviderStats) => ({
    ...s,
    clean_rate: s.screened > 0 ? Math.round((s.clean / s.screened) * 100) : null,
  }));
  res.json({ proxies: list, stats, threshold });
});

// ─── POST /proxies/sync - pull FRESH lease info from the providers on demand ──
// Runs the same INFO pull the heal cron does (IPRoyal expiry + auto-renew, stamped
// onto each row) but WITHOUT the money-spending heal actions, plus the Bright Data
// account balance (BD has no per-proxy lease/renew - it's billed until a zone is
// released, so its dynamic account-level signal is the balance). Safe to click anytime.
evolutionAdminRouter.post('/proxies/sync', async (_req: Request, res: Response) => {
  const sync = await syncEvolutionProxyLeaseInfo();
  let brightdataBalance: number | null = null;
  if (isBrightdataConfigured()) {
    const bal = await brightdataGetBalance();
    brightdataBalance = bal.ok ? (bal.body?.balance ?? null) : null;
  }
  if (!sync.ok) { res.status(502).json({ error: sync.error ?? 'sync failed', brightdata_balance: brightdataBalance }); return; }
  res.json({ ok: true, stamped: sync.stamped, orders: sync.orders, brightdata_balance: brightdataBalance });
});

// ─── GET /companies - companies currently overridden to a specific provider ──
evolutionAdminRouter.get('/companies', async (_req: Request, res: Response) => {
  const { data: overrides, error } = await supabaseAdmin
    .from('whatsapp_provider_overrides')
    .select('company_id, provider, note, updated_at, companies(company_name)')
    .order('updated_at', { ascending: false });
  if (error) { res.status(500).json({ error: 'DB lookup failed', detail: error.message }); return; }
  const list = ((overrides ?? []) as unknown as OverrideRow[]).map((o) => ({
    company_id: o.company_id,
    company_name: o.companies?.company_name ?? null,
    provider: o.provider,
    note: o.note ?? null,
    updated_at: o.updated_at,
  }));
  res.json({ overrides: list, globalDefault: config.whatsappNewChannelProvider });
});

// ─── GET /companies/search?q= - find a company to flip ───────────────────────
evolutionAdminRouter.get('/companies/search', async (req: Request, res: Response) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) { res.json({ companies: [] }); return; }
  const { data, error } = await supabaseAdmin
    .from('companies')
    .select('id, company_name')
    .ilike('company_name', `%${q}%`)
    .order('company_name', { ascending: true })
    .limit(25);
  if (error) { res.status(500).json({ error: 'DB lookup failed', detail: error.message }); return; }
  const companies = (data ?? []) as unknown as CompanyRow[];
  const ids = companies.map((c) => c.id);
  const ovByCompany = new Map<string, string>();
  if (ids.length > 0) {
    const { data: ov } = await supabaseAdmin.from('whatsapp_provider_overrides').select('company_id, provider').in('company_id', ids);
    for (const o of (ov ?? []) as unknown as OverrideMini[]) ovByCompany.set(o.company_id, o.provider);
  }
  res.json({ companies: companies.map((c) => ({ id: c.id, company_name: c.company_name, provider: ovByCompany.get(c.id) ?? null })) });
});

// ─── POST /companies/provider - set or clear a company's provider override ───
// body: { company_id, provider }.
//   provider 'evolution' | 'whapi' -> explicit override (upsert)
//   provider null / 'default' / absent -> remove override (falls back to global default)
evolutionAdminRouter.post('/companies/provider', async (req: Request, res: Response) => {
  const companyId = String(req.body?.company_id ?? '');
  const provider = req.body?.provider;
  if (!companyId) { res.status(400).json({ error: 'company_id required' }); return; }

  if (provider === 'evolution' || provider === 'whapi') {
    const { error } = await supabaseAdmin
      .from('whatsapp_provider_overrides')
      .upsert({ company_id: companyId, provider, updated_at: new Date().toISOString() } as never, { onConflict: 'company_id' });
    if (error) { res.status(500).json({ error: 'upsert failed', detail: error.message }); return; }
    res.json({ ok: true, company_id: companyId, provider });
    return;
  }
  // Anything else = remove the override (company uses the global default).
  const { error } = await supabaseAdmin.from('whatsapp_provider_overrides').delete().eq('company_id', companyId);
  if (error) { res.status(500).json({ error: 'delete failed', detail: error.message }); return; }
  res.json({ ok: true, company_id: companyId, provider: null });
});
