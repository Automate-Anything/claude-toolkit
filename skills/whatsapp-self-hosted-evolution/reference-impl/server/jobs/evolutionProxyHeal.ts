/**
 * Evolution per-channel proxy AUTO-HEAL + pool reconciler (evolution/PROXY_PER_CHANNEL_PLAN.md).
 *
 * One BULK GET /orders sweep per run returns every lease's status, expire_date,
 * auto_extend_settings AND full proxy_data (ip/user/pass/ports) - so the entire
 * reconcile below runs with essentially NO per-proxy IPRoyal calls (the only extra
 * calls are: a renew/swap when actually healing, a routing probe / IPQS lookup when
 * reviving a dead row, and a toggle when auto-renew is actually mismatched).
 *
 * Passes (all gated on config.evolutionProxyAutoheal === 'on'):
 *   A. ORPHAN IMPORT   - an ACTIVE IPRoyal order with NO DB row (paid but lost, e.g.
 *      a buy whose insert failed) -> import its IP(s) as 'available'. Recovers spend.
 *   1. AVAILABLE CLEANUP - a pooled 'available' IP whose lease EXPIRED -> mark 'dead'
 *      (idle leases are meant to lapse; keeps connects from claiming a dead one).
 *   B. REVIVE DEAD-BUT-ALIVE - a 'dead' row whose lease is ACTIVE, that ROUTES, and
 *      is IPQS-clean -> revive to 'available' (undoes a row wrongly/transiently
 *      marked dead; a genuinely expired or dirty one stays dead).
 *   0. HEAL ASSIGNED-EXPIRED - an in-use IP whose lease EXPIRED -> renew same IP else
 *      seamless swap (no QR). Mass-expiry guard (card failure) + per-run cap + canary.
 *   C. RECONCILE AUTO-RENEW - auto-extend should be ON for a CONNECTED channel's IP,
 *      OFF otherwise. Checked for free from the list; toggled only on a mismatch
 *      (self-heals a missed connect/disconnect toggle).
 *
 * All alerts INTERNAL. Only DEAD/expired heals; a live IP gone DIRTY is the
 * merchant's own behavior (screened at connect, not policed during use).
 */
import { supabaseAdmin } from '../config/supabase.js';
import { config } from '../config/env.js';
import { reportError } from '../utils/errorReporter.js';
import { iproyalExtendOrder, iproyalListOrders, iproyalToggleAutoExtend, type IproyalOrderSummary } from '../whatsapp/evolution/iproyalClient.js';
import { swapProxyForChannel, probeProxyRoutable, releaseProxiesForChannels, orderRenewalFromStates } from '../whatsapp/evolution/proxyPool.js';
import { evoListInstances, evoRestartInstance } from '../whatsapp/evolution/evolutionClient.js';
import { isIpqsConfigured, ipqsCheckIp, isIpDirty, ipqsHealthSummary } from '../whatsapp/evolution/ipqsClient.js';

// Mass-expiry guard (ASSIGNED only): more than this many in-use leases expired at
// once => a payment/card failure, alert; don't mass-act.
// A channel we see as mid-reconnect ('reconnecting' / 'unknown') whose Evolution
// instance has been trying to connect for longer than this is treated as NOT serving
// anyone for auto-renew purposes (it would otherwise keep its package renewing forever).
const STUCK_RECONNECT_MS = 24 * 60 * 60 * 1000;
const MASS_EXPIRY_ABS = 3;
const MASS_EXPIRY_FRACTION = 0.5;
const MAX_FIXES_PER_RUN = 2;   // heal (renew/swap) cap
const ORPHAN_CAP = 10;         // imports per run
const REVIVE_CAP = 10;         // dead-but-alive revivals per run
const RECONCILE_CAP = 20;      // auto-renew toggles per run
const DEAD_SCAN_LIMIT = 100;   // most-recent dead rows to consider for revival

interface ProxyRow {
  id: number;
  status: string;
  provider_order_id: string | null;
  proxy_url: string;
  assigned_channel_id: number | null;
  lease_expires_at: string | null;
  auto_extend: boolean | null;
}
interface ChannelState {
  id: number;
  evolution_instance_name: string | null;
  channel_token: string | null;
  connection_state: string | null;
}

