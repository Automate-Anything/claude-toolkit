/**
 * Evolution API inbound webhook → NormalizedMessage.
 *
 * Produces the SAME NormalizedMessage shape as normalizeWhapiInbound so every
 * downstream step (companyResolver, session, contact upsert, AI handoff) is
 * provider-agnostic and unchanged.
 *
 * Evolution (Baileys) MESSAGES_UPSERT payload shape (verified against Evolution
 * v2 event docs):
 *   {
 *     event: 'messages.upsert',
 *     instance: '<our instance name>',
 *     data: {
 *       key: { remoteJid: '<digits>@s.whatsapp.net', fromMe: false, id: '<MSGID>' },
 *       pushName: 'Customer Name',
 *       messageType: 'conversation' | 'imageMessage' | 'audioMessage' | ...,
 *       message: {
 *         conversation?: 'text',
 *         extendedTextMessage?: { text, contextInfo? },
 *         imageMessage?: { caption?, ... },
 *         videoMessage?: { caption?, ... },
 *         documentMessage?: { caption?, fileName?, ... },
 *         audioMessage?: { ... },          // voice note (ptt) or audio
 *         reactionMessage?: { text: '<emoji>', key: { id: '<target>' } },
 *       },
 *       messageTimestamp: 1713774883,       // seconds
 *     }
 *   }
 *
 * `receivingPhone` (our business number) is NOT reliably in the payload, so the
 * caller resolves it authoritatively from the instance name → whatsapp_channels
 * row → phone_number, and passes it in. This mirrors how WHAPI carried it in the
 * `?phone_number=` query.
 */
import type { NormalizedMessage } from './types.js';

/**
 * Structural shape of the Baileys/Evolution MESSAGES_UPSERT `data` object we
 * read from. Every field is optional and loosely typed (the payload is
 * external), but this gives real types to every access below instead of `any`.
 * `contextInfo` is self-referential because a quoted reply nests another
 * message body under `quotedMessage`.
 */
interface EvolutionContextInfo {
  stanzaId?: unknown;
  quotedMessage?: EvolutionMessageContent;
}
interface EvolutionMessagePart {
  text?: unknown;
  caption?: unknown;
  mimetype?: unknown;
  fileName?: unknown;
  contextInfo?: EvolutionContextInfo;
}
interface EvolutionReaction {
  text?: unknown;
  key?: { id?: unknown };
}
interface EvolutionMessageContent {
  conversation?: unknown;
  extendedTextMessage?: EvolutionMessagePart;
  imageMessage?: EvolutionMessagePart;
  videoMessage?: EvolutionMessagePart;
  documentMessage?: EvolutionMessagePart;
  audioMessage?: EvolutionMessagePart;
  reactionMessage?: EvolutionReaction;
  contactMessage?: { displayName?: unknown; vcard?: unknown };
  contactsArrayMessage?: { contacts?: Array<{ displayName?: unknown }> };
}
interface EvolutionObject {
  key?: { remoteJid?: unknown; id?: unknown; fromMe?: unknown };
  message?: EvolutionMessageContent;
  messageType?: unknown;
  messageTimestamp?: unknown;
  // Evolution nests a quoted-reply's context at the TOP LEVEL (sibling of
  // `message`), not inside message.extendedTextMessage. See the quoted-reply
  // block below.
  contextInfo?: EvolutionContextInfo;
}

function digitsOnly(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/[^\d]/g, '') : '';
}

/** Extract the JID host (the digits before @) from a Baileys remoteJid. */
function jidDigits(jid: unknown): string {
  const s = typeof jid === 'string' ? jid : '';
  const beforeAt = s.includes('@') ? s.slice(0, s.indexOf('@')) : s;
  return digitsOnly(beforeAt);
}

/** True when a Baileys remoteJid is a group chat (@g.us). */
export function isEvolutionGroupJid(jid: unknown): boolean {
  return typeof jid === 'string' && jid.endsWith('@g.us');
}

/**
 * The `data` object from an Evolution MESSAGES_UPSERT event.
 * Returns null for anything we don't ingest (no key, group handled by caller).
 */
