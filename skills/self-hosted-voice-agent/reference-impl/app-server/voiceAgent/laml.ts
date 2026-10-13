/**
 * cXML (LaML/TwiML) builders for the self-hosted voice agent.
 *
 * SignalWire is Twilio-compatible here: `<Connect><Stream url="wss://..."/>`
 * opens a bidirectional 8 kHz mu-law media stream to voice-rt for the life of
 * the call (the same verb the separate Voice-AI-Agent-Builder-Platform runs in
 * production on SignalWire). When the stream closes, `<Connect>` returns and
 * the document continues, so a trailing `<Hangup/>` (or a transfer `<Dial>`)
 * decides what happens after the AI leg ends.
 */
import { config } from '../config/env.js';

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function twimlDoc(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;
}

/**
 * Public wss:// base voice-rt listens on. VOICE_RT_PUBLIC_WS_URL wins; else
 * VOICE_RT_URL with the scheme swapped (https -> wss, http -> ws).
 */
export function voiceRtWsBase(): string | null {
  if (config.voiceRtPublicWsUrl) return config.voiceRtPublicWsUrl;
  if (!config.voiceRtUrl) return null;
  return config.voiceRtUrl.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:');
}

export function voiceRtStreamUrl(sessionId: string): string | null {
  const base = voiceRtWsBase();
  if (!base) return null;
  // session_id rides BOTH as a <Parameter> (primary) and on the URL query
  // (fallback). The query is belt-and-suspenders: if a Pipecat version exposes
  // SignalWire's customParameters under a different attribute than voice-rt
  // reads, the runtime still recovers the id from `?session_id=` on WS connect
  // and the call claims instead of dropping. The id is a short-TTL single-use
  // random token (useless after the one claim), so its presence in the WS URL
  // is not a meaningful disclosure.
  return `${base}/ws?session_id=${encodeURIComponent(sessionId)}`;
}

/**
 * The AI leg. `session_id` rides as a <Parameter> (SignalWire echoes custom
 * parameters in the media stream's `start` message as `customParameters`) AND
 * on the stream URL query as a fallback (see voiceRtStreamUrl). `after` is the
 * cXML that runs when the stream ends (default hang up).
 */
export function buildStreamTwiml(sessionId: string, opts: { after?: string } = {}): string | null {
  const url = voiceRtStreamUrl(sessionId);
  if (!url) return null;
  const after = opts.after ?? '<Hangup/>';
  return twimlDoc(
    `<Connect><Stream url="${xmlEscape(url)}">` +
      `<Parameter name="session_id" value="${xmlEscape(sessionId)}"/>` +
      `</Stream></Connect>${after}`,
  );
}

/** Cold transfer of the caller's leg to a human number. */
export function buildTransferTwiml(opts: { toE164: string; callerId: string; timeoutSec?: number }): string {
  const to = opts.toE164.startsWith('+') ? opts.toE164 : `+${opts.toE164}`;
  return twimlDoc(
    `<Dial callerId="${xmlEscape(opts.callerId)}" timeout="${opts.timeoutSec ?? 30}">${xmlEscape(to)}</Dial><Hangup/>`,
  );
}

export function buildHangupTwiml(): string {
  return twimlDoc('<Hangup/>');
}

/** Absolute URL SignalWire fetches when voice-rt asks us to transfer a live call. */
export function transferRedirectUrl(sessionId: string): string {
  return `${config.billingServerUrl}/api/voice/laml/voice-agent/transfer?session_id=${encodeURIComponent(sessionId)}`;
}
