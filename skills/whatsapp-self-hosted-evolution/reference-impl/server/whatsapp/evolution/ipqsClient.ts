/**
 * IPQualityScore (IPQS) client - the SINGLE place that talks to IPQS. Used to
 * SCREEN a proxy IP's fraud reputation before we hand it to a merchant's
 * WhatsApp, and by the pool health cron to re-score IPs over time.
 *
 * Why IPQS and not ip-api: ip-api only knows an IP's *type* (datacenter/proxy
 * netblock) and is unreliable for our purpose (proven 2026-09-07: it called a
 * fraud-94 recycled IP "clean" and a clean fresh IP a "proxy" - exactly
 * backwards). IPQS's fraud_score + recent_abuse is the signal that actually
 * tracks WhatsApp-ban risk.
 *
 * Endpoint: GET https://ipqualityscore.com/api/json/ip/{KEY}/{IP}
 * Auth is the key embedded in the path. Transport-only: no DB, no policy.
 */
import { config } from '../../config/env.js';

const BASE = 'https://ipqualityscore.com/api/json/ip';
const TIMEOUT_MS = 15_000;

export function isIpqsConfigured(): boolean {
  return !!config.ipqsApiKey;
}

export interface IpqsResult {
  ok: boolean;
  fraudScore: number | null;
  proxy: boolean;
  vpn: boolean;
  tor: boolean;
  recentAbuse: boolean;
  bot: boolean;
  isp: string | null;
  error?: string;
}

interface RawIpqs {
  success?: boolean;
  message?: string;
  fraud_score?: number;
  proxy?: boolean;
  vpn?: boolean;
  tor?: boolean;
  recent_abuse?: boolean;
  bot_status?: boolean;
  ISP?: string;
}

/**
 * Look up one IP's fraud signals. strictness=0 matches the IPQS web dashboard
 * (a stable reading); allow_public_access_points reduces false positives on
 * shared connections. Returns ok=false on any transport/API failure so callers
 * can FAIL OPEN (never treat a flaky lookup as "dirty").
 */
export async function ipqsCheckIp(ip: string): Promise<IpqsResult> {
  const fail = (error: string): IpqsResult => ({
    ok: false, fraudScore: null, proxy: false, vpn: false, tor: false,
    recentAbuse: false, bot: false, isp: null, error,
  });
  if (!config.ipqsApiKey) return fail('IPQS_API_KEY not set');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url = `${BASE}/${encodeURIComponent(config.ipqsApiKey)}/${encodeURIComponent(ip)}`
      + `?strictness=0&allow_public_access_points=true`;
    const resp = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
    clearTimeout(timer);
    let body: RawIpqs | null = null;
    try { body = (await resp.json()) as RawIpqs; } catch { body = null; }
    if (!resp.ok || !body || body.success === false) {
      return fail(body?.message || `IPQS ${resp.status}`);
    }
    return {
      ok: true,
      fraudScore: typeof body.fraud_score === 'number' ? body.fraud_score : null,
      proxy: !!body.proxy,
      vpn: !!body.vpn,
      tor: !!body.tor,
      recentAbuse: !!body.recent_abuse,
      bot: !!body.bot_status,
      isp: body.ISP ?? null,
    };
  } catch (err) {
    clearTimeout(timer);
    return fail(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Verdict for a lookup result: is this IP too dirty to hand to a merchant?
 * DIRTY when fraud_score >= threshold, OR the belt-and-suspenders combo
 * proxy && recent_abuse (a recycled abused IP even if the numeric score dips).
 * A FAILED lookup (ok=false) is NEVER dirty - screening fails open so a flaky
 * external API can never become a "kill this proxy" writer.
 */
export function isIpDirty(r: IpqsResult, threshold: number): boolean {
  if (!r.ok) return false;
  if (r.fraudScore != null && r.fraudScore >= threshold) return true;
  if (r.proxy && r.recentAbuse) return true;
  return false;
}

/** Compact one-line summary for the evolution_proxies.health text column. */
export function ipqsHealthSummary(r: IpqsResult): string {
  if (!r.ok) return `ipqs:unchecked (${r.error ?? 'error'}) @ ${new Date().toISOString()}`;
  return `ipqs:${r.fraudScore ?? '?'} `
    + `${r.proxy ? 'proxy ' : ''}${r.vpn ? 'vpn ' : ''}${r.recentAbuse ? 'recent_abuse ' : ''}${r.bot ? 'bot ' : ''}`
    + `@ ${new Date().toISOString()}`;
}
