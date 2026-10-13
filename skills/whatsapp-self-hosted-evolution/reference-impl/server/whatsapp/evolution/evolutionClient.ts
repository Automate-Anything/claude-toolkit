/**
 * Low-level Evolution API HTTP client - the SINGLE place that knows Evolution's
 * REST shape. Everything above it (the provider, the transport shims the WHAPI
 * senders delegate to, the pool/lifecycle) speaks in our terms and never sees an
 * Evolution URL.
 *
 * Evolution API (https://github.com/EvolutionAPI/evolution-api) is a
 * multi-instance Baileys gateway. Auth is a global `apikey` header (the service's
 * AUTHENTICATION_API_KEY). Each merchant = one "instance" (analogous to a WHAPI
 * channel). We keep our own stable instance name so a reconnect maps back to the
 * same session store.
 *
 * This client is transport-only: it does NOT touch our DB, does NOT apply the
 * anti-block / Hebrew-calendar / lifecycle gates (those live in the existing
 * senders and stay provider-agnostic). It returns a small normalized result so
 * callers can classify success / retryable / auth / not-ready without parsing
 * Evolution's body shape themselves.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../../config/env.js';
import { recordSentEvolutionMessageId } from './sentMessageTracker.js';

/** Evolution's per-request auth + base URL, resolved once. */
function evoBase(): { url: string; apiKey: string } | null {
  if (!config.evolutionApiUrl || !config.evolutionApiKey) return null;
  return { url: config.evolutionApiUrl, apiKey: config.evolutionApiKey };
}

export function isEvolutionConfigured(): boolean {
  return evoBase() !== null;
}

/** Normalized outcome of an Evolution HTTP call. */
export interface EvoResult<T = unknown> {
  ok: boolean;
  status: number | null;
  /** Parsed JSON body when available. */
  body: T | null;
  /** Set when ok=false: short human-readable reason. */
  error?: string;
  /** True when fetch threw before any response (network / DNS / timeout). */
  networkError?: boolean;
}

/**
 * Loose shape of the JSON bodies Evolution returns. Every field is optional and
 * defensively typed because Evolution/Baileys nests differ across versions and
 * endpoints; call sites already guard each access with `typeof === 'string'` or
 * `?.`. This replaces the old `evoFetch<any>` so no `any` leaks into the module.
 */
interface EvoRawBody {
  hash?: string | { apikey?: string };
  instance?: { token?: string; state?: string };
  token?: string;
  qrcode?: { base64?: string; code?: string; pairingCode?: string };
  base64?: string;
  pairingCode?: string;
  state?: string;
  mimetype?: string;
  key?: { id?: string };
  messageId?: string;
  id?: string;
  [key: string]: unknown;
}

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Pull the human-readable reason out of an Evolution error body. Evolution v2 is
 * NestJS + class-validator, so its 400/business errors do NOT put the reason at a
 * top-level string `message`: they nest it as `response.message` (usually an ARRAY
 * of validation strings), or as a top-level `message` array, or as a `response`
 * string. The old extractor only read a top-level string `message`, so every one
 * of those shapes fell through to a bare `Evolution 400` with no reason - which
 * made "Evolution instance create failed: Evolution 400" impossible to diagnose
 * from the alert alone (alert #2853: a merchant unable to connect WhatsApp for
 * weeks, 25+ failed creates, every alert opaque). Dig through the real shapes and
 * return the actual detail. Returns null when nothing usable is present so the
 * caller keeps its `Evolution <status>` fallback.
 */
function extractEvoErrorDetail(body: unknown): string | null {
  const flatten = (v: unknown): string | null => {
    if (typeof v === 'string') return v.trim() || null;
    if (Array.isArray(v)) {
      const parts = v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).filter(Boolean);
      return parts.length ? parts.join('; ') : null;
    }
    return null;
  };
  if (!body || typeof body !== 'object') return flatten(body);
  const b = body as Record<string, unknown>;
  const nested = b.response && typeof b.response === 'object' ? (b.response as Record<string, unknown>) : null;
  return (
    flatten(b.message) ||
    (nested ? flatten(nested.message) : null) ||
    flatten(b.response) ||
    flatten(b.error) ||
    null
  );
}

/**
 * Core fetch wrapper. Never throws - returns EvoResult. Applies a timeout so a
 * hung Evolution host can't wedge a caller. `instanceToken` (the per-instance
 * token, when we have it) is preferred as the apikey; falls back to the global
 * admin key (needed for instance create/delete + when per-instance token unknown).
 */
