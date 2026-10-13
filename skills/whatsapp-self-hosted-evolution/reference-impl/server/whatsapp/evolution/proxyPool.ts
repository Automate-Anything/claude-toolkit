/**
 * Evolution per-channel proxy POOL (evolution/PROXY_PER_CHANNEL_PLAN.md, T3-T5).
 *
 * Each connected WhatsApp instance should egress from its OWN static IP so a
 * WhatsApp ban on one shared IP can't take down multiple merchants at once. This
 * module owns the ASSIGNMENT side: claim a free proxy for a channel at connect,
 * release it back to the pool on delete. The pool rows live in the
 * service-role-only `evolution_proxies` table (proxy_url carries credentials, so
 * it is never client-exposed - see the migration).
 *
 * Mode (config.evolutionProxyMode):
 *   'off'      - assignment is a no-op; instances share the host IP (test-only).
 *   'required' - every new channel MUST get a proxy; if none is free the caller
 *                fails the connect LOUDLY (never falls back to the shared IP).
 *
 * Auto-buy seam: acquireNewProxy() buys a fresh IPRoyal ISP IP when the pool is
 * exhausted (config.evolutionProxyAutobuy === 'on'). It SPENDS MONEY, so it is
 * off by default, hard-capped (evolutionProxyMaxPool), reuse-first (only runs
 * when no 'available' proxy exists), and serialized in-process so one connect can
 * never buy twice. With autobuy 'off' it returns null -> 'required' + empty pool
 * fails loudly, the cost-safe default.
 */
import { config } from '../../config/env.js';
import { supabaseAdmin } from '../../config/supabase.js';
import { reportError } from '../../utils/errorReporter.js';
import {
  isIproyalConfigured,
  iproyalCreateOrder,
  iproyalGetOrderProxies,
  iproyalToggleAutoExtend,
  iproyalGetOrderStatus,
  iproyalGetOrderSummary,
} from './iproyalClient.js';
import {
  isBrightdataConfigured,
  brightdataBuyOne,
  brightdataReleaseZone,
} from './brightdataClient.js';
import {
  isIpqsConfigured,
  ipqsCheckIp,
  isIpDirty,
  ipqsHealthSummary,
  type IpqsResult,
} from './ipqsClient.js';
import { evoSetProxy, evoRestartInstance, parseProxyUrl } from './evolutionClient.js';
import axios from 'axios';

export function isProxyModeRequired(): boolean {
  return config.evolutionProxyMode === 'required';
}

export interface ClaimedProxy {
  id: number;
  proxyUrl: string;
}

interface ProxyRow {
  id: number;
  proxy_url: string;
  provider?: string | null;
  provider_order_id?: string | null;
}

/**
 * Re-screen a just-claimed pool proxy before handing it to the channel. A REUSED
 * IP (previously assigned to another merchant, since released back to the pool)
 * may have been flagged by that prior holder, so cleanliness is re-verified at the
 * moment of reuse - the one point on the reuse path where it can have changed.
 * (Fresh auto-buys are screened separately at BUY time; there is no timer-based
 * re-check: dedicated IPs we own stay clean while we hold them, and a banned
 * number is already caught by whatsapp_ban_sweep.)
 *
 * Dirty -> retire it 'dead' + release the binding, return null so the caller tries
 * the next candidate. Clean / unscreened / lookup-failed -> stamp the fresh reading
 * and keep it (fail-open: a flaky IPQS lookup never blocks a connect).
 */
