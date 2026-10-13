/**
 * WhatsApp Status (Story) posting for Evolution channels: the Evolution twin of
 * whapi/sendStatus.ts, returning the SAME result shape so the status dispatcher
 * handles both providers with one set of success / retry / failure rules.
 *
 * Who sees the status (2026-10-06):
 * WHAPI posts to the phone's contacts for us. Evolution needs the recipient list
 * spelled out (`statusJidList`), so we build it from two sources:
 *   1. The contacts Evolution saved for the instance (address book + people who
 *      messaged it; needs DATABASE_SAVE_DATA_CONTACTS=true on the Evolution service,
 *      and the address book only arrives when a phone links).
 *   2. Everyone who has messaged this number in our inbox (chat_messages), so a
 *      status still reaches real customers when Evolution has no saved contacts.
 * Plus the merchant's own number, so the post shows under "My status" on their phone.
 * WhatsApp itself still only shows a status to people who have the number saved.
 *
 * The location can narrow that (2026-10-08, whatsapp_status_audiences, same choices
 * as WhatsApp's own Status privacy): 'except' removes the listed people, 'only' sends
 * to just the listed people. The post records who it went to (recipient_phones), and
 * a delete is sent to exactly those people.
 *
 * Same gates as WHAPI (refuseIfChannelPaused): emergency shut-off, banned, paused.
 * No anti-block rate gate, matching WHAPI statuses (see the note in sendStatus.ts).
 */
import { supabaseAdmin } from '../../config/supabase.js';
import { refuseIfChannelPaused, type SendWhapiStatusResult } from '../../whapi/sendStatus.js';
import type { DeleteWhapiStatusResult } from '../../whapi/deleteStatus.js';
import { evoDeleteStatus, evoFindContactJids, evoSendStatus } from './evolutionClient.js';

/** Hard ceiling on recipients per post. Evolution sends in batches of 10, all at once. */
const MAX_STATUS_RECIPIENTS = 5000;
/** Pages of 1000 inbound messages read from our inbox when collecting chat partners. */
const MAX_CHAT_PAGES = 100;
/** A long list takes a while to send; a timeout must not cut a send off midway. */
const STATUS_SEND_TIMEOUT_MS = 120_000;
/** Default text-status background (WhatsApp green), when the post has none. */
const DEFAULT_BACKGROUND_ARGB = '#FF075E54';

/**
 * Our font names (the composer's 8 fonts, same names WHAPI takes) -> the font code
 * WhatsApp phones ACTUALLY render for that typeface. Verified on an Android phone
 * 2026-10-06 by posting every code 0..10 and matching each against the phone's own
 * 8-font picker.
 *
 * Do NOT "fix" this back to Baileys' proto enum (SYSTEM_BOLD=6 .. COURIERPRIME_BOLD=10).
 * That enum is out of date: on a phone 6 is the heavy serif (Calistoga), 7 extra-bold
 * sans (Exo 2), 8 the typewriter (Courier Prime), and 3, 9 and 10 render as the plain
 * default. The real codes are 0, 1, 2, 4, 5, 6, 7, 8. WhatsApp Windows/Web only has
 * the first three (plain, serif, script) and shows the rest as plain.
 * Needs our Evolution fork (font 0..10 accepted; upstream allowed only 1..5).
 * Unknown or empty -> 0, WhatsApp's default plain font.
 */
const EVOLUTION_STATUS_FONT: Record<string, number> = {
  SYSTEM: 0,                // plain sans (default)
  SYSTEM_TEXT: 1,           // serif
  FB_SCRIPT: 2,             // handwritten script
  SYSTEM_BOLD: 4,           // bold sans
  MORNINGBREEZE_REGULAR: 5, // rounded handwriting
  CALISTOGA_REGULAR: 6,     // heavy serif
  EXO2_EXTRABOLD: 7,        // extra-bold sans
  COURIERPRIME_BOLD: 8,     // bold typewriter
};

function evolutionFontFor(fontType: string | null | undefined): number {
  return EVOLUTION_STATUS_FONT[fontType ?? ''] ?? 0;
}

function digitsOnly(s: string | null | undefined): string {
  return (s || '').replace(/\D/g, '');
}