export interface ProxyHealResult {
  orphansImported: number;
  availableRetired: number;
  revived: number;
  healedByRenew: number;
  healedBySwap: number;
  autoRenewReconciled: number;
  massExpirySkip: boolean;
}

function ipOf(proxyUrl: string): string | null {
  try { return new URL(proxyUrl).hostname || null; } catch { return null; }
}

/** IPRoyal's expire_date is 'YYYY-MM-DD HH:MM:SS'; normalize to an ISO string (or null). */
function parseExpireIso(expireDate: string | null): string | null {
  if (!expireDate) return null;
  const t = Date.parse(expireDate.replace(' ', 'T'));
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

interface StampableRow {
  id: number;
  provider_order_id: string | null;
  lease_expires_at: string | null;
  auto_extend: boolean | null;
}

/**
 * Stamp lease_expires_at + auto_extend onto each proxy row from the IPRoyal order
 * sweep. Idempotent: writes ONLY when a value actually changed (so it never churns
 * updated_at). Returns the number of rows updated. Shared by the heal cron and the
 * on-demand superadmin sync.
 */
async function stampLeaseInfoRows(rows: StampableRow[], orderById: Map<string, IproyalOrderSummary>): Promise<number> {
  let stamped = 0;
  for (const r of rows) {
    if (!r.provider_order_id) continue;
    const o = orderById.get(r.provider_order_id);
    if (!o) continue;
    const nextLeaseIso = parseExpireIso(o.expireDate);
    const nextExtend = o.autoExtendEnabled;
    const curLeaseMs = r.lease_expires_at ? Date.parse(r.lease_expires_at) : null;
    const nextLeaseMs = nextLeaseIso ? Date.parse(nextLeaseIso) : null;
    if (curLeaseMs === nextLeaseMs && (r.auto_extend ?? null) === (nextExtend ?? null)) continue;
    await supabaseAdmin.from('evolution_proxies')
      .update({ lease_expires_at: nextLeaseIso, auto_extend: nextExtend, updated_at: new Date().toISOString() } as never)
      .eq('id', r.id);
    stamped += 1;
  }
  return stamped;
}

/**
 * On-demand pull of IPRoyal lease info (expiry + auto-renew) for the superadmin
 * "Sync from provider" button. Same INFO the heal cron stamps, but WITHOUT any of the
 * money-spending heal actions (renew/swap/retire) - a pure refresh. Safe to run by
 * hand and independent of EVOLUTION_PROXY_AUTOHEAL. (Bright Data has no lease/renew to
 * pull; its account balance is surfaced separately by the endpoint.)
 */
export async function syncEvolutionProxyLeaseInfo(): Promise<{ ok: boolean; stamped: number; orders: number; error?: string }> {
  const listRes = await iproyalListOrders(config.iproyalProductId);
  if (!listRes.ok || !listRes.body) {
    return { ok: false, stamped: 0, orders: 0, error: listRes.error ?? 'IPRoyal order list failed' };
  }
  const orderById = new Map<string, IproyalOrderSummary>();
  for (const o of listRes.body) orderById.set(o.orderId, o);
  const { data: liveRows } = await supabaseAdmin
    .from('evolution_proxies')
    .select('id, provider_order_id, lease_expires_at, auto_extend')
    .eq('provider', 'iproyal')
    .in('status', ['available', 'assigned']);
  const stamped = await stampLeaseInfoRows((liveRows ?? []) as StampableRow[], orderById);
  return { ok: true, stamped, orders: listRes.body.length };
}

export async function runEvolutionProxyHealJob(): Promise<ProxyHealResult> {
  const result: ProxyHealResult = {
    orphansImported: 0, availableRetired: 0, revived: 0, healedByRenew: 0, healedBySwap: 0,
    autoRenewReconciled: 0, massExpirySkip: false,
  };
  if (config.evolutionProxyAutoheal !== 'on') return result;

  // ── ONE bulk sweep: status + expiry + auto-renew + creds for every order.
  const listRes = await iproyalListOrders(config.iproyalProductId);
  if (!listRes.ok || !listRes.body) {
    reportError(new Error(`Proxy auto-heal: bulk order list failed (${listRes.error}); skipping run.`), {
      type: 'eng_alert', metadata: { source: 'evolutionProxyHeal.listOrders' },
    });
    return result;
  }
  const orderById = new Map<string, IproyalOrderSummary>();
  for (const o of listRes.body) orderById.set(o.orderId, o);

  // ── Our current pool rows (iproyal). available/assigned are small; cap the dead scan.
  const { data: liveRows } = await supabaseAdmin
    .from('evolution_proxies')
    .select('id, status, provider_order_id, proxy_url, assigned_channel_id, lease_expires_at, auto_extend')
    .eq('provider', 'iproyal')
    .in('status', ['available', 'assigned']);
  const { data: deadRows } = await supabaseAdmin
    .from('evolution_proxies')
    .select('id, status, provider_order_id, proxy_url, assigned_channel_id')
    .eq('provider', 'iproyal')
    .eq('status', 'dead')
    .order('updated_at', { ascending: false })
    .limit(DEAD_SCAN_LIMIT);
  const live = (liveRows ?? []) as ProxyRow[];
  const dead = (deadRows ?? []) as ProxyRow[];

  // Every order id / ip we already track (any status) - for orphan de-dupe. Use a
  // broad fetch of just the keys so we never re-import an order that has ANY row.
  const { data: allKeys } = await supabaseAdmin
    .from('evolution_proxies')
    .select('provider_order_id, proxy_url')
    .eq('provider', 'iproyal');
  const knownOrderIds = new Set<string>();
  const knownIps = new Set<string>();
  for (const r of (allKeys ?? []) as { provider_order_id: string | null; proxy_url: string }[]) {
    if (r.provider_order_id) knownOrderIds.add(r.provider_order_id);
    const ip = ipOf(r.proxy_url);
    if (ip) knownIps.add(ip);
  }

  // ── Pass A: ORPHAN IMPORT - active orders with no DB row -> import as available.
  for (const o of listRes.body) {
    if (result.orphansImported >= ORPHAN_CAP) break;
    if (o.expired || knownOrderIds.has(o.orderId) || o.httpPort == null || o.proxies.length === 0) continue;
    for (const p of o.proxies) {
      if (knownIps.has(p.ip)) continue;
      const url = `http://${p.username}:${p.password}@${p.ip}:${o.httpPort}`;
      const nowIso = new Date().toISOString();
      const { error } = await supabaseAdmin.from('evolution_proxies').insert({
        proxy_url: url,
        label: `IPRoyal ISP ${p.ip} (recovered orphan)`,
        status: 'available',
        provider: 'iproyal',
        provider_order_id: o.orderId,
        last_checked_at: nowIso,
        notes: 'cron: recovered orphaned paid order (no DB row existed)',
        updated_at: nowIso,
      } as never);
      if (!error) {
        knownIps.add(p.ip);
        knownOrderIds.add(o.orderId);
        result.orphansImported += 1;
        console.log(`[proxy-heal] imported orphan ${p.ip} (order ${o.orderId})`);
      }
    }
  }

  // ── Pass 1: AVAILABLE CLEANUP - pooled IP whose lease expired -> dead.
  for (const r of live) {
    if (r.status !== 'available' || !r.provider_order_id) continue;
    const o = orderById.get(r.provider_order_id);
    if (o?.expired) {
      const nowIso = new Date().toISOString();
      await supabaseAdmin.from('evolution_proxies')
        .update({ status: 'dead', notes: 'cron: available lease expired, retired', last_checked_at: nowIso, updated_at: nowIso } as never)
        .eq('id', r.id);
      result.availableRetired += 1;
    }
  }

  // ── Pass B: REVIVE DEAD-BUT-ALIVE - active lease + routes + IPQS-clean -> available.
  for (const r of dead) {
    if (result.revived >= REVIVE_CAP) break;
    if (!r.provider_order_id) continue;
    const o = orderById.get(r.provider_order_id);
    if (!o || o.expired) continue;                 // expired/unknown lease stays dead
    if (!(await probeProxyRoutable(r.proxy_url))) continue; // still not routable -> stays dead
    let scoreVal: number | null = null;
    let healthEnum: 'ok' | 'failing' | null = null;
    let noteSummary = 'routable';
    if (isIpqsConfigured()) {
      const ip = ipOf(r.proxy_url);
      if (ip) {
        const screen = await ipqsCheckIp(ip);
        if (isIpDirty(screen, config.evolutionProxyFraudThreshold)) continue; // genuinely dirty -> stays dead
        scoreVal = screen.fraudScore;
        healthEnum = screen.ok ? 'ok' : null;
        noteSummary = ipqsHealthSummary(screen);
      }
    }
    const nowIso = new Date().toISOString();
    await supabaseAdmin.from('evolution_proxies')
      .update({ status: 'available', assigned_channel_id: null, assigned_at: null, health: healthEnum, fraud_score: scoreVal, last_checked_at: nowIso, notes: `cron: revived (lease active + routable + clean): ${noteSummary}`, updated_at: nowIso } as never)
      .eq('id', r.id);
    result.revived += 1;
    console.log(`[proxy-heal] revived wrongly-dead proxy ${r.id} (order ${r.provider_order_id})`);
  }

  // ── Channels for the ASSIGNED rows (heal + reconcile need connection_state).
  const assigned = live.filter((r) => r.status === 'assigned' && r.assigned_channel_id != null && r.provider_order_id);
  const chById = new Map<number, ChannelState>();
  if (assigned.length > 0) {
    const { data: chs } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('id, evolution_instance_name, channel_token, connection_state')
      .in('id', assigned.map((a) => a.assigned_channel_id as number))
      .eq('provider', 'evolution')
      .neq('lifecycle_state', 'deleted');
    for (const c of (chs ?? []) as ChannelState[]) chById.set(c.id, c);
  }

  // ── Pass 0: HEAL ASSIGNED-EXPIRED - only for channels that are currently
  // CONNECTED. We spend (renew/swap) ONLY to keep a LIVE number's IP up. A channel
  // that's disconnected/logged-out (whether the user disconnected it or it dropped)
  // is deliberately allowed to lapse - auto-renew was turned off on disconnect, so
  // healing it would contradict that and pay for an IP nobody's using. (Reconcile
  // keeps connected channels' auto-renew ON, so a healthy connected channel won't
  // expire in the first place; this stays a backstop, incl. the in-grace proactive
  // renew while still connected.)
  const healCandidates = assigned.filter((a) => {
    const c = chById.get(a.assigned_channel_id as number);
    return c && c.connection_state === 'connected';
  });
  const expiredList = healCandidates.filter((a) => orderById.get(a.provider_order_id as string)?.expired);
  if (expiredList.length > 0) {
    if (expiredList.length > MASS_EXPIRY_ABS || (healCandidates.length > 0 && expiredList.length / healCandidates.length > MASS_EXPIRY_FRACTION)) {
      result.massExpirySkip = true;
      reportError(new Error(`Proxy auto-heal: ${expiredList.length}/${healCandidates.length} IN-USE leases expired at once - almost certainly a PAYMENT/CARD failure. Fix the card (IPROYAL_CARD_ID / balance); NOT mass-renewing.`), {
        type: 'eng_alert:critical',
        metadata: { source: 'evolutionProxyHeal.massExpiry', expired: expiredList.length, total: healCandidates.length },
      });
    } else {
      let fixes = 0;
      for (const ap of expiredList) {
        if (fixes >= MAX_FIXES_PER_RUN) break;
        fixes += 1;
        const ch = chById.get(ap.assigned_channel_id as number);
        const orderId = ap.provider_order_id as string;
        const ext = await iproyalExtendOrder({ orderId, planId: config.iproyalPlanId });
        if (ext.ok && ch?.evolution_instance_name) {
          const rs = await evoRestartInstance({ instanceName: ch.evolution_instance_name, instanceToken: ch.channel_token });
          if (rs.ok) { result.healedByRenew += 1; console.log(`[proxy-heal] renewed order ${orderId} + restarted channel ${ap.assigned_channel_id}`); continue; }
        }
        const sw = await swapProxyForChannel(ap.assigned_channel_id as number);
        if (!sw.ok) {
          reportError(new Error(`Proxy auto-heal: could not heal channel ${ap.assigned_channel_id} (order ${orderId} expired; renew + swap failed: ${sw.reason}). Stopping this run.`), {
            type: 'eng_alert:critical',
            metadata: { source: 'evolutionProxyHeal.healFailed', channelDbId: ap.assigned_channel_id, orderId, reason: sw.reason },
          });
          break;
        }
        result.healedBySwap += 1;
        console.log(`[proxy-heal] healed channel ${ap.assigned_channel_id} via swap (order ${orderId} expired)`);
      }
    }
  }

  // ── Pass C: RECONCILE AUTO-RENEW, per PACKAGE. IPRoyal's auto-renew is one switch per
  // ORDER, shared by every IP in a multi-IP package, so the decision is made per order
  // from ALL of its assigned IPs (orderRenewalFromStates: on if any serves a connected
  // channel; left alone while one is mid-reconnect; off otherwise). Deciding per IP made
  // siblings in different states flip the package back and forth. Free to CHECK (from
  // the list); a toggle API call happens ONLY on a genuine mismatch.
  // A channel our DB sees as mid-reconnect is left undecided, so a brief blip never
  // turns renewal off. But one STUCK like that would keep its package renewing forever,
  // so for those (only) ask Evolution directly, ONE bulk call per run and only when
  // needed: 'open' -> connected, 'close' -> disconnected, 'connecting' since its last
  // disconnect more than STUCK_RECONNECT_MS ago -> stuck, not serving. Anything else,
  // or Evolution unreachable, stays undecided (leave the switch as it is).
  const isDefinite = (s: string | null) => s === 'connected' || s === 'disconnected' || s === 'needs_qr' || s === 'banned';
  const needsEvolution = assigned.some((a) => {
    const ch = chById.get(a.assigned_channel_id as number);
    return ch != null && !isDefinite(ch.connection_state);
  });
  const evoByName = new Map<string, { status: string | null; disconnectedAtMs: number | null }>();
  if (needsEvolution) {
    const list = await evoListInstances();
    for (const inst of (list.ok ? list.body ?? [] : [])) {
      const name = typeof inst?.name === 'string' ? inst.name : null;
      if (!name) continue;
      const status = typeof inst.connectionStatus === 'string' ? inst.connectionStatus : null;
      const disc = typeof inst.disconnectionAt === 'string' ? Date.parse(inst.disconnectionAt) : NaN;
      evoByName.set(name, { status, disconnectedAtMs: Number.isNaN(disc) ? null : disc });
    }
  }
  const effectiveState = (ch: ChannelState | undefined): string | null => {
    // An IP still 'assigned' to a deleted/missing channel serves nobody (Pass E releases it).
    if (!ch) return 'released';
    if (isDefinite(ch.connection_state)) return ch.connection_state;
    const inst = ch.evolution_instance_name ? evoByName.get(ch.evolution_instance_name) : undefined;
    if (!inst) return ch.connection_state; // Evolution unreachable / not listed: stay undecided
    if (inst.status === 'open') return 'connected';
    if (inst.status === 'close') return 'disconnected';
    if (inst.status === 'connecting' && inst.disconnectedAtMs != null && Date.now() - inst.disconnectedAtMs > STUCK_RECONNECT_MS) {
      return 'disconnected';
    }
    return ch.connection_state;
  };

  const statesByOrder = new Map<string, (string | null)[]>();
  for (const a of assigned) {
    const orderId = a.provider_order_id as string;
    const list = statesByOrder.get(orderId) ?? [];
    list.push(effectiveState(chById.get(a.assigned_channel_id as number)));
    statesByOrder.set(orderId, list);
  }
  // Packages with NO assigned IP (all pooled 'available', or retired 'dead' while the
  // lease still runs) serve nobody, so they must not renew (orderRenewalFromStates([])
  // is false). This pass used to look only at assigned IPs, so a package left renewing
  // (a release whose switch failed, a manual dashboard toggle, an IP retired as dirty,
  // which never touched renewal) kept paying for idle IPs every 30 days, unnoticed.
  for (const r of [...live, ...dead]) {
    if (r.provider_order_id && !statesByOrder.has(r.provider_order_id)) statesByOrder.set(r.provider_order_id, []);
  }
  let toggles = 0;
  for (const [orderId, states] of statesByOrder) {
    if (toggles >= RECONCILE_CAP) break;
    const o = orderById.get(orderId);
    if (!o || o.expired || o.autoExtendEnabled == null) continue; // unknown/expired -> leave to the heal pass
    const desired = orderRenewalFromStates(states);
    if (desired === null) continue; // a channel is mid-reconnect: the connection handler owns that edge
    if (o.autoExtendEnabled === desired) continue; // already correct
    const res = await iproyalToggleAutoExtend({ orderId, planId: config.iproyalPlanId, enabled: desired });
    if (res.ok) {
      toggles += 1;
      result.autoRenewReconciled += 1;
      // Pass D stamps rows from orderById, which was read BEFORE this switch; record the
      // new value so the rows (and the superadmin pool view) show it now, not next hour.
      o.autoExtendEnabled = desired;
      console.log(`[proxy-heal] reconciled auto-renew ${desired ? 'ON' : 'OFF'} for order ${orderId} (states=${states.join(',')})`);
    }
  }

  // ── Pass D: STAMP LEASE INFO - persist each IPRoyal lease's expiry + auto-renew
  // from the bulk sweep onto the proxy row, so the superadmin pool view can show them
  // with NO live IPRoyal call. Idempotent: writes only when a value actually changed.
  const leaseStamped = await stampLeaseInfoRows(live, orderById);

  // ── Pass E: ORPHAN-PROXY SWEEP - release any proxy still 'assigned' to a channel that
  // no longer exists or is soft-deleted. Safety net: if a teardown path ever misses (a
  // release/purge that didn't clean up), this turns off IPRoyal auto-extend (stops the
  // ~$4/mo leak) and returns the IP to the pool / deletes the BD zone. Covers BOTH
  // providers (release helper handles each). Cost-SAVING only, never a buy.
  let orphansReleased = 0;
  {
    const { data: assignedRows } = await supabaseAdmin
      .from('evolution_proxies')
      .select('assigned_channel_id')
      .eq('status', 'assigned')
      .not('assigned_channel_id', 'is', null);
    const assignedChannelIds = [...new Set(
      ((assignedRows ?? []) as { assigned_channel_id: number }[]).map((r) => r.assigned_channel_id),
    )];
    if (assignedChannelIds.length > 0) {
      const { data: liveChannels } = await supabaseAdmin
        .from('whatsapp_channels')
        .select('id')
        .in('id', assignedChannelIds)
        .eq('provider', 'evolution')
        .neq('lifecycle_state', 'deleted');
      const liveIds = new Set(((liveChannels ?? []) as { id: number }[]).map((c) => c.id));
      const orphanIds = assignedChannelIds.filter((id) => !liveIds.has(id));
      if (orphanIds.length > 0) {
        await releaseProxiesForChannels(orphanIds);
        orphansReleased = orphanIds.length;
        reportError(new Error(`Proxy orphan sweep released ${orphanIds.length} proxy(ies) assigned to deleted/absent channel(s): ${orphanIds.join(', ')}`), {
          type: 'eng_alert',
          dedupe: 'silent',
          escalateAfter: 5,
          metadata: { source: 'evolutionProxyHeal.orphanSweep', channelIds: orphanIds },
        });
      }
    }
  }

  console.log(`[proxy-heal] orphans=${result.orphansImported} availableRetired=${result.availableRetired} revived=${result.revived} renewed=${result.healedByRenew} swapped=${result.healedBySwap} autoRenewReconciled=${result.autoRenewReconciled} leaseStamped=${leaseStamped} orphansReleased=${orphansReleased} massExpirySkip=${result.massExpirySkip}`);
  return result;
}