async function screenClaimedProxy(claimed: ProxyRow, channelDbId: number): Promise<ClaimedProxy | null> {
  // (1) LEASE check FIRST. IPRoyal's status endpoint has no tight limit; IPQS has a
  // monthly quota - so never spend an IPQS lookup on a pool IP whose lease already
  // lapsed while it sat idle (auto-extend was off on release). Only a CONFIRMED
  // expired lease retires it; an unreadable/active status falls through (fail-open).
  if (claimed.provider === 'iproyal' && claimed.provider_order_id) {
    const st = await iproyalGetOrderStatus(claimed.provider_order_id, config.iproyalProductId);
    if (st.ok && st.body?.expired) {
      const nowIso = new Date().toISOString();
      await supabaseAdmin
        .from('evolution_proxies')
        .update({
          status: 'dead',
          assigned_channel_id: null,
          assigned_at: null,
          notes: `claim-time: IPRoyal lease expired (${st.body.status ?? 'expired'})`,
          last_checked_at: nowIso,
          updated_at: nowIso,
        } as never)
        .eq('id', claimed.id);
      console.warn(`[proxy-claim] retired expired reused proxy ${claimed.id} (order ${claimed.provider_order_id})`);
      reportError(new Error('Evolution proxy claim: reused proxy lease had expired'), {
        type: 'evolution_proxy_reused_expired',
        dedupe: 'silent',
        metadata: { source: 'proxyPool.screenClaimedProxy.expired', proxyId: claimed.id, orderId: claimed.provider_order_id },
      });
      return null; // caller tries the next candidate / auto-buys.
    }
  }

  // Bright Data connects via a shared GATEWAY host, so proxy_url's hostname is NOT the
  // egress IP we'd screen (and BD is screened at buy time + deleted on release, never
  // parked 'available'), so a BD row shouldn't reach this reuse path. Skip the fraud
  // screen defensively (fail-open) rather than screen the gateway host by mistake.
  if (claimed.provider === 'brightdata') return { id: claimed.id, proxyUrl: claimed.proxy_url };

  // (2) FRAUD screen (only reached for a live lease).
  if (!isIpqsConfigured()) return { id: claimed.id, proxyUrl: claimed.proxy_url };
  let ip: string | null = null;
  try { ip = new URL(claimed.proxy_url).hostname || null; } catch { ip = null; }
  if (!ip) return { id: claimed.id, proxyUrl: claimed.proxy_url }; // malformed url - can't screen, fail-open.

  const screen = await ipqsCheckIp(ip);
  const nowIso = new Date().toISOString();
  const summary = ipqsHealthSummary(screen);

  if (isIpDirty(screen, config.evolutionProxyFraudThreshold)) {
    // Retire the dirty reused IP and release the just-made binding so the caller
    // moves on (reuse-first never sees it again; auto-buy replaces it).
    await supabaseAdmin
      .from('evolution_proxies')
      .update({
        status: 'dead',
        assigned_channel_id: null,
        assigned_at: null,
        health: 'failing',
        fraud_score: screen.fraudScore,
        last_checked_at: nowIso,
        notes: `claim-time screen retired dirty (reused): ${summary}`,
        updated_at: nowIso,
      } as never)
      .eq('id', claimed.id);
    console.warn(`[proxy-claim] retired dirty reused proxy ${claimed.id} (${ip}): ${summary}`);
    reportError(new Error('Evolution proxy claim: reused proxy IP is dirty'), {
      type: 'evolution_proxy_reused_dirty',
      dedupe: 'silent',
      metadata: { source: 'proxyPool.screenClaimedProxy.dirty', proxyId: claimed.id, ip, summary },
    });
    return null;
  }

  // NO billing-side routability probe here, on purpose. IPRoyal lets ONE source address use a
  // proxy at a time (~15s hold after any request). A probe from THIS server moments before
  // evoCreateInstance / evoSetProxy made Evolution's own proxy test (from Evolution's address)
  // get a bare 403 -> "Invalid proxy" on EVERY connect that reused a pool IP (2026-09-23).
  // Routability is proven where it matters instead: Evolution tests the proxy from the host
  // that will actually use it, and a proxy it still rejects after the hold retries is retired
  // 'dead' by the caller (createEvolutionChannel).

  // Clean (or lookup-failed, fail-open): stamp the reading, keep the assignment.
  // health is the enum ('ok' when screened clean, null when the lookup failed).
  await supabaseAdmin
    .from('evolution_proxies')
    .update({ health: screen.ok ? 'ok' : null, fraud_score: screen.fraudScore, last_checked_at: nowIso, updated_at: nowIso } as never)
    .eq('id', claimed.id);
  if (!screen.ok) {
    reportError(new Error(`Proxy claim: assigned reused ${ip} UNSCREENED (IPQS lookup failed: ${screen.error})`), {
      type: 'eng_alert',
      dedupe: 'silent',
      metadata: { source: 'proxyPool.screenClaimedProxy.unscreened', ip, proxyId: claimed.id },
    });
  }
  return { id: claimed.id, proxyUrl: claimed.proxy_url };
}

/**
 * Atomically claim one 'available' proxy for a channel. Race-safe WITHOUT an
 * explicit lock: the conditional UPDATE (... WHERE id=? AND status='available')
 * takes a Postgres row lock, so two concurrent claims on the SAME row resolve to
 * exactly one winner (the loser updates 0 rows and moves to the next candidate).
 * Returns null when the pool has no free proxy (after trying the auto-buy seam).
 */
export async function claimProxyForChannel(channelDbId: number): Promise<ClaimedProxy | null> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const { data: candidates } = await supabaseAdmin
      .from('evolution_proxies')
      .select('id, proxy_url')
      .eq('status', 'available')
      .is('assigned_channel_id', null)
      .order('created_at', { ascending: true })
      .limit(5);
    const list = (candidates ?? []) as ProxyRow[];
    if (list.length === 0) break;

    for (const cand of list) {
      const nowIso = new Date().toISOString();
      const { data: claimed } = await supabaseAdmin
        .from('evolution_proxies')
        .update({
          status: 'assigned',
          assigned_channel_id: channelDbId,
          assigned_at: nowIso,
          updated_at: nowIso,
        } as never)
        .eq('id', cand.id)
        .eq('status', 'available')
        .is('assigned_channel_id', null)
        .select('id, proxy_url, provider, provider_order_id')
        .maybeSingle();
      if (claimed) {
        // Re-screen before use; a dirty reused IP is retired and we fall through
        // to the next candidate (or, once the pool is exhausted, auto-buy).
        const finalized = await screenClaimedProxy(claimed as ProxyRow, channelDbId);
        if (finalized) return finalized;
      }
      // Lost the race for this row (or it screened dirty) - try the next candidate.
    }
  }

  // Manual pool exhausted. Auto-buy seam (null today - see acquireNewProxy).
  return acquireNewProxy(channelDbId);
}

// ── IPRoyal auto-renew is per ORDER (package), not per IP ─────────────────────
// A multi-IP package has ONE auto-renew switch for every IP in it. Toggling it for
// one channel's IP toggles every sibling's too, so deciding per proxy was wrong:
// releasing one IP switched renewal off for a sibling still serving a connected
// merchant (that IP would then lapse), and the hourly reconcile flip-flopped the
// package between siblings in different states. Every renewal decision goes through
// orderRenewalFromStates, and every switch is followed by a READ-BACK from IPRoyal
// (syncIproyalOrderToPool) so our rows (and the superadmin pool view) show what
// IPRoyal actually has, not what we asked for. (2026-09-24)

/** Connection states that DEFINITELY mean "not serving a merchant right now". */
const RENEWAL_OFF_STATES = new Set(['disconnected', 'needs_qr', 'banned', 'released']);

/**
 * Should a package renew, given the connection state of the channel on each of its
 * ASSIGNED IPs? true = at least one serves a connected channel (keep them all alive);
 * false = none does and none is mid-reconnect; null = undecidable right now (a channel
 * is connecting / reconnecting / unknown), so leave the switch as it is.
 */
export function orderRenewalFromStates(states: (string | null | undefined)[]): boolean | null {
  if (states.some((s) => s === 'connected')) return true;
  if (states.some((s) => !s || !RENEWAL_OFF_STATES.has(s))) return null;
  return false;
}