async function evoFetch<T = unknown>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  opts?: { body?: unknown; instanceToken?: string | null; timeoutMs?: number },
): Promise<EvoResult<T>> {
  const base = evoBase();
  if (!base) {
    return { ok: false, status: null, body: null, error: 'Evolution API not configured (EVOLUTION_API_URL / EVOLUTION_API_KEY unset)' };
  }
  const apiKey = opts?.instanceToken || base.apiKey;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const resp = await fetch(`${base.url}${path}`, {
      method,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        apikey: apiKey,
      },
      body: opts?.body != null ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    let body: T | null = null;
    try {
      body = (await resp.json()) as T;
    } catch {
      body = null;
    }
    if (!resp.ok) {
      const errText = extractEvoErrorDetail(body) || `Evolution ${resp.status}`;
      return { ok: false, status: resp.status, body, error: errText };
    }
    return { ok: true, status: resp.status, body };
  } catch (err) {
    clearTimeout(timeoutId);
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: null, body: null, error: message, networkError: true };
  }
}

/**
 * Re-shape a failed evoFetch result to the caller's declared body type. On the
 * error path body is always null, so this is a pure type re-label with no data
 * change (replaces the old `res as EvoResult<any>` casts).
 */
/**
 * IPRoyal lets ONE source address use a proxy at a time. For ~15s after any request
 * through it, every other address gets a bare 403 (measured 2026-09-23). Evolution tests
 * the proxy itself on instance-create and on /proxy/set, and reports that 403 as "Invalid
 * proxy". So if anything ELSE touched the proxy moments earlier (the post-buy routability
 * probe, the heal cron, a manual test), Evolution rejects a perfectly good proxy. Ride the
 * hold out before believing it. Evolution's own test already retries for ~4.5s, so these
 * waits carry the total past the hold; a proxy still rejected after that is genuinely bad.
 */
const EVO_PROXY_HOLD_RETRY_DELAYS_MS = [8_000, 12_000];

/** True when Evolution refused the call because its proxy test failed. */
export function isEvoInvalidProxy(res: EvoResult<unknown>): boolean {
  return !res.ok && /invalid proxy/i.test(res.error ?? '');
}