export function normalizeEvolutionInbound(args: {
  data: EvolutionObject | null | undefined;
  /** Our business number (digits only), resolved from the instance. */
  receivingPhone: string;
}): NormalizedMessage | null {
  const data = args.data;
  const key = data?.key;
  if (!key || typeof key !== 'object') return null;

  const receivingPhone = digitsOnly(args.receivingPhone);
  const rawJid = typeof key.remoteJid === 'string' ? key.remoteJid : '';
  const senderId = jidDigits(rawJid);
  const phoneNumber = senderId;

  // Preserve the WHAPI chat-key convention: `chat_id + receivingPhone`, using
  // the SAME raw_chat_id form WHAPI produced (`<digits>@s.whatsapp.net`) so
  // chat_messages.chat_id_normalized values align across providers.
  const rawChatId = rawJid || (senderId ? `${senderId}@s.whatsapp.net` : '');
  const chatId = `${rawChatId}${receivingPhone}`;

  const message: EvolutionMessageContent = data?.message ?? {};
  const messageType = typeof data?.messageType === 'string' ? data.messageType : '';

  // Shared contact (vCard). Evolution: message.contactMessage {displayName, vcard}
  // or message.contactsArrayMessage.contacts[]. Without this a contact share came
  // through with an empty body and rendered as a blank bubble. Surface the name +
  // phone (parsed from the vCard TEL line) so the bubble shows a contact card
  // (media_type='contact'); body is "name\nphone" (the frontend splits on \n).
  const singleContact = message?.contactMessage;
  const contactArray = message?.contactsArrayMessage?.contacts;
  let contactBody: string | undefined;
  if (singleContact) {
    const cname = typeof singleContact.displayName === 'string' ? singleContact.displayName : '';
    const telMatch = typeof singleContact.vcard === 'string'
      ? singleContact.vcard.match(/TEL[^:\n]*:([^\n\r]+)/i)
      : null;
    const cphone = telMatch ? telMatch[1].trim() : '';
    contactBody = [cname, cphone].filter(Boolean).join('\n') || undefined;
  } else if (Array.isArray(contactArray) && contactArray.length > 0) {
    const names = contactArray
      .map((c) => (typeof c?.displayName === 'string' ? c.displayName : ''))
      .filter(Boolean);
    contactBody = names.join(', ') || undefined;
  }

  // Body extraction across Baileys message shapes.
  const messageBody = String(
    message?.conversation ??
      message?.extendedTextMessage?.text ??
      message?.imageMessage?.caption ??
      message?.videoMessage?.caption ??
      message?.documentMessage?.caption ??
      message?.reactionMessage?.text ??
      contactBody ??
      '',
  );

  // Map Baileys messageType → our coarse message_type vocabulary (mirrors
  // WHAPI's "text"/"voice"/"image"/"video"/"document"/"action"/"contact").
  let coarseType = 'text';
  if (message?.audioMessage || messageType === 'audioMessage') coarseType = 'voice';
  else if (message?.imageMessage || messageType === 'imageMessage') coarseType = 'image';
  else if (message?.videoMessage || messageType === 'videoMessage') coarseType = 'video';
  else if (message?.documentMessage || messageType === 'documentMessage') coarseType = 'document';
  else if (message?.contactMessage || message?.contactsArrayMessage || messageType === 'contactMessage' || messageType === 'contactsArrayMessage') coarseType = 'contact';
  else if (message?.reactionMessage || messageType === 'reactionMessage') coarseType = 'action';

  // Reference extraction: reactions + quoted replies.
  let reference: NonNullable<NormalizedMessage['reference']> | undefined;
  if (message?.reactionMessage?.key?.id) {
    reference = {
      kind: 'reaction',
      target_id: String(message.reactionMessage.key.id),
      emoji: typeof message.reactionMessage.text === 'string' ? message.reactionMessage.text : undefined,
    };
  } else {
    // Quoted reply. Evolution puts the quote context at the TOP LEVEL of the
    // message data (`data.contextInfo`, a sibling of `message`) - NOT inside
    // message.extendedTextMessage.contextInfo. A quoted text reply arrives as a
    // plain `message.conversation` with the quote in `data.contextInfo`, so the
    // old message-nested lookup never matched and every quoted reply (inbound AND
    // fromMe) came through unlinked. Verified against Evolution findMessages
    // 2026-09-01: data.contextInfo.{stanzaId, participant, quotedMessage}. We
    // still check the message-nested spots as a fallback for any other shape.
    const ctx =
      data?.contextInfo ??
      message?.extendedTextMessage?.contextInfo ??
      message?.imageMessage?.contextInfo ??
      message?.videoMessage?.contextInfo ??
      message?.documentMessage?.contextInfo;
    if (ctx?.stanzaId) {
      const qm = ctx.quotedMessage;
      const snippet =
        (typeof qm?.conversation === 'string' && qm.conversation) ||
        (typeof qm?.extendedTextMessage?.text === 'string' && qm.extendedTextMessage.text) ||
        (typeof qm?.imageMessage?.caption === 'string' && qm.imageMessage.caption) ||
        (typeof qm?.videoMessage?.caption === 'string' && qm.videoMessage.caption) ||
        (typeof qm?.documentMessage?.caption === 'string' && qm.documentMessage.caption) ||
        undefined;
      reference = {
        kind: 'quoted_reply',
        target_id: String(ctx.stanzaId),
        snippet: snippet || undefined,
      };
    }
  }

  const tsSec = typeof data?.messageTimestamp === 'number' ? data.messageTimestamp : Number(data?.messageTimestamp);
  const tsMs = Number.isFinite(tsSec) && tsSec > 0 ? tsSec * 1000 : Date.now();
  const createdAt = new Date(tsMs).toISOString();

  return {
    senderId,
    chatId,
    phoneNumber,
    messageBody,
    // Evolution voice comes as a media message we fetch by message id; we carry
    // the message id in voice_id so the voice pipeline can request the base64
    // via Evolution's getBase64FromMediaMessage endpoint (handled downstream).
    voice_id: coarseType === 'voice' ? (typeof key.id === 'string' ? key.id : '') : '',
    // Non-voice media (image/video/document): Evolution fetches any media by the
    // MESSAGE id (key.id) via getBase64FromMediaMessage - same mechanism as voice,
    // just routed to the store-and-show pipeline instead of transcription.
    media_id:
      (coarseType === 'image' || coarseType === 'video' || coarseType === 'document') &&
      typeof key.id === 'string'
        ? key.id
        : undefined,
    media_mime:
      (typeof message?.imageMessage?.mimetype === 'string' && message.imageMessage.mimetype) ||
      (typeof message?.videoMessage?.mimetype === 'string' && message.videoMessage.mimetype) ||
      (typeof message?.documentMessage?.mimetype === 'string' && message.documentMessage.mimetype) ||
      undefined,
    media_filename:
      coarseType === 'document' && typeof message?.documentMessage?.fileName === 'string'
        ? message.documentMessage.fileName
        : undefined,
    timestamp: String(Date.now()),
    direction: 'Incoming',
    messageId: typeof key.id === 'string' ? key.id : '',
    channel: 'whatsapp',
    from_me: !!key.fromMe,
    message_type: coarseType,
    source: 'mobile',
    receivingPhone,
    raw_chat_id: rawChatId,
    created_at: createdAt,
    reference,
  };
}