/**
 * Live DB read of every channel on this order's assigned IPs, then the package rule.
 * `override` supplies the state for ONE channel we already know better than the DB
 * (the connection handler calls this as a state change lands, before or after the row
 * is updated).
 */
async function decideOrderAutoExtend(
  orderId: string,
  override?: { channelDbId: number; state: string },
): Promise<boolean | null> {
  const { data: rows } = await supabaseAdmin
    .from('evolution_proxies')
    .select('assigned_channel_id')
    .eq('provider', 'iproyal')
    .eq('provider_order_id', orderId)
    .eq('status', 'assigned')
    .not('assigned_channel_id', 'is', null);
  const channelIds = [...new Set(((rows ?? []) as { assigned_channel_id: number }[]).map((r) => r.assigned_channel_id))];
  if (override && !channelIds.includes(override.channelDbId)) channelIds.push(override.channelDbId);
  if (channelIds.length === 0) return false; // nothing in the package is in use

  const { data: chs } = await supabaseAdmin
    .from('whatsapp_channels')
    .select('id, connection_state')
    .in('id', channelIds)
    .eq('provider', 'evolution')
    .neq('lifecycle_state', 'deleted');
  const stateById = new Map(((chs ?? []) as { id: number; connection_state: string | null }[]).map((c) => [c.id, c.connection_state]));
  const states = channelIds.map((id) => {
    if (override && id === override.channelDbId) return override.state;
    // A proxy still 'assigned' to a deleted/missing channel is not serving anyone.
    return stateById.has(id) ? stateById.get(id) : 'released';
  });
  return orderRenewalFromStates(states);
}

/**
 * Read ONE order back from IPRoyal and record its REAL auto-renew + lease expiry on
 * every pool row of that order (a package's IPs share both). Best-effort: a failed
 * read leaves the rows as they are (the hourly heal sweep stamps them again) and is
 * reported silently.
 */
export async function syncIproyalOrderToPool(orderId: string): Promise<void> {
  const res = await iproyalGetOrderSummary(orderId, config.iproyalProductId);
  if (!res.ok || !res.body) {
    reportError(new Error(`Proxy renewal read-back failed for order ${orderId}: ${res.error ?? 'no body'}`), {
      type: 'eng_alert',
      dedupe: 'silent',
      metadata: { source: 'proxyPool.syncIproyalOrderToPool', orderId, status: res.status },
    });
    return;
  }
  const expire = res.body.expireDate ? Date.parse(res.body.expireDate.replace(' ', 'T')) : NaN;
  await supabaseAdmin
    .from('evolution_proxies')
    .update({
      auto_extend: res.body.autoExtendEnabled,
      lease_expires_at: Number.isNaN(expire) ? null : new Date(expire).toISOString(),
      updated_at: new Date().toISOString(),
    } as never)
    .eq('provider', 'iproyal')
    .eq('provider_order_id', orderId)
    .in('status', ['available', 'assigned']);
}

/**
 * Apply the package rule to an order's auto-renew switch, then read the result back.
 * The single entry point for every renewal change (connect / disconnect, release,
 * swap). Never throws.
 */
export async function reconcileIproyalOrderRenewal(
  orderId: string,
  override?: { channelDbId: number; state: string },
): Promise<void> {
  try {
    const desired = await decideOrderAutoExtend(orderId, override);
    if (desired !== null) {
      const res = await iproyalToggleAutoExtend({ orderId, planId: config.iproyalPlanId, enabled: desired });
      if (!res.ok) {
        reportError(new Error(`Proxy auto-renew ${desired ? 'enable' : 'disable'} failed for order ${orderId}: ${res.error}`), {
          type: 'eng_alert',
          dedupe: 'silent',
          metadata: { source: 'proxyPool.reconcileIproyalOrderRenewal', orderId, desired, override },
        });
      } else {
        console.log(`[proxy-autoextend] order ${orderId} auto-renew ${desired ? 'ON' : 'OFF'}${override ? ` (channel ${override.channelDbId} ${override.state})` : ''}`);
      }
    }
    await syncIproyalOrderToPool(orderId);
  } catch (err) {
    reportError(err as Error, {
      type: 'eng_alert',
      dedupe: 'silent',
      metadata: { source: 'proxyPool.reconcileIproyalOrderRenewal', orderId },
    });
  }
}

/**
 * Release the proxy bound to a channel back to the pool (T4). Idempotent: a no-op
 * if the channel holds none. Called on channel DELETE and on out-of-band
 * vanish-retire - deliberately NOT on logout (a logout keeps the channel row and
 * a reconnect reuses the same instance + proxy, which keeps the merchant's egress
 * IP stable; churning the IP would force an avoidable re-pair).
 */
export async function releaseProxyForChannel(channelDbId: number): Promise<void> {
  await releaseProxiesForChannels([channelDbId]);
}

/**
 * Batch release (the vanish-reconcile path retires several channels at once).
 * Provider-aware:
 *   IPRoyal - an idle lease should stop auto-renewing (Decision A), but the IP keeps
 *     its remaining PAID lease and returns to the pool 'available' for reuse; a later
 *     reuse + connect re-enables auto-extend via the connection handler.
 *   Bright Data - BD bills PRORATED until the zone is DELETED, so a released BD IP is
 *     DELETED (never parked idle) and its row marked 'dead' (the IP no longer exists,
 *     so it can't be reused).
 */
