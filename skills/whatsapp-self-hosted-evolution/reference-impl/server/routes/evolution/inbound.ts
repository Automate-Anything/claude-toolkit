/**
 * POST /api/evolution/inbound
 *
 * Receives Evolution API webhook deliveries (inbound messages + connection-state
 * events) and routes them into the SAME inbound pipeline WHAPI uses. This is the
 * Evolution twin of routes/whapi/inbound.ts - same contract downstream, only the
 * payload shape + receiving-phone resolution differ.
 *
 * ⚠️ DO NOT ADD AUTH MIDDLEWARE. Like WHAPI, Evolution posts no auth header we
 * control. The URL secrecy IS the guard (we register the URL on our own instances
 * via /instance/create). The path is on the no-origin allowlist in index.ts. If
 * you ever want stronger protection, bake a token into the URL path and register
 * that on instance create.
 *
 * Evolution event envelope:
 *   { event: 'messages.upsert' | 'connection.update' | 'qrcode.updated' | ...,
 *     instance: '<our instance name>', data: {...} }
 *
 * Response: 200 immediately; process fire-and-forget (Evolution retries non-200).
 */
import { Router, Request, Response } from 'express';
import { reportError } from '../../utils/errorReporter.js';
import { supabaseAdmin } from '../../config/supabase.js';
import { normalizeEvolutionInbound, isEvolutionGroupJid } from '../../inbound/normalizerEvolution.js';
import { processInboundMessage } from '../../inbound/inboundMessageService.js';
import { connectionStateFromEvolution, isEvolutionBan } from '../../whatsapp/evolution/evolutionConnectionState.js';
import { setProxyAutoExtendForChannel } from '../../whatsapp/evolution/proxyPool.js';
import { wasSentByEvolutionApi } from '../../whatsapp/evolution/sentMessageTracker.js';
import { markChannelReconnected, channelKeyFor } from '../../services/channelDisconnectNotifyState.js';
import { handleConfirmedBan } from '../../whapi/banGuard.js';
import { applyOutboundDeliveryStatus, applyStatusView } from '../../inbound/handleStatusEvent.js';
import { config } from '../../config/env.js';
import {
  verifyEvolutionWebhookToken,
  evoSetWebhook,
  evolutionInboundWebhookUrlFor,
} from '../../whatsapp/evolution/evolutionClient.js';

export const evolutionInboundRouter = Router();

interface ResolvedChannel {
  id: number;
  company_id: string | null;
  phone_number: string | null;
  channel_name: string | null;
}

/** A single Evolution message key (the Baileys WAMessageKey shape we read). */
interface EvolutionMessageKey {
  id?: string;
  fromMe?: boolean;
  remoteJid?: string;
  [key: string]: unknown;
}

/** One Evolution `messages.upsert` / `send.message` data item. */
interface EvolutionMessageData {
  key?: EvolutionMessageKey;
  [key: string]: unknown;
}

/** The `connection.update` event data payload. */
interface EvolutionConnectionData {
  state?: string;
  statusReason?: number;
  statusCode?: number;
  lastDisconnect?: { error?: { output?: { statusCode?: number } } };
  wuid?: string;
  me?: { id?: string };
  [key: string]: unknown;
}

/** The top-level Evolution webhook envelope. */
interface EvolutionWebhookBody {
  event?: string;
  instance?: string;
  data?: EvolutionMessageData | EvolutionMessageData[] | EvolutionConnectionData;
  [key: string]: unknown;
}

/**
 * Resolve a channel row from the Evolution instance name. Returns the channel's
 * DB id, company, phone number, and name. Scoped to non-deleted rows so a reused
 * instance name never resurrects an archived channel.
 */
async function resolveChannelByInstance(instanceName: string): Promise<ResolvedChannel | null> {
  const { data, error } = await supabaseAdmin
    .from('whatsapp_channels')
    .select('id, company_id, phone_number, channel_name')
    .eq('evolution_instance_name', instanceName)
    .eq('provider', 'evolution')
    .neq('lifecycle_state', 'deleted')
    .maybeSingle();
  if (error || !data) return null;
  return data as ResolvedChannel;
}