async function withProxyHoldRetry<T>(label: string, call: () => Promise<EvoResult<T>>): Promise<EvoResult<T>> {
  let res = await call();
  for (const delayMs of EVO_PROXY_HOLD_RETRY_DELAYS_MS) {
    if (!isEvoInvalidProxy(res)) return res;
    console.warn(`[Evolution] ${label}: proxy rejected ("Invalid proxy"), retrying in ${delayMs}ms (single-source proxy hold)`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    res = await call();
  }
  return res;
}

function evoFailResult<T>(res: EvoResult<unknown>): EvoResult<T> {
  return { ok: false, status: res.status, body: null, error: res.error, networkError: res.networkError };
}

// ─── Recipient / chat-id helpers ───────────────────────────────────────────

/**
 * Evolution's `number` field wants the bare JID digits (no `@s.whatsapp.net`,
 * no `+`). Accepts our stored digits, a `+`-prefixed E.164, or a full JID and
 * returns just the digits.
 */
export function toEvoNumber(input: string): string {
  const s = (input || '').trim();
  if (!s) return s;
  const beforeAt = s.includes('@') ? s.slice(0, s.indexOf('@')) : s;
  return beforeAt.replace(/\D/g, '');
}

/**
 * Parse a stored proxy URL (`http://user:pass@host:port`, or `socks5://...`) into
 * the discrete fields Evolution's instance-create DTO wants. Returns null if the
 * URL is unparseable or has no host. Credentials are URL-decoded (an IPRoyal
 * password can contain reserved chars that were percent-encoded into the URL).
 */
export function parseProxyUrl(raw: string): {
  protocol: string; host: string; port: string; username?: string; password?: string;
} | null {
  try {
    const u = new URL(raw.trim());
    const protocol = u.protocol.replace(/:$/, '') || 'http';
    const host = u.hostname;
    if (!host) return null;
    const port = u.port || (protocol === 'https' ? '443' : protocol.startsWith('socks') ? '1080' : '80');
    return {
      protocol,
      host,
      port,
      username: u.username ? decodeURIComponent(u.username) : undefined,
      password: u.password ? decodeURIComponent(u.password) : undefined,
    };
  } catch {
    return null;
  }
}

// ─── Instance lifecycle (analogous to WHAPI channel create/delete/connect) ──

export interface EvoCreateInstanceResult {
  instanceName: string;
  /** Per-instance token ("hash"/apikey) Evolution returns on create - we persist
   *  it as channel_token so later per-instance calls authenticate as that
   *  instance rather than the global admin key. */
  token: string | null;
  /** Base64 QR if Evolution returned one immediately on create. */
  qrBase64: string | null;
  /** Pairing code if requested. */
  pairingCode: string | null;
  raw: unknown;
}

/**
 * The webhook configuration every Evolution instance must run with. Kept in ONE
 * place so instance-create and any later re-sync (evoSetWebhook) can never drift.
 *
 * base64: FALSE is load-bearing. With base64:true Evolution inlines the FULL media
 * file (image/voice/video/document) as base64 in every inbound webhook body, which
 * inflates a single photo or voice note past our inbound JSON body limit and 413s
 * the delivery before our handler runs - the inbound customer message is then
 * silently dropped (fired webhook_provider_failure_rate for provider=evolution,
 * 6/24 = 25% 413s, 2026-08-26). We never READ that inline base64 anyway: inbound
 * media is always fetched on demand by message id via getBase64FromMediaMessage
 * (see voicePipeline.downloadFromEvolution), with the backfill cron as safety net.
 * So base64:false keeps webhook bodies tiny AND loses no capability.
 */
/**
 * Per-instance inbound-webhook token = HMAC(EVOLUTION_WEBHOOK_SECRET, instanceName),
 * first 32 hex chars (128 bits). Returns null when no secret is configured, i.e.
 * webhook tokening is off and the plain inbound URL is used (backward-compatible).
 */
export function evolutionWebhookToken(instanceName: string): string | null {
  const secret = config.evolutionWebhookSecret;
  if (!secret || !instanceName) return null;
  return createHmac('sha256', secret).update(instanceName).digest('hex').slice(0, 32);
}

/**
 * Constant-time check that `token` is the valid webhook token for `instanceName`.
 * False when no secret is configured, when either input is missing, or on mismatch.
 */
export function verifyEvolutionWebhookToken(instanceName: string, token: string | undefined | null): boolean {
  const expected = evolutionWebhookToken(instanceName);
  if (!expected || !token) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The inbound webhook URL to REGISTER on an instance: the base URL plus a per-instance
 * token segment when EVOLUTION_WEBHOOK_SECRET is set, else the plain base URL. Each
 * instance's registered URL then carries its own token, which /api/evolution/inbound
 * validates, so a forged POST (or the tokenless path) is rejected once the secret is on.
 */
export function evolutionInboundWebhookUrlFor(instanceName: string): string {
  const base = config.evolutionInboundWebhookUrl.replace(/\/+$/, '');
  const token = evolutionWebhookToken(instanceName);
  return token ? `${base}/${token}` : base;
}

export function buildEvolutionWebhookConfig(webhookUrl: string): Record<string, unknown> {
  return {
    // Evolution v2's webhook schema REQUIRES `enabled`. Omitting it makes the API
    // reject the whole config with `[Validate] webhook requires property "enabled"`,
    // so the instance runs with NO webhook and we never receive inbound messages or
    // connection.update pushes. Seen live in the Evolution server logs (2026-09-16).
    enabled: true,
    url: webhookUrl,
    byEvents: false,
    base64: false,
    // Only the events our inbound router acts on (plus a couple reserved for
    // near-future use). We deliberately do NOT subscribe to SEND_MESSAGE (our own
    // outbound echoes - nothing to do, just webhook noise), nor to CONTACTS_UPSERT:
    // the inbound router no-ops it (routes/evolution/inbound.ts) AND its initial-
    // sync payload is a potentially huge contact array that could exceed the
    // inbound body limit and 413 - recording a failed evolution webhook and
    // re-firing webhook_provider_failure_rate for an event we don't even use.
    events: [
      'MESSAGES_UPSERT',   // inbound customer messages
      'MESSAGES_UPDATE',   // delivery/read receipts (future)
      'MESSAGES_EDITED',   // edits (our fork decrypts WhatsApp's encrypted edit envelope)
      'MESSAGES_DELETE',   // "delete for everyone" by the customer or by us
      'CONNECTION_UPDATE', // connect / disconnect / ban → connection_state
      'QRCODE_UPDATED',    // QR refresh (informational)
      'CALL',              // inbound call captures (future)
    ],
  };
}

/**
 * Re-apply our canonical webhook config to an EXISTING instance
 * (POST /webhook/set/{instance}). Instance-create sets this too, but an instance
 * provisioned before a config change keeps its old webhook until re-synced. Called
 * on (re)connect so any live instance self-heals onto the current config (e.g. an
 * instance created with the old base64:true gets flipped to base64:false without a
 * re-create). Best-effort: failures are returned, never thrown.
 */
export async function evoSetWebhook(args: {
  instanceName: string;
  webhookUrl: string;
  instanceToken?: string | null;
}): Promise<EvoResult> {
  // Evolution v2 accepts the webhook config nested under `webhook`.
  return evoFetch('POST', `/webhook/set/${encodeURIComponent(args.instanceName)}`, {
    instanceToken: args.instanceToken,
    body: { webhook: buildEvolutionWebhookConfig(args.webhookUrl) },
  });
}

/**
 * Create a fresh Evolution instance wired to POST inbound events at our webhook.
 * We subscribe to exactly the events our inbound router handles.
 */
export async function evoCreateInstance(args: {
  instanceName: string;
  webhookUrl: string;
  /** Optional per-instance outbound proxy (own egress IP). */
  proxyUrl?: string | null;
  /** Request a pairing code for this number instead of relying on QR only. */
  pairingNumber?: string | null;
}): Promise<EvoResult<EvoCreateInstanceResult>> {
  const body: Record<string, unknown> = {
    instanceName: args.instanceName,
    qrcode: true,
    integration: 'WHATSAPP-BAILEYS',
    // Webhook: Evolution v2 nests webhook config under `webhook`.
    webhook: buildEvolutionWebhookConfig(args.webhookUrl),
  };
  if (args.pairingNumber) body.number = toEvoNumber(args.pairingNumber);
  if (args.proxyUrl) {
    // Evolution v2's instance-create DTO takes proxy as TOP-LEVEL fields
    // (proxyHost/proxyPort/proxyProtocol/proxyUsername/proxyPassword), NOT a
    // nested { proxy: { url } } - that shape is silently ignored, so the
    // instance would egress on the host IP while we believe it's proxied.
    // Verified against the InstanceDto source (evolution-api main), and we run
    // v2.3.7. Parse our stored URL into those fields.
    const p = parseProxyUrl(args.proxyUrl);
    if (p) {
      body.proxyHost = p.host;
      body.proxyPort = p.port;
      body.proxyProtocol = p.protocol;
      if (p.username) body.proxyUsername = p.username;
      if (p.password) body.proxyPassword = p.password;
    }
  }

  // A create rejected for "Invalid proxy" leaves nothing behind on Evolution (it removes
  // the instance), so retrying under the same name is safe.
  const res = await withProxyHoldRetry(`create ${args.instanceName}`, () =>
    evoFetch<EvoRawBody>('POST', '/instance/create', { body }),
  );
  if (!res.ok) return evoFailResult<EvoCreateInstanceResult>(res);

  const raw = res.body;
  const hashApikey = raw?.hash && typeof raw.hash === 'object' ? raw.hash.apikey : undefined;
  const hashString = typeof raw?.hash === 'string' ? raw.hash : undefined;
  const token: string | null =
    hashApikey ?? hashString ?? raw?.instance?.token ?? raw?.token ?? null;
  const qrBase64: string | null = raw?.qrcode?.base64 ?? raw?.qrcode?.code ?? null;
  const pairingCode: string | null = raw?.qrcode?.pairingCode ?? null;

  return {
    ok: true,
    status: res.status,
    body: {
      instanceName: args.instanceName,
      token: typeof token === 'string' ? token : null,
      qrBase64: typeof qrBase64 === 'string' ? qrBase64 : null,
      pairingCode: typeof pairingCode === 'string' ? pairingCode : null,
      raw,
    },
  };
}

export interface EvoConnectResult {
  qrBase64: string | null;
  /** Raw QR payload string (Evolution's `code`) - lets the frontend RENDER the QR
   *  itself (styled, WhatsApp-like) instead of showing Evolution's pre-baked PNG. */
  qrCode: string | null;
  pairingCode: string | null;
  /** Evolution reports 'open' | 'connecting' | 'close'. */
  state: string | null;
  raw: unknown;
}

/**
 * Fetch a fresh QR (or pairing code) for an existing instance. Evolution:
 * GET /instance/connect/{instance}?number=<E164 optional for pairing code>.
 */
export async function evoConnect(args: {
  instanceName: string;
  instanceToken?: string | null;
  pairingNumber?: string | null;
}): Promise<EvoResult<EvoConnectResult>> {
  const qs = args.pairingNumber ? `?number=${encodeURIComponent(toEvoNumber(args.pairingNumber))}` : '';
  const res = await evoFetch<EvoRawBody>('GET', `/instance/connect/${encodeURIComponent(args.instanceName)}${qs}`, {
    instanceToken: args.instanceToken,
  });
  if (!res.ok) return evoFailResult<EvoConnectResult>(res);
  const raw = res.body;
  return {
    ok: true,
    status: res.status,
    body: {
      qrBase64: typeof raw?.base64 === 'string' ? raw.base64 : (typeof raw?.qrcode?.base64 === 'string' ? raw.qrcode.base64 : null),
      qrCode: typeof raw?.code === 'string' ? raw.code : (typeof raw?.qrcode?.code === 'string' ? raw.qrcode.code : null),
      pairingCode: typeof raw?.pairingCode === 'string' ? raw.pairingCode : (typeof raw?.qrcode?.pairingCode === 'string' ? raw.qrcode.pairingCode : null),
      state: typeof raw?.instance?.state === 'string' ? raw.instance.state : null,
      raw,
    },
  };
}

/** GET /instance/connectionState/{instance} → 'open' | 'connecting' | 'close'. */
export async function evoConnectionState(args: {
  instanceName: string;
  instanceToken?: string | null;
}): Promise<EvoResult<{ state: string | null; raw: unknown }>> {
  const res = await evoFetch<EvoRawBody>('GET', `/instance/connectionState/${encodeURIComponent(args.instanceName)}`, {
    instanceToken: args.instanceToken,
  });
  if (!res.ok) return res as EvoResult<{ state: string | null; raw: unknown }>;
  const raw = res.body;
  const state =
    typeof raw?.instance?.state === 'string' ? raw.instance.state :
    typeof raw?.state === 'string' ? raw.state : null;
  return { ok: true, status: res.status, body: { state, raw } };
}

/** Log the instance out of WhatsApp (drops the companion link) without deleting it. */
export async function evoLogout(args: { instanceName: string; instanceToken?: string | null }): Promise<EvoResult> {
  return evoFetch('DELETE', `/instance/logout/${encodeURIComponent(args.instanceName)}`, {
    instanceToken: args.instanceToken,
  });
}

/** Delete the instance entirely (frees the session slot). */
export async function evoDeleteInstance(args: { instanceName: string; instanceToken?: string | null }): Promise<EvoResult> {
  return evoFetch('DELETE', `/instance/delete/${encodeURIComponent(args.instanceName)}`, {
    instanceToken: args.instanceToken,
  });
}

/**
 * Change (or clear) the outbound proxy on an EXISTING instance without deleting it.
 * POST /proxy/set/{instance}. Body uses host/port/protocol/username/password, which
 * is DIFFERENT from the instance-create DTO's proxyHost/proxyPort/... names: the
 * set-proxy DTO (SetProxyDto) is a distinct shape. Verified empirically 2026-09-10
 * against the deployed rig: the proxyHost* names return 400 ("instance requires
 * property host, port, protocol"); host* returns 201. Pass proxyUrl=null to DISABLE.
 *
 * NOTE: a change only takes effect after the socket reconnects - call
 * evoRestartInstance() right after. This is the mechanism behind a seamless proxy
 * SWAP: the WhatsApp credentials are stored independently of the egress, so
 * set-proxy + restart reconnects on the SAME creds (no QR re-pair).
 */
export async function evoSetProxy(args: {
  instanceName: string;
  proxyUrl: string | null;
  instanceToken?: string | null;
}): Promise<EvoResult> {
  if (!args.proxyUrl) {
    return evoFetch('POST', `/proxy/set/${encodeURIComponent(args.instanceName)}`, {
      body: { enabled: false },
      instanceToken: args.instanceToken,
    });
  }
  const p = parseProxyUrl(args.proxyUrl);
  if (!p) {
    return { ok: false, status: null, body: null, error: `unparseable proxy url` };
  }
  const body: Record<string, unknown> = {
    enabled: true,
    host: p.host,
    port: p.port,
    protocol: p.protocol,
  };
  if (p.username) body.username = p.username;
  if (p.password) body.password = p.password;
  return withProxyHoldRetry(`set-proxy ${args.instanceName}`, () =>
    evoFetch('POST', `/proxy/set/${encodeURIComponent(args.instanceName)}`, {
      body,
      instanceToken: args.instanceToken,
    }),
  );
}

/**
 * Restart an instance's socket. Reconnects using the STORED credentials - no new
 * QR - so it's the safe way to apply a proxy change (see evoSetProxy) or nudge a
 * stuck session. POST /instance/restart/{instance}.
 */
export async function evoRestartInstance(args: { instanceName: string; instanceToken?: string | null }): Promise<EvoResult> {
  return evoFetch('POST', `/instance/restart/${encodeURIComponent(args.instanceName)}`, {
    instanceToken: args.instanceToken,
  });
}

/** List all instances (used by delete-verification, mirroring WHAPI /channels/list). */
export async function evoListInstances(): Promise<EvoResult<EvoRawBody[]>> {
  const res = await evoFetch<EvoRawBody[]>('GET', '/instance/fetchInstances');
  if (!res.ok) return res as EvoResult<EvoRawBody[]>;
  const arr = Array.isArray(res.body) ? res.body : [];
  return { ok: true, status: res.status, body: arr };
}

// ─── Messaging primitives ──────────────────────────────────────────────────

export interface EvoSendResult {
  messageId: string | null;
  raw: unknown;
}

/**
 * Build a send result AND remember the message id so the inbound handler drops
 * its own echo (Evolution re-delivers every send as a fromMe event). Every
 * Evolution message send funnels through here. See sentMessageTracker.
 */
function buildSendResult(res: EvoResult<unknown>): EvoResult<EvoSendResult> {
  const messageId = extractEvoMessageId(res.body);
  recordSentEvolutionMessageId(messageId);
  return { ok: true, status: res.status, body: { messageId, raw: res.body } };
}

/** POST /message/sendText/{instance}. */
export async function evoSendText(args: {
  instanceName: string;
  instanceToken?: string | null;
  to: string;
  body: string;
}): Promise<EvoResult<EvoSendResult>> {
  const res = await evoFetch<EvoRawBody>('POST', `/message/sendText/${encodeURIComponent(args.instanceName)}`, {
    instanceToken: args.instanceToken,
    body: { number: toEvoNumber(args.to), text: args.body },
  });
  if (!res.ok) return evoFailResult<EvoSendResult>(res);
  return buildSendResult(res);
}

export type EvoMediaType = 'image' | 'video' | 'document' | 'audio';

/**
 * POST /message/sendMedia/{instance} (or sendWhatsAppAudio for ptt audio).
 * `media` is a public URL or base64 (Evolution accepts both).
 */
export async function evoSendMedia(args: {
  instanceName: string;
  instanceToken?: string | null;
  to: string;
  mediaType: EvoMediaType;
  media: string;
  caption?: string;
  fileName?: string;
  mimetype?: string;
}): Promise<EvoResult<EvoSendResult>> {
  if (args.mediaType === 'audio') {
    const res = await evoFetch<EvoRawBody>('POST', `/message/sendWhatsAppAudio/${encodeURIComponent(args.instanceName)}`, {
      instanceToken: args.instanceToken,
      body: { number: toEvoNumber(args.to), audio: args.media },
    });
    if (!res.ok) return evoFailResult<EvoSendResult>(res);
    return buildSendResult(res);
  }
  const res = await evoFetch<EvoRawBody>('POST', `/message/sendMedia/${encodeURIComponent(args.instanceName)}`, {
    instanceToken: args.instanceToken,
    body: {
      number: toEvoNumber(args.to),
      mediatype: args.mediaType,
      media: args.media,
      caption: args.caption,
      fileName: args.fileName,
      mimetype: args.mimetype,
    },
  });
  if (!res.ok) return evoFailResult<EvoSendResult>(res);
  return buildSendResult(res);
}

/**
 * WhatsApp Status (Story). POST /message/sendStatus/{instance}.
 *
 * Who sees it is the explicit `statusJidList` (full JIDs). We never use Evolution's
 * `allContacts`: it throws "Contacts not found" when the instance has no saved
 * contacts, and it would also hand groups / @lid entries to the send. The caller
 * builds the list (see evolutionStatus.ts).
 *
 * Evolution's rules (our own fork of Evolution, 2026-10-06 status patch):
 *   - text: `backgroundColor` required; `font` is a WhatsApp font code 0..10
 *     (upstream only took 1..5; which codes are real fonts is in evolutionStatus.ts);
 *     `textColor` sets the text color (upstream had none).
 *   - image/video `content` is a public URL that Evolution downloads.
 * It sends to the list in batches of 10 under one message id, so a long list takes
 * a while: callers pass a long timeout.
 */
export async function evoSendStatus(args: {
  instanceName: string;
  instanceToken?: string | null;
  type: 'text' | 'image' | 'video';
  content: string;
  caption?: string | null;
  backgroundColor?: string | null;
  textColor?: string | null;
  font?: number | null;
  statusJidList: string[];
  timeoutMs?: number;
}): Promise<EvoResult<EvoSendResult>> {
  const body: Record<string, unknown> = {
    type: args.type,
    content: args.content,
    statusJidList: args.statusJidList,
  };
  if (args.caption) body.caption = args.caption;
  if (args.backgroundColor) body.backgroundColor = args.backgroundColor;
  if (args.textColor) body.textColor = args.textColor;
  if (args.font != null) body.font = args.font;
  const res = await evoFetch<EvoRawBody>('POST', `/message/sendStatus/${encodeURIComponent(args.instanceName)}`, {
    instanceToken: args.instanceToken,
    body,
    timeoutMs: args.timeoutMs,
  });
  if (!res.ok) return evoFailResult<EvoSendResult>(res);
  return buildSendResult(res);
}

/**
 * Delete (revoke) a status we posted: DELETE /chat/deleteMessageForEveryone (JSON
 * body; the route is DELETE, not POST) with remoteJid status@broadcast. A status
 * revoke is delivered like the status itself, so it needs the recipient list
 * (`statusJidList`, our fork's 2026-10-06 patch; upstream sent it to nobody). A
 * superset of the original list is fine.
 */
export async function evoDeleteStatus(args: {
  instanceName: string;
  instanceToken?: string | null;
  messageId: string;
  statusJidList: string[];
  timeoutMs?: number;
}): Promise<EvoResult> {
  return evoFetch('DELETE', `/chat/deleteMessageForEveryone/${encodeURIComponent(args.instanceName)}`, {
    instanceToken: args.instanceToken,
    body: {
      id: args.messageId,
      remoteJid: 'status@broadcast',
      fromMe: true,
      statusJidList: args.statusJidList,
    },
    timeoutMs: args.timeoutMs,
  });
}

/**
 * The person JIDs (`<digits>@s.whatsapp.net`) Evolution has saved for an instance:
 * the phone's address book plus everyone who messaged it, when the Evolution
 * service runs with DATABASE_SAVE_DATA_CONTACTS=true. POST /chat/findContacts.
 * Groups, @lid, broadcast and status entries are dropped.
 */
export async function evoFindContactJids(args: {
  instanceName: string;
  instanceToken?: string | null;
}): Promise<EvoResult<string[]>> {
  const res = await evoFindContactList(args);
  if (!res.ok) return evoFailResult<string[]>(res);
  return { ok: true, status: res.status, body: (res.body ?? []).map((c) => c.jid) };
}

/**
 * POST /chat/findContacts/{instance}: the instance's saved contacts with the name
 * WhatsApp knows them by (pushName, may be null). Phone-number contacts only
 * (hidden-number @lid entries cannot be addressed as a status recipient).
 */
export async function evoFindContactList(args: {
  instanceName: string;
  instanceToken?: string | null;
}): Promise<EvoResult<{ jid: string; name: string | null }[]>> {
  const res = await evoFetch<EvoRawBody[]>('POST', `/chat/findContacts/${encodeURIComponent(args.instanceName)}`, {
    instanceToken: args.instanceToken,
    body: { where: {} },
    timeoutMs: 30_000,
  });
  if (!res.ok) return evoFailResult<{ jid: string; name: string | null }[]>(res);
  const rows = Array.isArray(res.body) ? res.body : [];
  const out: { jid: string; name: string | null }[] = [];
  for (const r of rows) {
    const jid = typeof r?.remoteJid === 'string' ? r.remoteJid : '';
    if (!/^\d{6,15}@s\.whatsapp\.net$/.test(jid)) continue;
    const name = typeof r?.pushName === 'string' && r.pushName.trim() ? r.pushName.trim() : null;
    out.push({ jid, name });
  }
  return { ok: true, status: res.status, body: out };
}

/** POST /chat/sendPresence/{instance} - typing / recording / paused / available. */
export async function evoSendPresence(args: {
  instanceName: string;
  instanceToken?: string | null;
  to: string;
  presence: 'composing' | 'recording' | 'paused' | 'available' | 'unavailable';
  delayMs?: number;
}): Promise<EvoResult> {
  return evoFetch('POST', `/chat/sendPresence/${encodeURIComponent(args.instanceName)}`, {
    instanceToken: args.instanceToken,
    body: {
      number: toEvoNumber(args.to),
      presence: args.presence,
      delay: args.delayMs,
    },
  });
}

/**
 * POST /chat/markMessageAsRead/{instance}. Evolution wants the full message key
 * {remoteJid, fromMe, id}. We pass fromMe=false (we only mark inbound read) and
 * reconstruct remoteJid from the sender digits.
 */
export async function evoMarkRead(args: {
  instanceName: string;
  instanceToken?: string | null;
  remoteJidDigits: string;
  messageId: string;
}): Promise<EvoResult> {
  return evoFetch('POST', `/chat/markMessageAsRead/${encodeURIComponent(args.instanceName)}`, {
    instanceToken: args.instanceToken,
    body: {
      readMessages: [
        {
          remoteJid: `${toEvoNumber(args.remoteJidDigits)}@s.whatsapp.net`,
          fromMe: false,
          id: args.messageId,
        },
      ],
    },
  });
}

/**
 * The chat address (remoteJid) Evolution stored for one of its messages, via
 * POST /chat/findMessages. Under WhatsApp's LID addressing a chat is often stored as
 * `<lid>@lid`, not `<phone>@s.whatsapp.net`, and Evolution's edit refuses ("RemoteJid
 * does not match") unless we send back exactly the stored form. null when the message
 * is not in Evolution's store (or the lookup failed); callers fall back to the phone form.
 */
export async function evoFindStoredRemoteJid(args: {
  instanceName: string;
  instanceToken?: string | null;
  messageId: string;
}): Promise<string | null> {
  const res = await evoFetch<{ messages?: { records?: Array<{ key?: { remoteJid?: unknown } }> } }>(
    'POST',
    `/chat/findMessages/${encodeURIComponent(args.instanceName)}`,
    { instanceToken: args.instanceToken, body: { where: { key: { id: args.messageId } } } },
  );
  if (!res.ok) return null;
  const jid = res.body?.messages?.records?.[0]?.key?.remoteJid;
  return typeof jid === 'string' && jid.includes('@') ? jid : null;
}

/**
 * Edit a TEXT message we sent: POST /chat/updateMessage/{instance}. Evolution only
 * supports editing text (its own TODO for media). It looks up the original by key.id
 * and requires key.remoteJid to equal the jid built from `number`, so both are the
 * chat address Evolution STORED for the message (an @lid address under LID addressing;
 * see evoFindStoredRemoteJid). WhatsApp itself rejects edits older than 15 minutes
 * (Evolution's own age check never fires: it compares seconds to milliseconds), so
 * callers check the age first.
 */
export async function evoUpdateMessage(args: {
  instanceName: string;
  instanceToken?: string | null;
  /** The stored chat address (`...@lid` or `...@s.whatsapp.net`). */
  remoteJid: string;
  messageId: string;
  text: string;
}): Promise<EvoResult> {
  return evoFetch('POST', `/chat/updateMessage/${encodeURIComponent(args.instanceName)}`, {
    instanceToken: args.instanceToken,
    body: {
      number: args.remoteJid,
      text: args.text,
      key: { id: args.messageId, remoteJid: args.remoteJid, fromMe: true },
    },
  });
}

/** DELETE /chat/deleteMessageForEveryone/{instance} (JSON body). Evolution's route is
 *  DELETE; this used POST, which Evolution does not route. */
export async function evoDeleteMessage(args: {
  instanceName: string;
  instanceToken?: string | null;
  /** The chat address Evolution stored for the message (`...@lid` or `...@s.whatsapp.net`;
   *  see evoFindStoredRemoteJid). A revoke sent to the other form may not reach the chat. */
  remoteJid: string;
  messageId: string;
  fromMe: boolean;
}): Promise<EvoResult> {
  return evoFetch('DELETE', `/chat/deleteMessageForEveryone/${encodeURIComponent(args.instanceName)}`, {
    instanceToken: args.instanceToken,
    body: {
      id: args.messageId,
      remoteJid: args.remoteJid,
      fromMe: args.fromMe,
    },
  });
}

/**
 * Fetch a media message's bytes as base64. Evolution:
 * POST /chat/getBase64FromMediaMessage/{instance} with the message key.
 * Returns { base64, mimetype } on success. Used by the voice/transcription
 * pipeline (the Evolution twin of WHAPI's GET /media/{voice_id}).
 */
export async function evoGetBase64Media(args: {
  instanceName: string;
  instanceToken?: string | null;
  messageId: string;
  /** Whether to have Evolution convert audio to a standard format (mp3/ogg). */
  convertToMp4?: boolean;
}): Promise<EvoResult<{ base64: string | null; mimetype: string | null }>> {
  const res = await evoFetch<EvoRawBody>('POST', `/chat/getBase64FromMediaMessage/${encodeURIComponent(args.instanceName)}`, {
    instanceToken: args.instanceToken,
    body: {
      message: { key: { id: args.messageId } },
      convertToMp4: args.convertToMp4 ?? false,
    },
  });
  if (!res.ok) return res as EvoResult<{ base64: string | null; mimetype: string | null }>;
  const raw = res.body;
  return {
    ok: true,
    status: res.status,
    body: {
      base64: typeof raw?.base64 === 'string' ? raw.base64 : null,
      mimetype: typeof raw?.mimetype === 'string' ? raw.mimetype : null,
    },
  };
}

function extractEvoMessageId(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { key?: { id?: unknown }; messageId?: unknown; id?: unknown };
  if (r.key?.id) return String(r.key.id);
  if (r.messageId) return String(r.messageId);
  if (r.id) return String(r.id);
  return null;
}