export async function releaseProxiesForChannels(channelDbIds: number[]): Promise<void> {
  if (channelDbIds.length === 0) return;
  const { data: releasing } = await supabaseAdmin
    .from('evolution_proxies')
    .select('id, provider, provider_order_id')
    .in('assigned_channel_id', channelDbIds);
  const rows = (releasing ?? []) as { id: number; provider: string | null; provider_order_id: string | null }[];
  const nowIso = new Date().toISOString();

  const bdIds: number[] = [];
  const reusableIds: number[] = []; // iproyal + any unknown/manual provider -> reuse
  const iproyalOrders = new Set<string>();
  for (const r of rows) {
    if (r.provider === 'brightdata') {
      if (r.provider_order_id) void brightdataReleaseZone(r.provider_order_id).catch(() => {});
      bdIds.push(r.id);
    } else {
      if (r.provider === 'iproyal' && r.provider_order_id) iproyalOrders.add(r.provider_order_id);
      reusableIds.push(r.id);
    }
  }

  if (reusableIds.length > 0) {
    await supabaseAdmin
      .from('evolution_proxies')
      .update({ status: 'available', assigned_channel_id: null, assigned_at: null, updated_at: nowIso } as never)
      .in('id', reusableIds);
  }
  if (bdIds.length > 0) {
    await supabaseAdmin
      .from('evolution_proxies')
      .update({ status: 'dead', assigned_channel_id: null, assigned_at: null, notes: 'released: BD zone deleted (stops billing)', updated_at: nowIso } as never)
      .in('id', bdIds);
  }

  // Now that the released IPs no longer count as in use, apply the PACKAGE rule: an
  // order stops renewing only if none of its other IPs serves a connected channel, and
  // our rows get IPRoyal's real state straight away (not after the hourly sweep).
  for (const orderId of iproyalOrders) {
    await reconcileIproyalOrderRenewal(orderId);
  }
}

/**
 * Turn auto-renew (IPRoyal auto-extend) ON or OFF for the IP a channel is using,
 * driven by REAL connection state (called from the Evolution connection handler):
 * ON when the channel connects to a live WhatsApp, OFF when it disconnects / logs
 * out / is banned. This keeps a working number's IP alive past 30 days with no
 * rebuy + re-pair, while never renewing an IP that isn't actually serving a
 * connection (a dead/never-paired IP never reaches 'connected', so it never gets
 * renewal turned on). No-op unless the channel holds an IPRoyal proxy with an order
 * id. Best-effort: a toggle failure is reported silently, never blocks the caller.
 */
export async function setProxyAutoExtendForChannel(channelDbId: number, enabled: boolean): Promise<void> {
  const { data } = await supabaseAdmin
    .from('evolution_proxies')
    .select('provider, provider_order_id')
    .eq('assigned_channel_id', channelDbId)
    .eq('status', 'assigned')
    .maybeSingle();
  const row = data as { provider: string | null; provider_order_id: string | null } | null;
  if (!row || row.provider !== 'iproyal' || !row.provider_order_id) return;

  // Auto-renew is per PACKAGE: a disconnect only turns it off when no sibling IP in the
  // same order is still serving a connected channel. The channel's new state is passed
  // in, so the decision never depends on whether its row was updated yet.
  await reconcileIproyalOrderRenewal(row.provider_order_id, {
    channelDbId,
    state: enabled ? 'connected' : 'disconnected',
  });
}

/**
 * Seamlessly move a channel onto a fresh IP WITHOUT a QR re-pair (auto-heal / manual
 * rotate). The WhatsApp credentials live independently of the egress, so
 * set-proxy + restart reconnects on the same creds.
 *
 * Steps: retire the channel's current (dead/expired) proxy -> 'dead' + disable its
 * auto-extend + unbind (frees the unique(assigned_channel_id) slot); claim a
 * replacement via claimProxyForChannel (reuse-first, else auto-buy - carrying the
 * IPQS screen + dirty-buy breaker + claim-time screen); then evoSetProxy +
 * evoRestartInstance. Auto-renew re-enables itself for the NEW IP when the channel's
 * connection handler sees it reconnect ('connected').
 *
 * Returns ok:false (with a reason) on any failure; the caller decides whether to
 * alert. Does NOT itself decide WHEN to swap - that's the auto-heal cron's job
 * (only after it confirms the old lease is genuinely expired, never while IPRoyal
 * still owes us the IP).
 */
export async function swapProxyForChannel(channelDbId: number): Promise<{ ok: boolean; reason?: string }> {
  const { data: ch } = await supabaseAdmin
    .from('whatsapp_channels')
    .select('evolution_instance_name, channel_token')
    .eq('id', channelDbId)
    .maybeSingle();
  const chRow = ch as { evolution_instance_name: string | null; channel_token: string | null } | null;
  if (!chRow?.evolution_instance_name) return { ok: false, reason: 'no evolution instance for channel' };

  // Retire the OLD proxy first so the unique(assigned_channel_id) frees for the claim.
  const { data: oldRows } = await supabaseAdmin
    .from('evolution_proxies')
    .select('id, provider, provider_order_id')
    .eq('assigned_channel_id', channelDbId);
  const nowIso = new Date().toISOString();
  const retiredOrders = new Set<string>();
  for (const r of (oldRows ?? []) as { id: number; provider: string | null; provider_order_id: string | null }[]) {
    if (r.provider === 'iproyal' && r.provider_order_id) {
      retiredOrders.add(r.provider_order_id);
    } else if (r.provider === 'brightdata' && r.provider_order_id) {
      // BD bills until deleted - drop the retired zone so we stop paying for it.
      void brightdataReleaseZone(r.provider_order_id).catch(() => {});
    }
    await supabaseAdmin
      .from('evolution_proxies')
      .update({ status: 'dead', assigned_channel_id: null, assigned_at: null, notes: 'retired by auto-heal swap', updated_at: nowIso } as never)
      .eq('id', r.id);
  }
  // Package rule: the retired IP's order stops renewing only if no sibling IP in it
  // still serves a connected channel.
  for (const orderId of retiredOrders) {
    await reconcileIproyalOrderRenewal(orderId);
  }

  // Claim a replacement (reuse-first, else auto-buy - screen + breaker apply).
  const claimed = await claimProxyForChannel(channelDbId);
  if (!claimed) return { ok: false, reason: 'no replacement proxy (pool empty + buy blocked/failed)' };

  // Apply seamlessly: set the new proxy, then restart to reconnect on stored creds.
  const setRes = await evoSetProxy({
    instanceName: chRow.evolution_instance_name,
    proxyUrl: claimed.proxyUrl,
    instanceToken: chRow.channel_token,
  });
  if (!setRes.ok) {
    reportError(new Error(`auto-heal: evoSetProxy failed for channel ${channelDbId}: ${setRes.error}`), {
      type: 'eng_alert:critical',
      metadata: { source: 'proxyPool.swapProxyForChannel.setProxy', channelDbId, newProxyId: claimed.id },
    });
    return { ok: false, reason: `set-proxy failed: ${setRes.error}` };
  }
  const restartRes = await evoRestartInstance({
    instanceName: chRow.evolution_instance_name,
    instanceToken: chRow.channel_token,
  });
  if (!restartRes.ok) {
    reportError(new Error(`auto-heal: evoRestartInstance failed for channel ${channelDbId}: ${restartRes.error}`), {
      type: 'eng_alert:critical',
      metadata: { source: 'proxyPool.swapProxyForChannel.restart', channelDbId, newProxyId: claimed.id },
    });
    return { ok: false, reason: `restart failed: ${restartRes.error}` };
  }
  console.log(`[proxy-heal] swapped channel ${channelDbId} onto proxy ${claimed.id} (set-proxy + restart, no QR)`);
  return { ok: true };
}