const handleEvolutionInbound = async (req: Request, res: Response): Promise<void> => {
  // Per-instance webhook token guard (Option A). When EVOLUTION_WEBHOOK_SECRET is set,
  // a delivery must carry the correct HMAC token for its instance (tokened path
  // /inbound/:token); a forged POST or the legacy tokenless path is rejected. Unset =
  // no token required (backward-compatible). Runs BEFORE the 200 ACK.
  if (config.evolutionWebhookSecret) {
    const rawInst = (req.body as { instance?: unknown } | null | undefined)?.instance;
    const inst = typeof rawInst === 'string' ? rawInst : '';
    const token = typeof req.params.token === 'string' ? req.params.token : undefined;
    if (!verifyEvolutionWebhookToken(inst, token)) {
      // Per-rejection silence is correct (forged/scanner POSTs would flood a loud alert),
      // but track frequency: if the secret is enabled/rotated while our own instances still
      // carry the old-or-no token, EVERY legit inbound 401s and all inbound goes dark - a
      // spike escalates ONCE so we notice our own config broke.
      reportError(new Error(`Evolution inbound webhook token rejected (instance ${inst || 'none'})`), {
        type: 'evolution_inbound_token_rejected',
        dedupe: 'silent',
        escalateAfter: 50,
        metadata: { source: 'routes.evolution.inbound.tokenGuard', instance: inst || null },
      });
      res.status(401).json({ error: 'invalid webhook token' });
      return;
    }
  }
  // ACK immediately; process after responding.
  res.status(200).json({ ok: true });

  const body = req.body as EvolutionWebhookBody;
  const rawEvent = typeof body?.event === 'string' ? body.event : '';
  const event = rawEvent.toLowerCase();
  const instanceName = typeof body?.instance === 'string' ? body.instance : '';

  if (!instanceName) {
    // Without the instance we cannot resolve the channel. Surface it - a webhook
    // with no instance is a misconfiguration.
    reportError(new Error('Evolution inbound missing instance name'), {
      type: 'evolution_inbound_missing_instance',
      metadata: { source: 'routes.evolution.inbound', event: rawEvent },
    });
    return;
  }

  // ─── Connection-state events ────────────────────────────────────────
  if (event === 'connection.update') {
    void handleConnectionUpdate(instanceName, body?.data as EvolutionConnectionData | undefined).catch((err) => {
      reportError(err instanceof Error ? err : new Error(String(err)), {
        type: 'evolution_inbound_process_failed',
        metadata: { route: '/api/evolution/inbound', stage: 'connection.update', instance: instanceName },
      });
    });
    return;
  }

  // QR refresh - informational (the connect endpoint returns QR on demand).
  if (event === 'qrcode.updated') {
    return;
  }

  // ─── Delivery / read receipts ───────────────────────────────────────
  // Evolution's messages.update carries the Baileys ack for OUR outbound
  // messages (sent -> delivered -> read/played, or failed). Feed each into the
  // SAME forward-progression writer WHAPI uses so the ✓/✓✓/blue ticks render
  // identically across providers.
  if (event === 'messages.update') {
    const items: EvolutionStatusUpdateData[] = Array.isArray(body?.data)
      ? body.data
      : [body?.data as EvolutionStatusUpdateData];
    for (const data of items) {
      void handleMessageStatusUpdate(data).catch((err) => {
        // Delivery/read receipts (tick marks) are cosmetic - a failed write isn't a 3am page,
        // but track frequency so a systemic receipt failure still escalates once.
        reportError(err instanceof Error ? err : new Error(String(err)), {
          type: 'evolution_inbound_process_failed',
          dedupe: 'silent',
          escalateAfter: 50,
          metadata: { route: '/api/evolution/inbound', stage: 'messages.update', instance: instanceName },
        });
      });
    }
    return;
  }

  // ─── Edits ──────────────────────────────────────────────────────────
  // A message was edited (by the customer, or on the merchant's own phone). Our
  // Evolution fork decrypts WhatsApp's encrypted edit envelope into this event.
  if (event === 'messages.edited') {
    void handleMessageEdited(instanceName, body?.data as EvolutionEditedData | undefined).catch((err) => {
      reportError(err instanceof Error ? err : new Error(String(err)), {
        type: 'evolution_inbound_process_failed',
        metadata: { route: '/api/evolution/inbound', stage: 'messages.edited', instance: instanceName },
      });
    });
    return;
  }

  // ─── Deletes ────────────────────────────────────────────────────────
  // A message was deleted for everyone (by the customer, on the merchant's phone, or
  // by us from the inbox, whose echo re-applies the same state).
  if (event === 'messages.delete') {
    void handleMessageDeleted(instanceName, body?.data as { id?: unknown } | undefined).catch((err) => {
      reportError(err instanceof Error ? err : new Error(String(err)), {
        type: 'evolution_inbound_process_failed',
        metadata: { route: '/api/evolution/inbound', stage: 'messages.delete', instance: instanceName },
      });
    });
    return;
  }

  // ─── Message events ─────────────────────────────────────────────────
  if (event === 'messages.upsert' || event === 'send.message') {
    // Evolution may deliver data as an object or an array of messages.
    const items: EvolutionMessageData[] = Array.isArray(body?.data)
      ? body.data
      : [body?.data as EvolutionMessageData];
    for (const data of items) {
      void handleInboundMessage(instanceName, data, event).catch((err) => {
        reportError(err instanceof Error ? err : new Error(String(err)), {
          type: 'evolution_inbound_process_failed',
          metadata: { route: '/api/evolution/inbound', stage: 'messages.upsert', instance: instanceName },
        });
      });
    }
    return;
  }

  // Everything else (contacts.upsert, calls, etc.) - no-op for now. Logged
  // lightly so a new event we should handle is discoverable.
  // (Intentionally silent to avoid webhook-noise alerts.)
};

