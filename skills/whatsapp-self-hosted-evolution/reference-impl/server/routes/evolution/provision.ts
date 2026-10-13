/**
 * Evolution API provisioning routes - the self-hosted twin of the WHAPI
 * create-channel / create-qr / request-code / health-check / logout /
 * delete-channel / set-webhook routes. They write to the SAME whatsapp_channels
 * table (with provider='evolution') and RETURN THE SAME RESPONSE SHAPES the
 * frontend already parses, so the UI needs zero changes:
 *   - create-channel → { channel_id, base64, expire, login_method? }
 *     (channel_id = our Evolution instance name; base64 = Evolution's QR PNG,
 *      which the UI already accepts as a pre-generated image.)
 *   - create-qr     → [{ qr_status, qr_row_data | base64, channel_id, ... }]
 *   - request-code  → [{ code, expire }]
 *   - health-check  → [{ connected, user, channel_status }]
 *   - logout / delete-channel → { success }
 *
 * These are mounted UNDER /api/whapi and /api/whatsapp only when the create
 * dispatcher chooses Evolution; the dispatcher lives in
 * routes/whatsapp/createChannelDispatch.ts and picks the provider, so the
 * frontend keeps calling the same /api/whapi/create-channel URL.
 *
 * IDOR: operations that target an EXISTING channel reuse authorizeChannelRequest
 * - but that guard keys on WHAPI channel_id. Evolution rows are keyed by
 * evolution_instance_name (which we ALSO store in channel_id for uniformity, see
 * createEvolutionChannel), so the same guard works.
 */
import { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { config } from '../../config/env.js';
import { supabaseAdmin } from '../../config/supabase.js';
import { reportError } from '../../utils/errorReporter.js';
import {
  evoCreateInstance,
  evoConnect,
  evoConnectionState,
  evoLogout,
  evoDeleteInstance,
  evoListInstances,
  isEvolutionConfigured,
  isEvoInvalidProxy,
  evolutionInboundWebhookUrlFor,
} from '../../whatsapp/evolution/evolutionClient.js';
import { connectionStateFromEvolution } from '../../whatsapp/evolution/evolutionConnectionState.js';
import {
  isProxyModeRequired,
  claimProxyForChannel,
  releaseProxyForChannel,
  releaseProxiesForChannels,
} from '../../whatsapp/evolution/proxyPool.js';
import { WHATSAPP_UNPAIRED_COMM_VALUE } from '../whapi/helpers.js';
import { getPublicLocations } from '../../utils/locations.js';
import { validateSubscriptionLimit } from '../platform/subscription-limits.js';

/** One entry from Evolution's /instance/fetchInstances list (shape varies by
 *  version, so every field is optional). */
interface EvolutionInstanceListEntry {
  instance?: { instanceName?: string };
  name?: string;
  instanceName?: string;
  [key: string]: unknown;
}

/**
 * Generate a UNIQUE Evolution instance name for a company.
 * Human-readable prefix (company + a bit of the channel name) PLUS a random
 * token, so two creates NEVER collide. We store it in BOTH evolution_instance_name
 * AND channel_id, and lookups (authorizeChannelRequest, the whapi routers'
 * channel_id-keyed queries) key on channel_id - so a collision means two rows
 * share a channel_id and .maybeSingle() throws "multiple rows".
 *
 * The old version derived the whole suffix from the channel name only, so every
 * create with the default name ("WhatsApp Channel" -> "hannel") produced the SAME
 * name and piled up duplicate channel_ids, which broke every authed op on the
 * channel (2026-08-30). The random token removes that class entirely. Each create
 * is a new channel/instance, so a fresh name is correct; reconnect reuses the
 * stored name and is unaffected.
 */
function makeInstanceName(companyId: string, seed: string): string {
  const shortCompany = companyId.replace(/-/g, '').slice(0, 8);
  const base = seed.replace(/[^a-zA-Z0-9]/g, '').slice(-6) || 'x';
  const unique = randomUUID().replace(/-/g, '').slice(0, 6);
  return `bp_${shortCompany}_${base}_${unique}`;
}

/**
 * The distinct whatsapp_channels ids that a location's live communication_map
 * rows point at. Used by createEvolutionChannel to reconcile / gate a reconnect.
 */
async function getLocationLinkedChannelIds(companyId: string, locationId: string): Promise<number[]> {
  const { data } = await supabaseAdmin
    .from('communication_map')
    .select('connected_to_whatsapp_channel_id')
    .eq('company_id', companyId)
    .eq('location_id', locationId)
    .eq('channel', 'whatsapp')
    .eq('is_deleted', false)
    .not('connected_to_whatsapp_channel_id', 'is', null);
  return Array.from(new Set(
    (data ?? [])
      .map((r) => (r as { connected_to_whatsapp_channel_id: number | null }).connected_to_whatsapp_channel_id)
      .filter((v): v is number => v != null),
  ));
}

/**
 * Create a fresh Evolution channel: insert the DB row, create the instance on
 * Evolution wired to our inbound webhook, persist the per-instance token, and
 * return the UI-compatible create-channel response.
 */
export async function createEvolutionChannel(req: Request, res: Response): Promise<void> {
  if (!isEvolutionConfigured()) {
    res.status(503).json({ success: false, error: 'Evolution API not configured on this server' });
    return;
  }

  const {
    company_id,
    channel_name,
    login_method,
    phone_number,
    timezone,
  } = req.body ?? {};
  let { location_id } = req.body ?? {};
  const channelName = channel_name || 'WhatsApp Channel';

  if (!company_id || typeof company_id !== 'string') {
    res.status(400).json({ success: false, error: 'company_id is required' });
    return;
  }

  // ─── Location resolution (parity with WHAPI create-channel) ─────────
  // Default to the sole public location; require an explicit one when >1.
  if (!location_id) {
    const pub = await getPublicLocations(company_id);
    if (pub.count === 0) {
      res.status(400).json({ success: false, error: 'company has no public location - create one first', code: 'no_public_location' });
      return;
    }
    if (pub.count > 1) {
      res.status(400).json({ success: false, error: 'location_id is required when the company has more than one public location', code: 'location_id_required' });
      return;
    }
    location_id = pub.soleId;
  }

  // ─── Reconcile vanished Evolution instances FIRST (before any gate) ──
  // Our DB is not proof that a channel still exists. An instance deleted OUT OF
  // BAND (Evolution Manager UI, or a rebuilt/wiped Evolution service) never tells
  // us, so the row keeps reading deleted_at=NULL and inflates BOTH gates below:
  // the subscription-limit count AND the one-channel-per-location guard. The
  // operator is then blocked from connecting a replacement while the "existing"
  // channel is in fact dead and every inbound media on it 404s. That was a dead
  // end escapable only by hand (we hit it on 2026-08-27, and again on the first
  // fix attempt because this ran AFTER the limit gate and never reached it).
  //
  // So do it FIRST: ask Evolution whether each of this location's linked instances
  // is really there, and retire the ones that are gone (same cleanup as
  // deleteEvolutionChannel). Every gate below then counts a vanished channel as
  // gone.
  //
  // Fail SAFE: only retire on a DEFINITIVE answer (a successful instance list that
  // does not contain the name). If the Evolution API call fails we cannot tell
  // "gone" from "unreachable", so we leave the row intact and let the gates stand
  // rather than risk retiring a channel that is actually alive.
  const linkedChannelIds = await getLocationLinkedChannelIds(company_id, location_id);
  if (linkedChannelIds.length > 0) {
    const { data: liveLinked } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('id, provider, evolution_instance_name')
      .in('id', linkedChannelIds)
      .is('deleted_at', null);
    const evoLinked = ((liveLinked ?? []) as unknown as {
      id: number;
      provider: string | null;
      evolution_instance_name: string | null;
    }[]).filter((c) => c.provider === 'evolution' && c.evolution_instance_name);

    if (evoLinked.length > 0) {
      const list = await evoListInstances();
      if (list.ok && Array.isArray(list.body)) {
        // Evolution has moved this shape around across versions, so read all
        // three spellings rather than trusting one.
        type EvoInstanceListItem = {
          instance?: { instanceName?: unknown };
          name?: unknown;
          instanceName?: unknown;
        };
        const liveNames = new Set(
          list.body
            .map((i) => {
              const item = i as EvoInstanceListItem;
              return item.instance?.instanceName ?? item.name ?? item.instanceName;
            })
            .filter((n): n is string => typeof n === 'string'),
        );
        const vanished = evoLinked.filter((c) => !liveNames.has(c.evolution_instance_name!));
        if (vanished.length > 0) {
          const nowIso = new Date().toISOString();
          const vanishedIds = vanished.map((c) => c.id);
          await supabaseAdmin
            .from('communication_map')
            .update({ connected_to_whatsapp_channel_id: null, communication_value: WHATSAPP_UNPAIRED_COMM_VALUE })
            .in('connected_to_whatsapp_channel_id', vanishedIds);
          await supabaseAdmin
            .from('location_prompt_variables')
            .update({ whatsapp_confirmation_channel: null })
            .in('whatsapp_confirmation_channel', vanishedIds);
          await supabaseAdmin
            .from('whatsapp_channels')
            .update({ lifecycle_state: 'deleted', deleted_at: nowIso, channel_token: null, disconnected_at: nowIso })
            .in('id', vanishedIds);
          // Return their proxies to the pool (T4) - a vanished instance is gone
          // for good, so its dedicated IP must not stay leaked as 'assigned'.
          await releaseProxiesForChannels(vanishedIds);
          reportError(
            new Error(`Evolution instance(s) vanished out of band, auto-retired: ${vanished.map((c) => c.evolution_instance_name).join(', ')}`),
            {
              // NOT silent: this fires only when an operator is actively adding a
              // channel and we discover the previous instance is gone, so it is
              // low-volume and always worth a look (who deleted it, was Evolution
              // wiped). The merchant also has to re-pair their phone as a result.
              type: 'evolution_instance_vanished',
              metadata: {
                source: 'createEvolutionChannel.reconcile',
                company_id,
                location_id,
                channelIds: vanishedIds,
              },
            },
          );
        }
      }
    }
  }

  // ─── Subscription-limit gate (parity) ───────────────────────────────
  // Runs AFTER the reconcile above, so a vanished instance no longer counts.
  const limit = await validateSubscriptionLimit(company_id, 'whatsapp_channels', location_id ?? null);
  if (!limit.allowed) {
    res.status(403).json({ success: false, error: limit.error || 'WhatsApp channel limit reached', code: 'limit_reached' });
    return;
  }

  // ─── One live channel per location (parity) ─────────────────────────
  // The reconcile above already retired any dead instance, so a remaining live
  // linked channel here is a genuinely-live one and blocking is correct.
  {
    const stillLinkedIds = await getLocationLinkedChannelIds(company_id, location_id);
    if (stillLinkedIds.length > 0) {
      const { data: liveLinked } = await supabaseAdmin
        .from('whatsapp_channels')
        .select('id')
        .in('id', stillLinkedIds)
        .is('deleted_at', null)
        .limit(1);
      if ((liveLinked ?? []).length > 0) {
        res.status(409).json({ success: false, error: 'this location already has a WhatsApp channel', code: 'location_has_channel' });
        return;
      }
    }
  }

  // Instance name: stable + unique. Seed from a monotonic-ish source we can pass
  // in the body, else fall back to the channel name. (No Date.now() reliance for
  // determinism in tests; created rows carry created_at from the DB.)
  const seed = String(req.body?.seed ?? channelName ?? location_id ?? company_id);
  const instanceName = makeInstanceName(company_id, seed);

  // Insert the channel row FIRST (provider=evolution), so an inbound webhook that
  // races the create can resolve the row. channel_token filled after create.
  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('whatsapp_channels')
    .insert({
      company_id,
      channel_name: channelName,
      provider: 'evolution',
      evolution_instance_name: instanceName,
      // Store instance name in channel_id too so channel_id-keyed guards/queries
      // resolve Evolution rows uniformly with WHAPI rows.
      channel_id: instanceName,
      channel_status: 'pending',
      pool_state: 'claimed',
      connection_state: 'unknown',
      // Self-hosted: no WHAPI funding lifecycle. Mark funded so funding crons
      // (which only touch whapi rows anyway) never flag it.
      funding_status: 'active',
    } as never)
    .select('id, company_id, channel_name')
    .single();

  if (insertErr || !inserted) {
    reportError(new Error(`Evolution channel insert failed: ${insertErr?.message}`), {
      type: 'evolution_provision_failed',
      metadata: { source: 'createEvolutionChannel.insert', company_id, instanceName },
    });
    res.status(500).json({ success: false, error: 'Failed to create channel record' });
    return;
  }
  const channelDbId = inserted.id as number;

  // ─── Per-channel proxy claim (evolution/PROXY_PER_CHANNEL_PLAN.md T3) ────
  // Give this channel its OWN egress IP so a WhatsApp ban on one shared IP can't
  // cascade across merchants. In 'required' mode a connect with no free proxy
  // FAILS LOUDLY - we never silently fall back to the shared host IP, which would
  // defeat the whole point. In 'off' mode (owner test) this is skipped and the
  // instance shares the host IP. The claimed URL is written to evolution_proxy_url
  // AND passed to evoCreateInstance (Evolution applies it at instance-create).
  let claimedProxyUrl: string | null = null;
  let claimedProxyId: number | null = null;
  if (isProxyModeRequired()) {
    const claimed = await claimProxyForChannel(channelDbId);
    if (!claimed) {
      // No capacity. Roll back the row and refuse - do NOT share the host IP.
      await supabaseAdmin.from('whatsapp_channels').delete().eq('id', channelDbId);
      // Generic message (company/location go in METADATA, not the text) so a pool-exhaustion
      // event dedupes to ONE critical alert instead of one per company trying to connect.
      reportError(new Error(`No Evolution proxy capacity for a new channel - proxy mode is 'required' and the pool has no free IP (autobuy off or exhausted)`), {
        type: 'eng_alert:critical',
        metadata: { source: 'createEvolutionChannel.claimProxy', company_id, location_id },
      });
      res.status(503).json({
        success: false,
        error: 'No proxy capacity available to connect a new WhatsApp channel right now. Please try again shortly.',
        code: 'no_proxy_capacity',
      });
      return;
    }
    claimedProxyUrl = claimed.proxyUrl;
    claimedProxyId = claimed.id;
    await supabaseAdmin
      .from('whatsapp_channels')
      .update({ evolution_proxy_url: claimedProxyUrl } as never)
      .eq('id', channelDbId);
  }

  // Create the instance on Evolution, wired to our inbound webhook.
  const wantPairingCode = login_method === 'phone_code';
  const created = await evoCreateInstance({
    instanceName,
    webhookUrl: evolutionInboundWebhookUrlFor(instanceName),
    pairingNumber: wantPairingCode ? phone_number : undefined,
    proxyUrl: claimedProxyUrl, // null in 'off' mode -> no proxy (shared host IP)
  });

  if (!created.ok || !created.body) {
    // Roll back the DB row so a failed create doesn't leave an orphan. Also
    // release the proxy we just claimed so it returns to the pool (not leaked
    // as 'assigned' to a channel that never came up).
    await releaseProxyForChannel(channelDbId);
    if (claimedProxyId !== null && isEvoInvalidProxy(created)) {
      // Evolution still rejects this proxy after riding out the single-source hold, so it
      // genuinely does not route from Evolution. Retire it instead of returning it to the
      // pool, where the next connect would claim it and fail the same way. The heal cron's
      // dead-but-alive pass restores it once it routes again.
      const deadIso = new Date().toISOString();
      await supabaseAdmin
        .from('evolution_proxies')
        .update({ status: 'dead', health: 'failing', notes: 'create: Evolution rejected it (Invalid proxy) after hold retries', last_checked_at: deadIso, updated_at: deadIso } as never)
        .eq('id', claimedProxyId)
        .eq('status', 'available');
    }
    await supabaseAdmin.from('whatsapp_channels').delete().eq('id', channelDbId);
    reportError(new Error(`Evolution instance create failed: ${created.error}`), {
      type: 'evolution_provision_failed',
      metadata: { source: 'createEvolutionChannel.evoCreate', company_id, instanceName, status: created.status },
    });
    res.status(502).json({ success: false, error: created.error || 'Evolution instance create failed' });
    return;
  }

  // Persist the per-instance token (used as apikey for later per-instance calls).
  if (created.body.token) {
    await supabaseAdmin
      .from('whatsapp_channels')
      .update({ channel_token: created.body.token } as never)
      .eq('id', channelDbId);
  }

  // ─── Wire communication_map (parity with WHAPI create-channel step 2b) ──
  // Without this the channel is created but NOT bound to its location, so
  // inbound never routes and the location shows "Not assigned". Reconnect-aware:
  // reattach the location's existing row, else insert fresh.
  //
  // "Reattachable" is deliberately BROADER than "FK IS NULL". Our own disconnect
  // path nulls the FK, but an instance deleted OUT OF BAND (someone removes it in
  // the Evolution Manager UI, or the Evolution service is rebuilt) never runs that
  // path, so the row keeps pointing at a now-dead channel. A NULL-only match then
  // finds nothing and INSERTS a second row for the same location+phone. Repeat that
  // per reconnect and the location accumulates duplicate mappings that all match the
  // phone; resolveCompanyContext ties on (active, location_id) and can pick a DEAD
  // one, whose instance name Evolution answers with a permanent 404 "instance does
  // not exist". Inbound TEXT still works (it never calls Evolution), so the failure
  // is invisible except that every voice/image silently stays pending. Cost us a full
  // debugging session on 2026-08-27 (4 rows, resolver picked the deleted one).
  // So: also treat a row whose linked channel is deleted as reattachable.
  if (location_id) {
    const { data: candidateMaps } = await supabaseAdmin
      .from('communication_map')
      .select('id, connected_to_whatsapp_channel_id, whatsapp_channels(lifecycle_state)')
      .eq('company_id', company_id)
      .eq('location_id', location_id)
      .eq('channel', 'whatsapp')
      .eq('is_deleted', false)
      .order('created_at', { ascending: false });

    // Reattachable = unbound (FK null) OR bound to a channel that is gone/deleted.
    const existingMap = (candidateMaps ?? []).find((row) => {
      const r = row as unknown as {
        id: string;
        connected_to_whatsapp_channel_id: number | null;
        whatsapp_channels: { lifecycle_state: string | null } | null;
      };
      if (r.connected_to_whatsapp_channel_id == null) return true;
      const state = r.whatsapp_channels?.lifecycle_state ?? null;
      return state === null || state === 'deleted';
    }) as { id: string } | undefined;

    let liveMapId: string | null = null;

    if (existingMap?.id) {
      const { error: updErr } = await supabaseAdmin
        .from('communication_map')
        .update({ connected_to_whatsapp_channel_id: channelDbId, communication_value: channelName } as never)
        .eq('id', existingMap.id);
      if (updErr) {
        reportError(updErr as unknown as Error, {
          type: 'whatsapp_commmap_wire_failed',
          metadata: { source: 'createEvolutionChannel.reattach', channelDbId, company_id, location_id },
        });
      } else {
        liveMapId = existingMap.id;
      }
    } else {
      const { data: insertedMap, error: mapErr } = await supabaseAdmin
        .from('communication_map')
        .insert({
          company_id,
          location_id,
          connected_to_whatsapp_channel_id: channelDbId,
          channel: 'whatsapp',
          communication_value: channelName,
          timezone: timezone || null,
          active: false,
          test_environment: true,
        } as never)
        .select('id')
        .maybeSingle();
      if (mapErr) {
        reportError(mapErr as unknown as Error, {
          type: 'whatsapp_commmap_wire_failed',
          metadata: { source: 'createEvolutionChannel.insert', channelDbId, company_id, location_id },
        });
      } else {
        liveMapId = (insertedMap as { id: string } | null)?.id ?? null;
      }
    }

    // ─── Exactly ONE live whatsapp mapping per location ──────────────────
    // A location can only have one WhatsApp channel (enforced by the 409 guard
    // above), so it must only ever have one non-deleted whatsapp communication_map
    // row. Retire every other one here, at the moment we wire the new mapping.
    //
    // This is the structural backstop for the resolver: resolveCompanyContext
    // matches comm_map rows by PHONE and tie-breaks on (active, location_id). When
    // several rows share a location they tie, and the winner is arbitrary: on
    // 2026-08-27 it picked a row bound to a deleted channel, so every inbound
    // voice/image asked Evolution for a dead instance name and 404'd forever while
    // text kept working. Guaranteeing one row makes that tie impossible to create,
    // rather than relying on cleanup after the fact.
    if (liveMapId) {
      // Clear active + FK alongside is_deleted so the retired row leaves the
      // one-active-whatsapp-per-location partial index immediately (the index is
      // scoped to active=true AND FK NOT NULL AND is_deleted=false). Leaving
      // active/FK set kept retired rows in the index and collided with the next
      // reattach (alert #2903).
      const { error: retireErr } = await supabaseAdmin
        .from('communication_map')
        .update({ is_deleted: true, active: false, connected_to_whatsapp_channel_id: null } as never)
        .eq('company_id', company_id)
        .eq('location_id', location_id)
        .eq('channel', 'whatsapp')
        .eq('is_deleted', false)
        .neq('id', liveMapId);
      if (retireErr) {
        reportError(retireErr as unknown as Error, {
          type: 'whatsapp_commmap_wire_failed',
          metadata: { source: 'createEvolutionChannel.retireDuplicates', channelDbId, company_id, location_id },
        });
      }
    }
  }

  // Pairing-code flow: no QR image, return channel_id + login_method so the UI
  // shows the code-entry path (the UI already handles login_method:'phone_code').
  if (wantPairingCode) {
    res.json({
      channel_id: instanceName,
      login_method: 'phone_code',
      code: created.body.pairingCode ?? '',
      expire: null,
    });
    return;
  }

  // QR flow: return Evolution's base64 QR PNG. The UI accepts `base64` as a
  // pre-generated image (Integrations.tsx isPreGeneratedImage path).
  res.json({
    channel_id: instanceName,
    base64: normalizeQrBase64(created.body.qrBase64),
    expire: null,
    channel_name: inserted.channel_name,
  });
}

/** Evolution returns base64 sometimes with, sometimes without the data: prefix.
 *  The UI accepts both, but normalize to a data URL so <img src> always works. */
function normalizeQrBase64(b64: string | null): string {
  if (!b64) return '';
  if (b64.startsWith('data:image')) return b64;
  return `data:image/png;base64,${b64}`;
}

/**
 * Refresh the QR for an existing Evolution channel. Twin of /create-qr.
 * Returns the SAME array shape the WHAPI create-qr returns, with the QR delivered
 * as base64 (the UI extracts qr_row_data OR base64).
 */
export async function createEvolutionQr(channel: EvolutionChannelRow, res: Response): Promise<void> {
  // The canonical webhook config (base64:false) is applied by the /set-webhook
  // dispatch handler, which the operator UI calls right after a channel pairs
  // (for BOTH the QR and pairing-code paths). So no per-connect re-sync is needed
  // here - keeping it in one place (set-webhook) covers every connect path.
  const conn = await evoConnect({ instanceName: channel.evolution_instance_name!, instanceToken: channel.channel_token });
  if (!conn.ok || !conn.body) {
    // A channel that CREATES but can't refresh its QR / pair is otherwise invisible (the
    // UI just loops on 'TIMEOUT'). evoConnect never throws, so nothing else captures this.
    // Track it silently (a single transient blip is benign) but escalate a spike - a wave
    // of un-pairable channels (Evolution down, instance 404'd out of band, auth broken).
    reportError(new Error(`Evolution QR refresh failed for channel ${channel.id} (${channel.evolution_instance_name}): ${conn.error ?? 'no error text'} [status ${conn.status ?? 'none'}${conn.networkError ? ', network' : ''}]`), {
      type: 'eng_alert',
      dedupe: 'silent',
      escalateAfter: 10,
      metadata: { source: 'provision.createEvolutionQr.evoConnect', channelDbId: channel.id, instanceName: channel.evolution_instance_name, status: conn.status, networkError: conn.networkError ?? false },
    });
    res.json([{
      qr_status: 'TIMEOUT',
      expire_time: null,
      qr_row_data: '',
      base64: '',
      channel_id: channel.channel_id,
      company_id: channel.company_id,
      channel_name: channel.channel_name,
    }]);
    return;
  }
  // If the instance is already open, tell the UI it's authenticated.
  if (conn.body.state === 'open') {
    res.json([{
      qr_status: 'already_authenticated',
      expire_time: null,
      qr_row_data: '',
      channel_id: channel.channel_id,
      company_id: channel.company_id,
      channel_name: channel.channel_name,
    }]);
    return;
  }
  // Prefer the raw QR string so the frontend renders the QR itself (styled,
  // WhatsApp-like). Fall back to Evolution's pre-baked base64 PNG only if the raw
  // code is missing.
  const rawCode = conn.body.qrCode;
  res.json([{
    qr_status: 'SUCCESS',
    expire_time: null,
    qr_row_data: rawCode || '',
    base64: rawCode ? '' : normalizeQrBase64(conn.body.qrBase64),
    channel_id: channel.channel_id,
    company_id: channel.company_id,
    channel_name: channel.channel_name,
  }]);
}

/**
 * Request a phone pairing code. Twin of /request-code.
 *
 * WARM-UP + GRACEFUL, exactly like the WHAPI twin (routes/whapi/code.ts): a
 * freshly created Evolution instance is not ready to mint a pairing code for the
 * first several seconds. On the first GET /instance/connect it commonly returns a
 * QR but NO pairing code yet (state 'connecting'). A single immediate attempt
 * therefore races the not-yet-ready instance and misses.
 *
 * The old code returned HTTP 502 on that first miss. That was wrong on BOTH ends:
 * the frontend's validateWebhookResponse pages engineering on any non-2xx (a
 * warm-up race is not an engineering fault, so it was pure alert noise), and it
 * dropped the user onto the scary "Setup Failed" screen instead of the calm
 * "still getting ready" retry state the frontend already has for status:'not_ready'
 * (Integrations.tsx). This fired alert #2824.
 *
 * So we now WARM UP (poll on a short backoff) and, if the budget drains without a
 * code, return HTTP 200 with the frontend's retryable {status:'not_ready'} shape.
 * The frontend then carries the rest of the warm-up across its OWN auto-retries,
 * shows a neutral notice, and no alert is minted. A genuine unexpected exception
 * still throws out of here → the dispatch catch → next(err) → a real 5xx+alert.
 */
const EVO_CODE_MAX_ATTEMPTS = 4;
const EVO_CODE_RETRY_DELAY_MS = 3_000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function requestEvolutionCode(
  channel: EvolutionChannelRow,
  phoneNumber: string,
  res: Response,
): Promise<void> {
  let lastError: string | null = null;
  for (let attempt = 1; attempt <= EVO_CODE_MAX_ATTEMPTS; attempt++) {
    const conn = await evoConnect({
      instanceName: channel.evolution_instance_name!,
      instanceToken: channel.channel_token,
      pairingNumber: phoneNumber,
    });

    if (conn.ok && conn.body?.pairingCode) {
      res.json([{ code: conn.body.pairingCode, expire: null, channel_id: channel.channel_id }]);
      return;
    }

    lastError = conn.error ?? null;
    console.warn(
      `[Evolution Code] Attempt ${attempt}/${EVO_CODE_MAX_ATTEMPTS} for ${channel.channel_id}: no pairing code yet` +
      `${conn.ok ? ` (state=${conn.body?.state ?? 'unknown'})` : ` (connect failed: ${conn.error ?? 'unknown'})`}`,
    );

    if (attempt < EVO_CODE_MAX_ATTEMPTS) {
      await sleep(EVO_CODE_RETRY_DELAY_MS);
    }
  }

  // Budget drained without a code. This is the normal "fresh instance needs a bit
  // longer" tail (or a transient Evolution blip). Return the frontend's calm,
  // retryable shape with HTTP 200 - the frontend auto-retries and shows a neutral
  // "still getting ready" notice. NOT an engineering fault; do NOT page.
  console.warn(`[Evolution Code] No pairing code after ${EVO_CODE_MAX_ATTEMPTS} attempts for ${channel.channel_id} (lastError=${lastError ?? 'none'})`);
  // Not a fault on its own (see above), so SILENT: visible in the alerts list
  // for frequency, and it escalates to an email only if it becomes common.
  reportError(new Error(`Evolution pairing code not ready after ${EVO_CODE_MAX_ATTEMPTS} attempts`), {
    type: 'evolution_pairing_code_not_ready',
    dedupe: 'silent',
    escalateAfter: 20,
    metadata: { source: 'routes.evolution.provision.requestCode', channelId: channel.channel_id, lastError: lastError ?? null },
  });
  res.json([{
    status: 'not_ready',
    error: 'WhatsApp is still getting ready. Hang on a moment and we will try again, or use the QR code instead.',
    channel_id: channel.channel_id,
  }]);
}

/** Health / connection check. Twin of /health-check. */
export async function evolutionHealthCheck(channel: EvolutionChannelRow, res: Response): Promise<void> {
  const st = await evoConnectionState({ instanceName: channel.evolution_instance_name!, instanceToken: channel.channel_token });
  const canonical = connectionStateFromEvolution(st.body?.state ?? null);
  const connected = canonical === 'connected';

  // Keep the DB connection_state fresh on every health poll (the UI polls this).
  await supabaseAdmin
    .from('whatsapp_channels')
    .update({
      connection_state: canonical,
      connection_checked_at: new Date().toISOString(),
      ...(connected ? { channel_status: 'channel logged in', pool_state: 'paired' } : {}),
    } as never)
    .eq('id', channel.id)
    .neq('lifecycle_state', 'deleted');

  res.json([{
    connected,
    user: connected ? { id: channel.phone_number } : null,
    channel_status: connected ? 'channel logged in' : 'channel disconnected',
  }]);
}

/** Logout the instance (drop the companion link) without deleting the row. */
export async function evolutionLogout(channel: EvolutionChannelRow, res: Response): Promise<void> {
  await evoLogout({ instanceName: channel.evolution_instance_name!, instanceToken: channel.channel_token });
  await supabaseAdmin
    .from('whatsapp_channels')
    .update({
      channel_status: 'channel logged out',
      pool_state: 'disconnected',
      connection_state: 'needs_qr',
      connection_checked_at: new Date().toISOString(),
      disconnected_at: new Date().toISOString(),
    } as never)
    .eq('id', channel.id)
    .neq('lifecycle_state', 'deleted');
  res.json({ success: true });
}

/**
 * Delete an Evolution channel: delete the instance on Evolution, then soft-delete
 * the row (mirrors deleteWhatsAppChannelFull's audit-archive approach). Also
 * verifies deletion async, alerting if the instance survives.
 */
export async function deleteEvolutionChannel(channel: EvolutionChannelRow, res: Response): Promise<void> {
  const del = await evoDeleteInstance({ instanceName: channel.evolution_instance_name!, instanceToken: channel.channel_token });
  // 404 = already gone = fine. Any other non-ok = bail without touching DB so
  // the operator can retry (no phantom state), mirroring the WHAPI delete guard.
  if (!del.ok && del.status !== 404) {
    // Log the REAL reason so a "could not delete" that the operator had to retry is
    // diagnosable (timeout vs 502 vs 401 vs network) instead of a silent 502 to the UI.
    reportError(new Error(`Evolution instance delete failed for channel ${channel.id} (${channel.evolution_instance_name}): ${del.error ?? 'no error text'} [status ${del.status ?? 'none'}${del.networkError ? ', network' : ''}]`), {
      type: 'eng_alert',
      metadata: {
        source: 'provision.deleteEvolutionChannel.evoDelete',
        channelDbId: channel.id,
        instanceName: channel.evolution_instance_name,
        status: del.status,
        networkError: del.networkError ?? false,
        error: del.error,
      },
    });
    res.status(502).json({ success: false, error: del.error || 'Evolution instance delete failed' });
    return;
  }

  const nowIso = new Date().toISOString();
  // Soft-delete the channel + unwire communication_map (preserve chat history),
  // matching softDisconnectWhatsAppChannel's shape.
  await supabaseAdmin
    .from('communication_map')
    .update({ connected_to_whatsapp_channel_id: null, communication_value: WHATSAPP_UNPAIRED_COMM_VALUE } as never)
    .eq('connected_to_whatsapp_channel_id', channel.id);
  await supabaseAdmin
    .from('location_prompt_variables')
    .update({ whatsapp_confirmation_channel: null } as never)
    .eq('whatsapp_confirmation_channel', channel.id);
  await supabaseAdmin
    .from('whatsapp_channels')
    .update({
      lifecycle_state: 'deleted',
      deleted_at: nowIso,
      channel_token: null,
      disconnected_at: nowIso,
    } as never)
    .eq('id', channel.id);

  // Return this channel's dedicated proxy to the pool (T4) so it can be reused.
  await releaseProxyForChannel(channel.id);

  // Async verify: if the instance STILL exists on Evolution after it has had time
  // to finish tearing down, alert for manual cleanup. Evolution acknowledges
  // DELETE /instance/delete as soon as it accepts it, but the actual teardown
  // (closing the Baileys socket, sweeping the instance out of its in-memory
  // registry that fetchInstances reads) completes a beat later. A single check
  // fired hundreds of ms after the delete therefore sees the instance mid-teardown
  // and false-alarms on EVERY delete (proven in prod: one account minted
  // three `evolution_delete_verification_failed` alerts, one per recycled channel,
  // each ~200-400ms after its delete, every instance actually gone). So poll with
  // backoff and only alert if it survives ALL attempts - a genuine leak persists,
  // the eventual-consistency race clears within a retry. Real signal kept, noise gone.
  void (async () => {
    const VERIFY_DELAYS_MS = [1500, 3000, 5000]; // total ~9.5s of grace before we call it a leak
    const instanceStillListed = async (): Promise<boolean | null> => {
      const list = await evoListInstances();
      // Only a DEFINITIVE list is trustworthy: on an API/network error we can't
      // tell present from absent, so return null (inconclusive) and let the retry
      // loop try again rather than risk a false "gone" that hides a real leak.
      if (!list.ok || !Array.isArray(list.body)) return null;
      // evoListInstances returns the raw-client EvoRawBody[] (instance = {token,state});
      // a fetchInstances entry actually carries instance.instanceName/name/instanceName,
      // which is exactly what EvolutionInstanceListEntry models. Re-label at the use-site.
      return (list.body as unknown as EvolutionInstanceListEntry[]).some((i) =>
        (i?.instance?.instanceName ?? i?.name ?? i?.instanceName) === channel.evolution_instance_name);
    };

    let lastDefinitive: boolean | null = null;
    for (const delay of VERIFY_DELAYS_MS) {
      await sleep(delay);
      const present = await instanceStillListed();
      if (present === false) return; // instance confirmed gone - the delete landed, no alert
      if (present === true) lastDefinitive = true; // still there; give it another attempt
      // present === null (list failed): inconclusive, try the next window
    }

    // Only alert on a DEFINITIVE, sustained "still present". If every check was
    // inconclusive (Evolution unreachable the whole window) we do NOT alert here -
    // that is a separate Evolution-down condition, not a leaked instance.
    if (lastDefinitive === true) {
      reportError(new Error(`Evolution instance ${channel.evolution_instance_name} marked deleted in DB but still on Evolution`), {
        type: 'evolution_delete_verification_failed',
        metadata: { instance: channel.evolution_instance_name, channelDbId: channel.id, company_id: channel.company_id },
      });
    }
  })();

  res.json({ success: true });
}

/** The channel-row shape these handlers operate on. */
export interface EvolutionChannelRow {
  id: number;
  company_id: string | null;
  channel_id: string | null;
  channel_name: string | null;
  channel_token: string | null;
  phone_number: string | null;
  evolution_instance_name: string | null;
}