// Serialize buys within this process so two simultaneous connects that both find
// the pool empty can't each place an order. (Across multiple billing-server
// instances this doesn't serialize, but the max-pool cap still bounds the spend.)
let acquireLock: Promise<void> = Promise.resolve();
async function withAcquireLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = acquireLock;
  let release: () => void = () => {};
  acquireLock = new Promise<void>((r) => { release = r; });
  await prev.catch(() => {});
  try { return await fn(); } finally { release(); }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Does a request actually ROUTE through this proxy right now? IPQS only checks the
 * IP directly - it never proves the proxy's auth works or that it's active yet. A
 * freshly-bought IPRoyal IP is NOT auth-ready the instant it's provisioned:
 * Evolution's instance-create runs its own `testProxy` and 407s (Proxy Auth
 * Required) an unready one, rejecting the create. So we route a tiny HTTP request
 * THROUGH the proxy first. 2xx = routable; 407/timeout/refused = not (yet).
 */
export async function probeProxyRoutable(proxyUrl: string, timeoutMs = 8_000): Promise<boolean> {
  const p = parseProxyUrl(proxyUrl);
  if (!p) return false;
  try {
    const resp = await axios.get('http://api.ipify.org', {
      proxy: {
        protocol: p.protocol.startsWith('socks') ? 'http' : p.protocol,
        host: p.host,
        port: Number(p.port),
        auth: p.username ? { username: p.username, password: p.password ?? '' } : undefined,
      },
      timeout: timeoutMs,
      validateStatus: () => true,
    });
    return resp.status >= 200 && resp.status < 300;
  } catch {
    return false;
  }
}

/** Poll probeProxyRoutable with backoff, to ride out a fresh IP's activation lag. */
async function waitProxyRoutable(proxyUrl: string, backoffsMs: number[] = [0, 3_000, 5_000, 6_000, 8_000, 8_000]): Promise<boolean> {
  for (const delay of backoffsMs) {
    if (delay) await sleep(delay);
    if (await probeProxyRoutable(proxyUrl)) return true;
  }
  return false;
}

export type ProxyProvider = 'iproyal' | 'brightdata';

// Circuit breaker for dirty auto-buys, PER PROVIDER - the cost of a dirty buy differs
// hugely (a dirty IPRoyal buy wastes a full lease ~$4; a dirty BD buy deleted on the
// spot is a few cents via proration). Counters PERSIST across the whole process so a
// retry-storm can't rack up a runaway bill. When a provider's counter hits its limit:
// iproyal (config.evolutionProxyMaxDirtyBuys, default 1) -> SWITCH to BD; brightdata
// (config.evolutionProxyBdMaxDirtyBuys, default 20) -> TRIP the breaker + critical
// alert. A clean buy from a provider resets ITS counter. Self-heals after
// config.evolutionProxyDirtyBreakerResetMinutes since that provider's last dirty buy.
const dirtyByProvider: Record<ProxyProvider, number> = { iproyal: 0, brightdata: 0 };
const breakerAlerted: Record<ProxyProvider, boolean> = { iproyal: false, brightdata: false };
const lastDirtyAtMs: Record<ProxyProvider, number> = { iproyal: 0, brightdata: 0 };

function providerDirtyLimit(p: ProxyProvider): number {
  return p === 'brightdata' ? config.evolutionProxyBdMaxDirtyBuys : config.evolutionProxyMaxDirtyBuys;
}
function isProviderConfigured(p: ProxyProvider): boolean {
  return p === 'brightdata' ? isBrightdataConfigured() : isIproyalConfigured();
}
function otherProvider(p: ProxyProvider): ProxyProvider {
  return p === 'brightdata' ? 'iproyal' : 'brightdata';
}

interface ProvisionedProxy {
  ip: string;       // egress IP to IPQS-screen (for BD this is NOT the connection host)
  port: number;
  url: string;      // full proxy URL Evolution connects through
  orderId: string;  // iproyal: order id; brightdata: zone name (delete it to stop billing)
  provider: ProxyProvider;
}

/**
 * Buy + provision ONE proxy from the given PROVIDER and return the connection parts,
 * or null on ANY failure (create/poll/provision) - the caller treats null as an
 * ERROR and switches providers. SPENDS MONEY (one buy = one charge; prorated on BD).
 * Failures here alert non-critically (a single failed buy is handled by switching);
 * acquireNewProxy escalates to critical only when BOTH providers are exhausted.
 */
