/**
 * app-server -> voice-rt HTTP client (the reverse direction of routes/rt.ts).
 *
 * Used for: health, the mid-call push (inject context + trigger a response,
 * Retell `update-live-call` parity and beyond), and an operator-initiated
 * hangup. voice-rt authenticates us with the same shared secret it sends us.
 */
import { config } from '../config/env.js';

export class VoiceRtUnavailableError extends Error {
  constructor(message = 'VOICE_RT_URL is not configured') {
    super(message);
    this.name = 'VoiceRtUnavailableError';
  }
}

async function rtFetch<T>(path: string, init: { method: 'GET' | 'POST'; body?: unknown; timeoutMs?: number } = { method: 'GET' }): Promise<T> {
  if (!config.voiceRtUrl) throw new VoiceRtUnavailableError();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 5000);
  try {
    const res = await fetch(`${config.voiceRtUrl}${path}`, {
      method: init.method,
      headers: {
        'Content-Type': 'application/json',
        'X-Voice-Agent-Secret': config.voiceAgentSharedSecret,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
    if (!res.ok) {
      const msg = (json as { detail?: string; error?: string } | null)?.detail
        ?? (json as { error?: string } | null)?.error
        ?? `voice-rt ${res.status}`;
      throw new Error(`voice-rt ${init.method} ${path} failed: ${msg}`);
    }
    return json as T;
  } finally {
    clearTimeout(timer);
  }
}

export interface VoiceRtHealth {
  status: string;
  version?: string;
  pipecat_version?: string;
  active_calls?: number;
  capacity?: number | null;
}

export async function voiceRtHealth(): Promise<VoiceRtHealth> {
  return rtFetch<VoiceRtHealth>('/health', { method: 'GET', timeoutMs: 4000 });
}

/**
 * Push text into a LIVE call. `additional_context` lands in the model's
 * context as a system-level note; `trigger_response` makes the agent speak
 * right away (interrupting if needed). `speak_verbatim` bypasses the model and
 * has TTS say the text as-is.
 */
export async function voiceRtInject(sessionId: string, body: {
  additional_context?: string;
  trigger_response?: boolean;
  speak_verbatim?: string;
}): Promise<{ ok: boolean }> {
  return rtFetch<{ ok: boolean }>(`/sessions/${encodeURIComponent(sessionId)}/inject`, { method: 'POST', body });
}

export async function voiceRtHangup(sessionId: string, reason = 'operator'): Promise<{ ok: boolean }> {
  return rtFetch<{ ok: boolean }>(`/sessions/${encodeURIComponent(sessionId)}/hangup`, { method: 'POST', body: { reason } });
}