function personJid(digits: string): string | null {
  return /^\d{6,15}$/.test(digits) ? `${digits}@s.whatsapp.net` : null;
}

/** Who a status goes to. Phones are digits only. */
export interface StatusAudience {
  mode: 'all' | 'only' | 'except';
  phones: string[];
}

/** Everyone who has messaged this business number (digits), deduped. */
export async function chatPartnerDigits(businessPhone: string): Promise<Set<string>> {
  const out = new Set<string>();
  for (let page = 0; page < MAX_CHAT_PAGES; page++) {
    const from = page * 1000;
    const { data, error } = await supabaseAdmin
      .from('chat_messages')
      .select('phone_number')
      .eq('business_phone_number', businessPhone)
      .eq('message_type', 'whatsapp')
      .eq('direction', 'inbound')
      .order('id', { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    for (const r of data ?? []) {
      const d = digitsOnly((r as { phone_number?: string | null }).phone_number);
      if (d) out.add(d);
    }
    if (!data || data.length < 1000) break;
  }
  return out;
}

interface EvolutionStatusChannel {
  evolution_instance_name: string | null;
  channel_token: string | null;
  phone_number: string | null;
}

/**
 * Build the recipient JID list. Own number first (always a valid recipient, so the
 * post shows on the merchant's own phone whatever the audience).
 */
async function buildStatusAudience(
  channel: EvolutionStatusChannel,
  audience: StatusAudience | null = null,
): Promise<string[]> {
  const own = digitsOnly(channel.phone_number);
  const jids = new Set<string>();
  const ownJid = personJid(own);
  if (ownJid) jids.add(ownJid);

  if (audience?.mode === 'only') {
    for (const p of audience.phones) {
      const j = personJid(digitsOnly(p));
      if (j) jids.add(j);
    }
    return Array.from(jids).slice(0, MAX_STATUS_RECIPIENTS);
  }

  const saved = await evoFindContactJids({
    instanceName: channel.evolution_instance_name as string,
    instanceToken: channel.channel_token,
  });
  if (saved.ok) {
    for (const j of saved.body ?? []) jids.add(j);
  } else {
    // The chat-history source below still covers the post; the send itself reports
    // a real Evolution outage.
    console.warn(`[evolution-status] findContacts failed for ${channel.evolution_instance_name}: ${saved.error}`);
  }

  if (own) {
    for (const d of await chatPartnerDigits(own)) {
      const j = personJid(d);
      if (j) jids.add(j);
    }
  }
  if (audience?.mode === 'except') {
    for (const p of audience.phones) {
      const j = personJid(digitsOnly(p));
      if (j && j !== ownJid) jids.delete(j);
    }
  }
  return Array.from(jids).slice(0, MAX_STATUS_RECIPIENTS);
}

/** Recipient JIDs -> digits, without the merchant's own number (the "Sent to" list). */
function recipientDigits(jids: string[], ownPhone: string | null): string[] {
  const own = digitsOnly(ownPhone);
  return jids.map((j) => j.split('@')[0]).filter((d) => d && d !== own);
}

export async function sendEvolutionStatus(params: {
  dbId: number;
  kind: 'text' | 'image';
  text?: string | null;
  backgroundColor?: string | null;
  textColor?: string | null;
  fontType?: string | null;
  mediaUrl?: string | null;
  mediaMimeType?: string | null;
  caption?: string | null;
  /** Who sees it; null = everyone (the phone's contacts + people who messaged). */
  audience?: StatusAudience | null;
}): Promise<SendWhapiStatusResult> {
  const refused = await refuseIfChannelPaused(params.dbId);
  if (refused) return refused;

  const { data: channel } = await supabaseAdmin
    .from('whatsapp_channels')
    .select('evolution_instance_name, channel_token, phone_number')
    .eq('id', params.dbId)
    .maybeSingle();
  const ch = channel as EvolutionStatusChannel | null;
  if (!ch?.evolution_instance_name) {
    return { success: false, messageId: null, attempts: 0, errorCode: 'channel_not_found', errorMessage: 'Evolution channel not found or missing instance name' };
  }

  const statusJidList = await buildStatusAudience(ch, params.audience ?? null);

  const isVideo = (params.mediaMimeType ?? '').startsWith('video/');
  const res = await evoSendStatus({
    instanceName: ch.evolution_instance_name,
    instanceToken: ch.channel_token,
    type: params.kind === 'text' ? 'text' : isVideo ? 'video' : 'image',
    content: params.kind === 'text' ? params.text ?? '' : params.mediaUrl ?? '',
    caption: params.kind === 'text' ? null : params.caption,
    backgroundColor: params.kind === 'text' ? params.backgroundColor || DEFAULT_BACKGROUND_ARGB : null,
    textColor: params.kind === 'text' ? params.textColor : null,
    font: params.kind === 'text' ? evolutionFontFor(params.fontType) : null,
    statusJidList,
    timeoutMs: STATUS_SEND_TIMEOUT_MS,
  });

  if (res.ok) {
    return {
      success: true,
      messageId: res.body?.messageId ?? null,
      attempts: 1,
      raw: { recipients: statusJidList.length },
      recipientPhones: recipientDigits(statusJidList, ch.phone_number),
    };
  }
  if (res.networkError && /abort/i.test(res.error ?? '')) {
    // Timed out waiting for Evolution. It may still have posted, so this is NOT
    // retried (a retry could post the same status twice).
    return { success: false, messageId: null, attempts: 1, errorCode: 'status_timeout', errorMessage: res.error, status: null };
  }
  if (res.networkError) {
    return { success: false, messageId: null, attempts: 1, errorCode: 'network_error', errorMessage: res.error };
  }
  return {
    success: false,
    messageId: null,
    attempts: 1,
    errorCode: 'whapi_error',
    errorMessage: res.error || `Evolution ${res.status}`,
    status: res.status,
    raw: { recipients: statusJidList.length },
  };
}

/**
 * Delete a posted status from recipients' phones (the Evolution twin of
 * deleteWhapiStatus, same result shape). The revoke has to be sent to the people the
 * status went to: the post's recorded recipient_phones when it has them (posts from
 * 2026-10-08 on), otherwise the list is rebuilt the way it was built at send time
 * (anyone added since then gets a harmless revoke for a status they never had).
 * Needs our Evolution fork's 2026-10-06 patch (statusJidList on
 * deleteMessageForEveryone).
 */
export async function deleteEvolutionStatus(args: {
  channelDbId: number;
  messageId: string | null;
  /** The post's recipient_phones; null = not recorded (older post). */
  recipientPhones?: string[] | null;
}): Promise<DeleteWhapiStatusResult> {
  if (!args.messageId) {
    return { success: false, errorCode: 'no_message_id', errorMessage: 'This status has no WhatsApp message id (it may never have finished posting).' };
  }
  const { data: channel } = await supabaseAdmin
    .from('whatsapp_channels')
    .select('evolution_instance_name, channel_token, phone_number')
    .eq('id', args.channelDbId)
    .maybeSingle();
  const ch = channel as EvolutionStatusChannel | null;
  if (!ch?.evolution_instance_name) {
    return { success: false, errorCode: 'channel_not_found', errorMessage: 'Evolution channel not found or missing instance name' };
  }

  const statusJidList = Array.isArray(args.recipientPhones)
    ? await buildStatusAudience(ch, { mode: 'only', phones: args.recipientPhones })
    : await buildStatusAudience(ch);
  const sentPayload = {
    endpoint: 'DELETE /chat/deleteMessageForEveryone/{instance} (Evolution)',
    messageId: args.messageId,
    channelDbId: args.channelDbId,
    recipients: statusJidList.length,
  };
  const res = await evoDeleteStatus({
    instanceName: ch.evolution_instance_name,
    instanceToken: ch.channel_token,
    messageId: args.messageId,
    statusJidList,
    timeoutMs: STATUS_SEND_TIMEOUT_MS,
  });
  if (res.ok) return { success: true };
  return {
    success: false,
    errorCode: res.networkError ? 'network_error' : 'whapi_error',
    errorMessage: res.error || `Evolution ${res.status}`,
    status: res.status,
    raw: res.body,
    sentPayload,
  };
}