// Register the legacy tokenless path AND the per-instance tokened path. The handler
// validates the token when EVOLUTION_WEBHOOK_SECRET is set (see the guard at the top);
// with the secret unset, both paths behave exactly as before.
evolutionInboundRouter.post('/inbound', handleEvolutionInbound);
evolutionInboundRouter.post('/inbound/:token', handleEvolutionInbound);

/**
 * Handle one inbound message. Drops echoes (fromMe) and group chats, resolves the
 * receiving phone from the instance, normalizes, and hands to processInboundMessage.
 */
async function handleInboundMessage(instanceName: string, data: EvolutionMessageData, event: string): Promise<void> {
  const key = data?.key;
  if (!key) return;

  // Drop the echo of a message WE sent, but KEEP a fromMe message the merchant
  // typed on their own phone.
  //
  // Evolution re-delivers our own sends as a fromMe messages.upsert (we don't
  // subscribe to SEND_MESSAGE), so a blanket `fromMe` drop also threw away genuine
  // reply-from-phone messages - which WHAPI keeps and routes to the staff-from-own-
  // phone / human-takeover branch (it tells them apart via source==='api'). Baileys
  // gives our API sends no such marker, so we match by the id we recorded at send
  // time (sentMessageTracker): our echoes drop, a fromMe we did NOT send is a
  // merchant reply-from-phone and flows through to processInboundMessage.
  const msgId = typeof key?.id === 'string' ? key.id : null;
  if (wasSentByEvolutionApi(msgId)) {
    return;
  }
  // Defensive: we don't subscribe to SEND_MESSAGE, but if that ever changes it is
  // always our own outbound and must be dropped.
  if (event === 'send.message') {
    return;
  }

  // Drop group chats (mirrors WHAPI's @g.us filter).
  if (isEvolutionGroupJid(key.remoteJid)) {
    return;
  }

  // Drop WhatsApp Status (Stories): a customer's own status, and the echo of a
  // status WE posted (evolutionStatus.ts). The echo tracker usually catches ours,
  // but it is in-memory, so a restart between send and echo would otherwise turn
  // the status into a "message to status@broadcast" with no phone number.
  if (key.remoteJid === 'status@broadcast') {
    return;
  }

  // Resolve the receiving business phone authoritatively from OUR DB (never
  // trust the payload for routing). This is the Evolution equivalent of WHAPI's
  // ?phone_number= query param.
  const channel = await resolveChannelByInstance(instanceName);
  if (!channel) {
    reportError(new Error(`Evolution inbound for unknown/deleted instance ${instanceName}`), {
      type: 'evolution_inbound_unknown_instance',
      dedupe: 'silent',
      escalateAfter: 25,
      metadata: { source: 'routes.evolution.inbound', instance: instanceName, messageId: key?.id ?? null },
    });
    return;
  }
  if (!channel.phone_number) {
    // Instance exists but hasn't finished pairing (no phone yet). A message
    // arriving before pairing completes is unexpected but not fatal - drop it.
    console.warn(`[Evolution Inbound] instance ${instanceName} has no phone_number yet; dropping message ${key?.id}`);
    // A customer message is being DROPPED. Can happen briefly while a fresh
    // pairing finishes, so track it silently; a pattern escalates to an email.
    reportError(new Error('Evolution inbound dropped: channel has no phone_number yet'), {
      type: 'evolution_inbound_dropped_no_phone',
      dedupe: 'silent',
      escalateAfter: 10,
      metadata: { source: 'routes.evolution.inbound.noPhone', instance: instanceName, messageId: key?.id ?? null },
    });
    return;
  }

  const normalized = normalizeEvolutionInbound({
    data,
    receivingPhone: channel.phone_number,
  });
  if (!normalized) {
    console.log('[Evolution Inbound] normalizer returned null; skipping');
    return;
  }

  // Never save a message with nothing to show. WhatsApp sends several envelope types
  // that are not messages of their own, and each was saved as an EMPTY bubble (7
  // Evolution rows by 2026-10-07, from customers and merchants' own phones):
  //   - secretEncryptedMessage: an EDIT, encrypted with the original message's secret
  //     and pointing at it. Baileys/Evolution cannot read it yet, so it arrived as a
  //     new message with no text. The decrypted edit, once our Evolution fork can
  //     produce it, updates the original row instead.
  //   - albumMessage: the "N photos coming" header of a multi-photo send; each photo
  //     then arrives as its own message.
  // Rule (not a per-type list, so a type WhatsApp adds later cannot bring the empty
  // bubble back): a text-type message with no text and no reaction/reply link is
  // dropped. The two known envelopes drop quietly; anything else is reported silently
  // so a real message type we fail to read shows up in the alerts instead of vanishing.
  if (normalized.message_type === 'text' && !normalized.messageBody.trim() && !normalized.reference) {
    const messageType = typeof data.messageType === 'string' ? data.messageType : 'unknown';
    if (messageType !== 'secretEncryptedMessage' && messageType !== 'albumMessage') {
      reportError(new Error(`Evolution inbound: dropped a message with no readable content (${messageType})`), {
        type: 'api_error',
        dedupe: 'silent',
        metadata: {
          source: 'evolutionInbound.handleInboundMessage.emptyContent',
          instance: instanceName,
          messageType,
          contentKeys: Object.keys((data.message as Record<string, unknown> | null) ?? {}),
        },
      });
    }
    return;
  }

  await processInboundMessage(normalized);
}