async function buyAndProvisionOne(provider: ProxyProvider): Promise<ProvisionedProxy | null> {
  if (provider === 'brightdata') {
    const res = await brightdataBuyOne();
    if (!res.ok || !res.body) {
      reportError(new Error(`Proxy auto-buy: Bright Data buy failed: ${res.error}`), {
        type: 'eng_alert', dedupe: 'silent',
        metadata: { source: 'proxyPool.buyAndProvisionOne.bd', status: res.status },
      });
      return null;
    }
    return { ip: res.body.egressIp, port: config.brightdataGatewayPort, url: res.body.url, orderId: res.body.zone, provider: 'brightdata' };
  }

  // IPRoyal (order-based).
  const created = await iproyalCreateOrder({
    productId: config.iproyalProductId,
    planId: config.iproyalPlanId,
    locationId: config.iproyalLocationId,
    quantity: 1,
  });
  if (!created.ok || !created.body?.orderId) {
    reportError(new Error(`Proxy auto-buy: IPRoyal order create failed: ${created.error}`), {
      type: 'eng_alert', dedupe: 'silent',
      metadata: { source: 'proxyPool.buyAndProvisionOne.create', status: created.status },
    });
    return null;
  }
  const orderId = created.body.orderId;
  // Poll for the provisioned proxy (IPRoyal confirms + attaches it a beat later).
  const backoffs = [3_000, 5_000, 5_000, 8_000, 8_000];
  for (const delay of backoffs) {
    await sleep(delay);
    const got = await iproyalGetOrderProxies(orderId, config.iproyalProductId);
    if (!got.ok || !got.body || got.body.pending) continue;
    const p = got.body.proxies[0];
    const port = got.body.httpPort;
    if (!p || port == null) continue;
    return {
      ip: p.ip,
      port,
      url: `http://${p.username}:${p.password}@${p.ip}:${port}`,
      orderId: String(orderId),
      provider: 'iproyal',
    };
  }
  // Order was created (and charged) but no proxy came back in time. Real alert (money
  // spent) - the orphan-import cron recovers it - and treat as an ERROR (switch).
  reportError(new Error(`Proxy auto-buy: IPRoyal order ${orderId} created but no proxy provisioned in time (orphan-import will recover it)`), {
    type: 'eng_alert',
    metadata: { source: 'proxyPool.buyAndProvisionOne.poll', orderId },
  });
  return null;
}

/**
 * Auto-buy: when the pool has no free proxy, buy a fresh ISP IP, IPQS-SCREEN it, and
 * (if clean + routable) add it to the pool already claimed for this channel. SPENDS
 * MONEY, so it is gated on config.evolutionProxyAutobuy === 'on', hard-capped
 * (evolutionProxyMaxPool), serialized in-process, and reuse-first upstream.
 *
 * TWO PROVIDERS with a bounded switching state machine (config.evolutionProxyProvider
 * sets which to START on, default 'iproyal'):
 *   - CLEAN  -> assign it; reset that provider's dirty counter.
 *   - DIRTY on IPRoyal -> record dead (audit; lease already paid), count it, and at
 *       its limit (evolutionProxyMaxDirtyBuys, default 1) SWITCH to Bright Data
 *       (each IPRoyal dirty wastes a full lease, so switch fast).
 *   - DIRTY on Bright Data -> DELETE the zone (BD bills until deleted) + record dead,
 *       count it, and STAY on BD retrying up to its (high) limit
 *       (evolutionProxyBdMaxDirtyBuys, default 20 ~ $1 via proration), then TRIP the
 *       breaker (critical alert). A dirty IP never switches BD->IPRoyal.
 *   - ERROR (create/poll/provision failed, e.g. API down or empty balance) -> SWITCH
 *       to the other provider, bounded by evolutionProxyMaxErrorSwitches (default 2)
 *       so an error ping-pong can't loop forever; when exhausted, critical alert.
 * Per-provider dirty counters PERSIST across calls (bounding total spend) and
 * self-heal after evolutionProxyDirtyBreakerResetMinutes. A failed/absent IPQS lookup
 * FAILS OPEN. Returns null on any terminal failure so 'required' mode fails the
 * connect loudly rather than silently sharing the host IP.
 */
