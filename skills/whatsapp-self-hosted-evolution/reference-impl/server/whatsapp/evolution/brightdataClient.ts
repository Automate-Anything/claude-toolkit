/**
 * Bright Data (super-proxy) reseller client - the SINGLE place that talks to BD,
 * used as the SECOND proxy provider by the auto-buy adapter (proxyPool). Transport
 * + thin provisioning only: no DB, no policy. Auth is a Bearer token
 * (config.brightdataApiToken).
 *
 * MODEL (deliberately different from IPRoyal): each BD IP is its OWN dedicated ISP
 * zone, created WITH 1 IP so it allocates immediately (create-with-ips is the
 * reliable path; add-to-an-existing-zone can queue). BD bills PRORATED until the
 * zone is DELETED, so callers DELETE the zone on release / on a dirty reject and
 * never park a BD IP idle. The connection host is the SHARED gateway
 * (brd.superproxy.io), NOT the IP; the egress IP we IPQS-screen is returned
 * separately at buy time.
 *
 * ⚠️ A buy SPENDS MONEY (prorated). It draws from the BD prepaid BALANCE (the API
 * cannot charge a card directly - keep auto-recharge on with a buffer). A buy from
 * an empty balance FAILS rather than charging a card (no debt); the caller treats a
 * failure as an ERROR and switches providers.
 */
import { config } from '../../config/env.js';

const BASE = 'https://api.brightdata.com';
const TIMEOUT_MS = 30_000;

export interface BdResult<T = unknown> {
  ok: boolean;
  status: number | null;
  body: T | null;
  error?: string;
}

export function isBrightdataConfigured(): boolean {
  return !!config.brightdataApiToken && !!config.brightdataCustomerId;
}

async function bdFetch<T = unknown>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  bodyObj?: unknown,
  timeoutMs = TIMEOUT_MS,
): Promise<BdResult<T>> {
  if (!config.brightdataApiToken) {
    return { ok: false, status: null, body: null, error: 'BRIGHTDATA_API_TOKEN not set' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.brightdataApiToken}`,
        Accept: 'application/json',
        ...(bodyObj != null ? { 'Content-Type': 'application/json' } : {}),
      },
      body: bodyObj != null ? JSON.stringify(bodyObj) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await resp.text();
    let body: T | null = null;
    try { body = text ? (JSON.parse(text) as T) : null; } catch { body = text as unknown as T; }
    if (!resp.ok) {
      const msg = typeof body === 'string' ? body.slice(0, 300) : `Bright Data ${resp.status}`;
      return { ok: false, status: resp.status, body, error: msg };
    }
    return { ok: true, status: resp.status, body };
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, status: null, body: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface BdProvisioned {
  /** The egress IP to IPQS-screen (NOT the connection host, which is the gateway). */
  egressIp: string;
  /** Full gateway proxy URL for Evolution: http://brd-customer-..-zone-<zone>:<pw>@host:port */
  url: string;
  /** The zone name - stored as provider_order_id; delete it to stop billing. */
  zone: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Zone name: lowercase alnum, unique per buy (BD zone names cannot be reused once
// deleted-and-recreated quickly, and each IP gets its own zone).
function newZoneName(): string {
  return `bp${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Buy ONE dedicated ISP IP: create a fresh zone with 1 IP (immediate allocation),
 * read back its egress IP, and build the gateway proxy URL. Returns the parts, or
 * an error (caller treats an error as ERROR -> switch provider). SPENDS MONEY
 * (prorated; delete the zone to stop billing). Best-effort cleans up a half-made
 * zone if the IP never lands.
 */
export async function brightdataBuyOne(): Promise<BdResult<BdProvisioned>> {
  if (!isBrightdataConfigured()) {
    return { ok: false, status: null, body: null, error: 'Bright Data not configured (token/customer id)' };
  }
  const zone = newZoneName();
  const created = await bdFetch<{ zone?: { password?: unknown } }>('POST', '/zone', {
    zone: { name: zone, type: 'ISP' },
    plan: {
      type: 'static',
      pool_ip_type: 'static_res',
      ips_type: 'dedicated',
      bandwidth: 'unlimited',
      unl_bw_tiers: 'std',
      country: config.brightdataCountry,
      ips: 1,
    },
  });
  if (!created.ok) {
    return { ok: false, status: created.status, body: null, error: `zone create failed: ${created.error}` };
  }
  const pw = created.body?.zone?.password;
  const password: string | null = Array.isArray(pw) ? (pw[0] ?? null) : (typeof pw === 'string' ? pw : null);
  if (!password) {
    await bdFetch('DELETE', '/zone', { zone }).catch(() => {});
    return { ok: false, status: created.status, body: null, error: 'zone create returned no password' };
  }
  // Read the allocated egress IP (dedicated allocates immediately, but give it a beat).
  let egressIp: string | null = null;
  for (const delay of [1_000, 2_000, 3_000, 4_000]) {
    await sleep(delay);
    const ipsRes = await bdFetch<{ ips?: Array<{ ip?: unknown }> }>('GET', `/zone/ips?zone=${encodeURIComponent(zone)}`);
    const ips = ipsRes.ok ? ipsRes.body?.ips : null;
    const arr = Array.isArray(ips) ? ips : [];
    if (arr.length > 0 && arr[0]?.ip) { egressIp = String(arr[0].ip); break; }
  }
  if (!egressIp) {
    await bdFetch('DELETE', '/zone', { zone }).catch(() => {});
    return { ok: false, status: created.status, body: null, error: 'no IP allocated to the new zone in time' };
  }
  const user = `brd-customer-${config.brightdataCustomerId}-zone-${zone}`;
  const url = `http://${user}:${password}@${config.brightdataGatewayHost}:${config.brightdataGatewayPort}`;
  return { ok: true, status: 200, body: { egressIp, url, zone } };
}

/**
 * Delete a BD zone to STOP its prorated billing (called on release, and on a dirty
 * reject). A 404 means it's already gone, which is fine.
 */
export async function brightdataReleaseZone(zone: string): Promise<BdResult> {
  const res = await bdFetch('DELETE', '/zone', { zone });
  if (!res.ok && res.status === 404) return { ok: true, status: 404, body: null };
  return res;
}

/**
 * Account balance, for the low-balance monitor (BD's API can't charge a card, so an
 * empty balance means buys fail - we want to alert before that). Short timeout: the
 * balance endpoint is slow.
 */
export async function brightdataGetBalance(): Promise<BdResult<{ balance: number | null; pending: number | null }>> {
  const res = await bdFetch<{ balance?: unknown; pending_balance?: unknown }>('GET', '/customer/balance', undefined, 8_000);
  if (!res.ok) return res as BdResult<{ balance: number | null; pending: number | null }>;
  return {
    ok: true,
    status: res.status,
    body: {
      balance: typeof res.body?.balance === 'number' ? res.body.balance : null,
      pending: typeof res.body?.pending_balance === 'number' ? res.body.pending_balance : null,
    },
  };
}