/** Evolution's messages.edited payload: the edit protocolMessage. Loosely typed. */
interface EvolutionEditedData {
  key?: { id?: unknown };
  editedMessage?: {
    conversation?: unknown;
    extendedTextMessage?: { text?: unknown };
    imageMessage?: { caption?: unknown };
    videoMessage?: { caption?: unknown };
    documentMessage?: { caption?: unknown };
  };
}

/**
 * Apply a WhatsApp edit to the message we already stored: the original row's text
 * becomes the edited text (same row, so the chat shows it in place). The row is found
 * by WhatsApp message id AND this channel's number, never by id alone. Voice notes
 * cannot be edited on WhatsApp and their body is our transcript, so they are skipped.
 * An edit of a message we never stored (sent before the channel was linked) is a no-op.
 */
async function handleMessageEdited(instanceName: string, data: EvolutionEditedData | undefined): Promise<void> {
  const messageId = typeof data?.key?.id === 'string' ? data.key.id : null;
  const edited = data?.editedMessage;
  const text = [
    edited?.conversation,
    edited?.extendedTextMessage?.text,
    edited?.imageMessage?.caption,
    edited?.videoMessage?.caption,
    edited?.documentMessage?.caption,
  ].find((v): v is string => typeof v === 'string');
  if (!messageId || text === undefined) return;

  const channel = await resolveChannelByInstance(instanceName);
  if (!channel) return;

  const { data: row, error: selErr } = await supabaseAdmin
    .from('chat_messages')
    .select('id, media_type')
    .eq('message_id_normalized', messageId)
    .eq('business_phone_number', channel.phone_number)
    .maybeSingle();
  if (selErr) throw selErr;
  if (!row) {
    console.log(`[Evolution Inbound] edit for unknown message ${messageId} on ${instanceName}; ignored`);
    return;
  }
  if ((row as { media_type?: string | null }).media_type === 'voice') return;

  // edited_at drives the inbox's "Edited" label (chat_messages.edited_at, 2026-10-07).
  const { error: updErr } = await supabaseAdmin
    .from('chat_messages')
    .update({ message_body: text, edited_at: new Date().toISOString() })
    .eq('id', (row as { id: string }).id);
  if (updErr) throw updErr;
}