async function acquireNewProxy(channelDbId: number): Promise<ClaimedProxy | null> {
  if (config.evolutionProxyAutobuy !== 'on') return null;

  // Resolve the starting provider; fall back to the other if it isn't configured.
  let provider: ProxyProvider = config.evolutionProxyProvider;
  if (!isProviderConfigured(provider)) {
    const alt = otherProvider(provider);
    if (isProviderConfigured(alt)) provider = alt;
    else {
      console.warn('[proxy-autobuy] pool empty but no proxy provider is configured, cannot buy.');
      // Config problem: with EVOLUTION_PROXY_MODE=required this makes every new
      // WhatsApp connect fail. Always an alert.
      reportError(new Error('Evolution proxy auto-buy: pool empty and no proxy provider is configured'), {
        type: 'evolution_proxy_no_provider',
        metadata: { source: 'proxyPool.acquireNewProxy.noProvider', configuredProvider: config.evolutionProxyProvider },
      });
      return null;
    }
  }

  return withAcquireLock(async () => {
    // Re-check inside the lock: a proxy may have been released while we waited.
    const { data: freed } = await supabaseAdmin
      .from('evolution_proxies')
      .select('id')
      .eq('status', 'available')
      .is('assigned_channel_id', null)
      .limit(1);
    if (freed && freed.length > 0) {
      // Let the caller's normal claim loop grab it on the next attempt.
      return null;
    }

    const resetMs = config.evolutionProxyDirtyBreakerResetMinutes * 60_000;
    const maxErrorSwitches = config.evolutionProxyMaxErrorSwitches;
    let errorSwitches = 0;
    // Final safety net so the loop always terminates even if the per-provider + error
    // bounds are misconfigured.
    const hardIterCap =
      config.evolutionProxyMaxDirtyBuys + config.evolutionProxyBdMaxDirtyBuys + maxErrorSwitches + 4;

    for (let iter = 0; iter < hardIterCap; iter++) {
      const limit = providerDirtyLimit(provider);

      // Self-heal a tripped provider breaker after its cooldown.
      if (dirtyByProvider[provider] >= limit && resetMs > 0 && Date.now() - lastDirtyAtMs[provider] >= resetMs) {
        console.log(`[proxy-autobuy] ${provider} dirty-breaker cooldown elapsed - re-enabling.`);
        dirtyByProvider[provider] = 0;
        breakerAlerted[provider] = false;
      }

      // Provider breaker already tripped: IPRoyal escalates to BD; anything else stops.
      if (dirtyByProvider[provider] >= limit) {
        if (provider === 'iproyal' && isProviderConfigured('brightdata')) {
          provider = 'brightdata';
          continue;
        }
        if (!breakerAlerted[provider]) {
          breakerAlerted[provider] = true;
          reportError(new Error(`Proxy auto-buy DISABLED: ${dirtyByProvider[provider]} consecutive dirty ${provider} IPs (limit ${limit}). Not buying more to avoid a runaway bill.`), {
            type: 'eng_alert:critical',
            metadata: { source: 'proxyPool.acquireNewProxy.breakerTripped', provider, dirty: dirtyByProvider[provider], limit },
          });
        }
        return null;
      }

      // Hard cap: never exceed the max pool size (non-dead rows). 'dead' rows (dirty
      // rejects) don't count, so this bounds only live IPs.
      const { count } = await supabaseAdmin
        .from('evolution_proxies')
        .select('id', { count: 'exact', head: true })
        .neq('status', 'dead');
      if ((count ?? 0) >= config.evolutionProxyMaxPool) {
        reportError(new Error(`Proxy auto-buy blocked: pool at cap (${count}/${config.evolutionProxyMaxPool})`), {
          type: 'eng_alert:critical',
          metadata: { source: 'proxyPool.acquireNewProxy.cap', count, cap: config.evolutionProxyMaxPool },
        });
        return null;
      }

      const prov = await buyAndProvisionOne(provider);
      if (!prov) {
        // ERROR: switch to the other provider, bounded by maxErrorSwitches.
        const alt = otherProvider(provider);
        if (isProviderConfigured(alt) && errorSwitches < maxErrorSwitches) {
          errorSwitches += 1;
          console.warn(`[proxy-autobuy] ${provider} buy ERROR -> switching to ${alt} (error switch ${errorSwitches}/${maxErrorSwitches})`);
          provider = alt;
          continue;
        }
        reportError(new Error(`Proxy auto-buy: could not acquire a proxy (${provider} errored; no fallback left, error switches ${errorSwitches}/${maxErrorSwitches}).`), {
          type: 'eng_alert:critical',
          metadata: { source: 'proxyPool.acquireNewProxy.bothFailed', provider, errorSwitches },
        });
        return null;
      }

      // Screen the fresh EGRESS IP (skipped entirely when IPQS isn't configured).
      const screen: IpqsResult | null = isIpqsConfigured() ? await ipqsCheckIp(prov.ip) : null;
      const nowIso = new Date().toISOString();
      const summary = screen ? ipqsHealthSummary(screen) : 'ipqs:disabled';
      const dirty = screen ? isIpDirty(screen, config.evolutionProxyFraudThreshold) : false;
      // `health` is a constrained enum ('ok' | 'failing' | null); the human summary +
      // score live in `notes` + `fraud_score`.
      const healthEnum: 'ok' | 'failing' | null = dirty ? 'failing' : (screen && screen.ok ? 'ok' : null);
      const scoreVal = screen?.fraudScore ?? null;

      if (dirty) {
        dirtyByProvider[provider] += 1;
        lastDirtyAtMs[provider] = Date.now();
        // BD bills until deleted, so DELETE the rejected zone; IPRoyal keeps its paid
        // lease. Either way record a 'dead' audit row (reuse-first never claims dead).
        if (prov.provider === 'brightdata') await brightdataReleaseZone(prov.orderId).catch(() => {});
        await supabaseAdmin.from('evolution_proxies').insert({
          proxy_url: prov.url,
          label: `${prov.provider} ISP ${prov.ip} (auto, REJECTED dirty)`,
          status: 'dead',
          provider: prov.provider,
          provider_order_id: prov.orderId,
          health: healthEnum,
          fraud_score: scoreVal,
          last_checked_at: nowIso,
          notes: prov.provider === 'brightdata'
            ? `auto-buy screen rejected + zone deleted: ${summary}`
            : `auto-buy screen rejected: ${summary}`,
          updated_at: nowIso,
        } as never);
        console.warn(`[proxy-autobuy] rejected dirty ${prov.provider} IP ${prov.ip} (${summary}): ${provider} dirty ${dirtyByProvider[provider]}/${limit}`);
        // Each rejected buy costs money; track it silently (the breaker trip
        // below already sends the real alert when it becomes a pattern).
        reportError(new Error(`Evolution proxy auto-buy rejected a dirty ${prov.provider} IP`), {
          type: 'evolution_proxy_autobuy_dirty',
          dedupe: 'silent',
          metadata: { source: 'proxyPool.acquireNewProxy.dirty', provider: prov.provider, ip: prov.ip, summary },
        });
        continue; // loop re-evaluates the breaker (may switch iproyal->bd or trip bd).
      }

      // Clean (or unscreened / fail-open). Reset this provider's breaker.
      dirtyByProvider[provider] = 0;
      breakerAlerted[provider] = false;

      // Verify it actually ROUTES before assigning (rides out activation lag).
      if (!(await waitProxyRoutable(prov.url))) {
        if (prov.provider === 'brightdata') {
          // BD idle bills, so never park it: delete the zone, record dead, and treat
          // as an ERROR (switch) since a non-routable BD IP is unusable.
          await brightdataReleaseZone(prov.orderId).catch(() => {});
          const bdIso = new Date().toISOString();
          await supabaseAdmin.from('evolution_proxies').insert({
            proxy_url: prov.url,
            label: `brightdata ISP ${prov.ip} (auto, not routable, deleted)`,
            status: 'dead',
            provider: 'brightdata',
            provider_order_id: prov.orderId,
            health: healthEnum,
            fraud_score: scoreVal,
            last_checked_at: bdIso,
            notes: `not routable within warm-up window; zone deleted. ${summary}`,
            updated_at: bdIso,
          } as never);
          const alt = otherProvider(provider);
          if (isProviderConfigured(alt) && errorSwitches < maxErrorSwitches) {
            errorSwitches += 1;
            console.warn(`[proxy-autobuy] BD IP ${prov.ip} not routable -> switching to ${alt} (error switch ${errorSwitches}/${maxErrorSwitches})`);
            provider = alt;
            continue;
          }
          reportError(new Error(`Proxy auto-buy: BD IP ${prov.ip} not routable and no fallback left.`), {
            type: 'eng_alert:critical',
            metadata: { source: 'proxyPool.acquireNewProxy.bdNotRoutable', ip: prov.ip, zone: prov.orderId },
          });
          return null;
        }
        // IPRoyal: park 'available' (paid lease warms up; a retry/reuse claims it).
        const parkIso = new Date().toISOString();
        await supabaseAdmin.from('evolution_proxies').insert({
          proxy_url: prov.url,
          label: `IPRoyal ISP ${prov.ip} (auto, warming)`,
          status: 'available',
          provider: 'iproyal',
          provider_order_id: prov.orderId,
          health: healthEnum,
          fraud_score: scoreVal,
          last_checked_at: parkIso,
          notes: summary === 'ipqs:disabled' ? 'not routable within warm-up window (parked to warm)' : `${summary}; not routable within warm-up window (parked to warm)`,
          updated_at: parkIso,
        } as never);
        reportError(new Error(`Proxy auto-buy: IPRoyal ${prov.ip} (order ${prov.orderId}) bought + clean but not routable within the warm-up window; parked 'available', connect failed this attempt (a retry reuses it once ready).`), {
          type: 'eng_alert',
          dedupe: 'silent',
          metadata: { source: 'proxyPool.acquireNewProxy.notRoutable', ip: prov.ip, orderId: prov.orderId },
        });
        return null;
      }

      // Lease expiry we can know at buy time from the plan LENGTH we just purchased
      // (IPRoyal plan 23 = 1 day, else 30 days) = now + that length. The heal cron
      // overwrites this with IPRoyal's exact expire_date on its next run, so any drift
      // self-corrects. Bright Data has no fixed lease (billed until the zone is
      // deleted), so leave it null. auto_extend is left null here and stamped by the
      // cron / connection handler once the channel's connect state settles.
      const leaseExpiresAt = prov.provider === 'iproyal'
        ? new Date(Date.now() + (config.iproyalPlanId === 23 ? 1 : 30) * 24 * 60 * 60 * 1000).toISOString()
        : null;
      // Routable + clean -> insert assigned to this channel.
      const { data: inserted, error: insErr } = await supabaseAdmin
        .from('evolution_proxies')
        .insert({
          proxy_url: prov.url,
          label: `${prov.provider} ISP ${prov.ip} (auto)`,
          status: 'assigned',
          assigned_channel_id: channelDbId,
          assigned_at: nowIso,
          provider: prov.provider,
          provider_order_id: prov.orderId,
          health: healthEnum,
          fraud_score: scoreVal,
          last_checked_at: nowIso,
          lease_expires_at: leaseExpiresAt,
          notes: summary === 'ipqs:disabled' ? null : summary,
          updated_at: nowIso,
        } as never)
        .select('id')
        .single();
      if (insErr || !inserted) {
        // Insert failed after a paid buy. For BD, delete the zone (else it bills for
        // an unusable IP); for IPRoyal the orphan-import cron recovers it.
        if (prov.provider === 'brightdata') await brightdataReleaseZone(prov.orderId).catch(() => {});
        reportError((insErr as unknown as Error) ?? new Error('auto-buy insert returned no row'), {
          type: 'eng_alert:critical',
          metadata: { source: 'proxyPool.acquireNewProxy.insert', provider: prov.provider, orderId: prov.orderId, ip: prov.ip },
        });
        return null;
      }
      // If IPQS was configured but the lookup itself failed, we assigned unscreened
      // (silent: transient, would flood during an IPQS outage).
      if (screen && !screen.ok) {
        reportError(new Error(`Proxy auto-buy: assigned ${prov.ip} UNSCREENED (IPQS lookup failed: ${screen.error})`), {
          type: 'eng_alert',
          dedupe: 'silent',
          metadata: { source: 'proxyPool.acquireNewProxy.unscreened', provider: prov.provider, ip: prov.ip, orderId: prov.orderId },
        });
      }
      console.log(`[proxy-autobuy] bought + assigned ${prov.provider} ${prov.ip}:${prov.port} (${prov.orderId}) to channel ${channelDbId} [${summary}]`);
      return { id: (inserted as { id: number }).id, proxyUrl: prov.url };
    }

    // Hard iteration cap hit (should be unreachable given the per-provider + error
    // bounds, but guarantees termination).
    reportError(new Error('Proxy auto-buy: hard iteration cap hit without acquiring a proxy.'), {
      type: 'eng_alert:critical',
      metadata: { source: 'proxyPool.acquireNewProxy.iterCap' },
    });
    return null;
  });
}