/**
 * A message was deleted for everyone: mark our copy delivery_status='deleted' (the
 * existing "sender retracted" state) so the inbox shows "This message was deleted".
 * The text is kept for the record. Matched by WhatsApp id + this channel's number.
 */
async function handleMessageDeleted(instanceName: string, data: { id?: unknown } | undefined): Promise<void> {
  const messageId = typeof data?.id === 'string' ? data.id : null;
  if (!messageId) return;
  const channel = await resolveChannelByInstance(instanceName);
  if (!channel) return;
  const { error } = await supabaseAdmin
    .from('chat_messages')
    .update({ delivery_status: 'deleted', delivery_status_at: new Date().toISOString() })
    .eq('message_id_normalized', messageId)
    .eq('business_phone_number', channel.phone_number);
  if (error) throw error;
}

/**
 * Evolution/Baileys ack status -> our delivery_status vocabulary. The webhook
 * source maps the numeric Baileys WAMessageStatus to these strings before
 * sending (default 'SERVER_ACK'); we also accept the raw number defensively.
 *   ERROR=0 PENDING=1 SERVER_ACK=2 DELIVERY_ACK=3 READ=4 PLAYED=5
 */
const EVO_STATUS_TO_DELIVERY: Record<string, string> = {
  ERROR: 'failed',
  PENDING: 'pending',
  SERVER_ACK: 'sent',
  DELIVERY_ACK: 'delivered',
  READ: 'read',
  PLAYED: 'played',
  '0': 'failed',
  '1': 'pending',
  '2': 'sent',
  '3': 'delivered',
  '4': 'read',
  '5': 'played',
};

/** One messages.update entry (a delivery/read receipt). Loosely typed: it is an
 *  external Baileys/Evolution payload, so every field is optional and unknown. */
interface EvolutionStatusUpdateData {
  fromMe?: unknown;
  keyId?: unknown;
  messageId?: unknown;
  key?: { id?: unknown };
  status?: unknown;
  /** Status (Story) view receipts from our Evolution fork: remoteJid
   *  'status@broadcast', statusView true, participant = the viewer's JID. */
  remoteJid?: unknown;
  statusView?: unknown;
  participant?: unknown;
  timestamp?: unknown;
}

/**
 * Handle one messages.update entry: a delivery/read receipt for an outbound
 * message we sent. Evolution shape: { keyId, remoteJid, fromMe, status, ... }.
 * Only fromMe (our sends) carry a receipt we render; applyOutboundDeliveryStatus
 * also guards direction='outbound', so an inbound-message update is a safe no-op.
 */
async function handleMessageStatusUpdate(data: EvolutionStatusUpdateData | null | undefined): Promise<void> {
  if (!data) return;
  // Skip receipts that aren't for our own outbound messages (saves a DB lookup;
  // the writer's direction guard is the real safety net).
  if (data.fromMe === false) return;

  const messageId =
    typeof data.keyId === 'string' ? data.keyId :
    typeof data.messageId === 'string' ? data.messageId :
    typeof data.key?.id === 'string' ? data.key.id : null;
  if (!messageId) return;

  const rawStatus =
    typeof data.status === 'string' ? data.status.toUpperCase() :
    typeof data.status === 'number' ? String(data.status) : '';
  const mapped = EVO_STATUS_TO_DELIVERY[rawStatus];
  if (!mapped) return;

  // A viewer of a WhatsApp Status we posted (our Evolution fork forwards these,
  // 2026-10-06). Recorded on whatsapp_status_posts / whatsapp_status_views exactly
  // like WHAPI's story views; never a chat-message receipt. The fork resolves a
  // viewer's @lid to their phone; if it could not, the LID digits are stored, which
  // still counts that person once (only the count is shown, never the phone).
  if (data.remoteJid === 'status@broadcast') {
    if (data.statusView === true && typeof data.participant === 'string') {
      const ts = typeof data.timestamp === 'number' && data.timestamp > 0 ? data.timestamp : null;
      await applyStatusView({
        messageId,
        viewerPhone: data.participant,
        status: mapped,
        at: ts ? new Date(ts * 1000).toISOString() : undefined,
      });
    }
    return;
  }

  await applyOutboundDeliveryStatus({
    messageId,
    status: mapped,
    failedReason: mapped === 'failed' ? `Evolution status ${rawStatus}` : null,
  });
}

/**
 * Handle a connection.update event - map Evolution/Baileys state to our canonical
 * connection_state and update whatsapp_channels, mirroring the WHAPI channel-state
 * webhook so realtime + downstream logic behave identically across providers.
 *
 * data shape: { state: 'open'|'connecting'|'close', statusReason?: number,
 *               wuid?: '<digits>@s.whatsapp.net' (paired number) }
 */
async function handleConnectionUpdate(instanceName: string, data: EvolutionConnectionData | undefined): Promise<void> {
  const state = typeof data?.state === 'string' ? data.state : null;
  // Evolution surfaces the Baileys DisconnectReason code under a few possible
  // keys depending on version.
  const statusCode: number | null =
    typeof data?.statusReason === 'number' ? data.statusReason :
    typeof data?.statusCode === 'number' ? data.statusCode :
    typeof data?.lastDisconnect?.error?.output?.statusCode === 'number'
      ? data.lastDisconnect.error.output.statusCode
      : null;

  const canonical = connectionStateFromEvolution(state, statusCode);
  const nowIso = new Date().toISOString();

  const patch: Record<string, unknown> = {
    connection_state: canonical,
    connection_checked_at: nowIso,
  };

  // Keep the legacy channel_status + pool_state columns coherent so any reader
  // still on those columns (and the disconnect reaper) behaves correctly.
  if (canonical === 'connected') {
    patch.channel_status = 'channel logged in';
    patch.pool_state = 'paired';
  } else if (canonical === 'needs_qr') {
    patch.channel_status = 'channel logged out';
    patch.pool_state = 'disconnected';
    patch.disconnected_at = nowIso;
  } else if (canonical === 'disconnected' || canonical === 'banned') {
    patch.channel_status = 'channel disconnected';
    patch.pool_state = 'disconnected';
    patch.disconnected_at = nowIso;
  }
  // 'reconnecting' / 'unknown' → only touch connection_state (transient).

  const { data: updated, error } = await supabaseAdmin
    .from('whatsapp_channels')
    .update(patch as never)
    .eq('evolution_instance_name', instanceName)
    .eq('provider', 'evolution')
    .neq('lifecycle_state', 'deleted')
    .select('id, company_id, channel_name')
    .maybeSingle();

  if (error) {
    // This is the writer for connection_state / channel_status / ban marking off the
    // webhook. A persistent failure means a real WhatsApp ban/disconnect silently stops
    // being recorded - pair the console line with an alert (per the webhook-catch rule).
    console.error(`[Evolution Inbound] connection.update DB write failed for ${instanceName}:`, error.message);
    reportError(new Error(`Evolution connection.update DB write failed for ${instanceName}: ${error.message}`), {
      type: 'evolution_inbound_process_failed',
      metadata: { route: '/api/evolution/inbound', stage: 'connection.update.dbwrite', instance: instanceName },
    });
    return;
  }
  if (!updated) return;

  const row = updated as { id: number; company_id: string | null; channel_name: string | null };

  // Drive proxy auto-renew from REAL connection state: keep the IP's IPRoyal lease
  // auto-extending only while the channel is serving a LIVE WhatsApp, so a working
  // number's IP survives past 30 days with no rebuy + re-pair - and a logged-out /
  // disconnected / banned / never-paired IP never gets renewal turned on (no idle
  // spend). Fire-and-forget: toggling never charges and must not block the webhook.
  if (canonical === 'connected') {
    void setProxyAutoExtendForChannel(row.id, true);
    void reapplyEvolutionWebhook(instanceName, row.id);
  } else if (canonical === 'needs_qr' || canonical === 'disconnected' || canonical === 'banned') {
    void setProxyAutoExtendForChannel(row.id, false);
  }

  // On (re)connect, clear any pending disconnect grace-window so a transient
  // blip never matures into a false disconnect notification.
  if (canonical === 'connected' && row.company_id) {
    void markChannelReconnected(row.company_id, channelKeyFor('whatsapp', row.channel_name ?? null));

    // Learn/refresh the paired phone number from wuid if provided (Evolution's
    // twin of WHAPI users.post). Propagates to communication_map for routing.
    const wuid = typeof data?.wuid === 'string' ? data.wuid : (typeof data?.me?.id === 'string' ? data.me.id : '');
    const phone = wuid.includes('@') ? wuid.slice(0, wuid.indexOf('@')).replace(/\D/g, '') : wuid.replace(/\D/g, '');
    if (phone) {
      // setChannelPhone keys on channel_id (WHAPI). For evolution we update by
      // instance name directly here to keep both tables in sync.
      await syncEvolutionChannelPhone(instanceName, row.id, phone);
    }
  }

  // Ban surfaced on the connection path - hand to the SHARED, provider-agnostic
  // ban handler so the channel auto-detaches from every communication_map, is
  // marked banned + non-reconnectable, and fires the single operator alert.
  // Identical outcome to the WHAPI ban path (handleConfirmedBan operates purely
  // on the DB row; no WHAPI calls).
  if (isEvolutionBan(statusCode)) {
    await handleConfirmedBan(row.id);
  }
}

/**
 * Re-apply our canonical webhook config (buildEvolutionWebhookConfig) to an instance
 * every time it (re)connects. It used to be applied only at create and at the app's
 * post-pairing set-webhook step, so a config change (e.g. subscribing MESSAGES_EDITED,
 * 2026-10-07) never reached channels that were already linked. Every Evolution restart
 * reconnects every instance, so any config change now rolls out on the next deploy.
 * Fire-and-forget; a failure keeps the previous config (inbound still works), so it is
 * reported silently and only escalates if it keeps happening.
 */
async function reapplyEvolutionWebhook(instanceName: string, channelDbId: number): Promise<void> {
  try {
    const { data } = await supabaseAdmin
      .from('whatsapp_channels')
      .select('channel_token')
      .eq('id', channelDbId)
      .maybeSingle();
    const result = await evoSetWebhook({
      instanceName,
      webhookUrl: evolutionInboundWebhookUrlFor(instanceName),
      instanceToken: (data as { channel_token?: string | null } | null)?.channel_token ?? null,
    });
    if (!result.ok) throw new Error(`Evolution set-webhook on reconnect failed: ${result.error ?? result.status}`);
  } catch (err) {
    reportError(err instanceof Error ? err : new Error(String(err)), {
      type: 'evolution_set_webhook_failed',
      dedupe: 'silent',
      escalateAfter: 20,
      metadata: { source: 'routes.evolution.inbound.reapplyEvolutionWebhook', instance: instanceName, channelDbId },
    });
  }
}

/**
 * Persist an Evolution channel's paired phone across whatsapp_channels +
 * communication_map (the twin of setChannelPhone, which keys on WHAPI channel_id).
 */
async function syncEvolutionChannelPhone(instanceName: string, channelDbId: number, phone: string): Promise<void> {
  if (!phone) return;
  const { error: chanErr } = await supabaseAdmin
    .from('whatsapp_channels')
    .update({ phone_number: phone } as never)
    .eq('evolution_instance_name', instanceName)
    .neq('lifecycle_state', 'deleted');
  if (chanErr) {
    console.error(`[Evolution Inbound] phone update failed for ${instanceName}:`, chanErr.message);
    reportError(new Error(`Evolution phone sync failed (whatsapp_channels): ${chanErr.message}`), {
      type: 'database_error',
      metadata: { source: 'routes.evolution.inbound.syncEvolutionChannelPhone', instance: instanceName, channelDbId },
    });
    return;
  }
  const { error: mapErr } = await supabaseAdmin
    .from('communication_map')
    .update({ communication_value: phone } as never)
    .eq('connected_to_whatsapp_channel_id', channelDbId)
    .eq('is_deleted', false);
  if (mapErr) {
    console.error(`[Evolution Inbound] communication_map phone update failed for ${instanceName}:`, mapErr.message);
    reportError(new Error(`Evolution phone sync failed (communication_map): ${mapErr.message}`), {
      type: 'database_error',
      metadata: { source: 'routes.evolution.inbound.syncEvolutionChannelPhone', instance: instanceName, channelDbId },
    });
  }
}
