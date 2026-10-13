/**
 * Internal API for voice-rt (the Pipecat runtime). Mounted at
 * /api/internal/voice-agent. Auth: `X-Voice-Agent-Secret` shared secret,
 * constant-time compared. voice-rt holds NO Supabase key; everything it needs
 * comes through here and is scoped by the session it was minted for.
 *
 *   GET  /sessions/:id            claim (single-use) -> VoiceRtSessionContext
 *   POST /sessions/:id/tool-call  {name, arguments, step} -> {ok, result, error}
 *   POST /sessions/:id/events     {type, ...} live telemetry (state, turn)
 *   PUT  /sessions/:id/recording  raw audio/wav -> {path}
 *   POST /sessions/:id/end        VoiceRtEndPayload -> 202 (finalizes async)
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { config } from '../../config/env.js';
import { supabaseAdmin } from '../../config/supabase.js';
import { reportError } from '../../utils/errorReporter.js';
import { claimSession, getSession } from '../sessionStore.js';
import { dispatchVoiceTool } from '../tools.js';
import { finalizeVoiceAgentCall } from '../postCall.js';
import { VOICE_AGENT_STATES, type VoiceAgentState, type VoiceRtEndPayload } from '../types.js';

const RECORDINGS_BUCKET = 'phone_call_recordings';
const SESSION_ID_RE = /^vrt_[0-9a-f]{32}$/;

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export function requireVoiceAgentSecret(req: Request, res: Response, next: NextFunction): void {
  const expected = config.voiceAgentSharedSecret;
  if (!expected) {
    // Fail CLOSED: an unset secret must never mean "open".
    res.status(503).json({ error: 'voice agent secret not configured' });
    return;
  }
  const provided = req.headers['x-voice-agent-secret'];
  if (typeof provided !== 'string' || !constantTimeEqual(provided, expected)) {
    res.status(401).json({ error: 'invalid voice agent secret' });
    return;
  }
  next();
}

export const voiceAgentRtRouter: Router = Router();
voiceAgentRtRouter.use(requireVoiceAgentSecret);

function sessionIdParam(req: Request, res: Response): string | null {
  const id = String(req.params.id ?? '');
  if (!SESSION_ID_RE.test(id)) {
    res.status(400).json({ error: 'bad session id' });
    return null;
  }
  return id;
}

voiceAgentRtRouter.get('/sessions/:id', (req: Request, res: Response) => {
  const id = sessionIdParam(req, res);
  if (!id) return;
  const claimed = claimSession(id);
  if (!claimed.ok) {
    // 410 tells the runtime to close the stream: SignalWire then runs the
    // cXML that follows <Connect> (a hangup), so the caller is never parked.
    res.status(claimed.reason === 'not_found' ? 404 : 410).json({ error: claimed.reason });
    return;
  }
  res.json(claimed.session.context);
});

voiceAgentRtRouter.post('/sessions/:id/tool-call', async (req: Request, res: Response) => {
  const id = sessionIdParam(req, res);
  if (!id) return;
  const session = getSession(id);
  if (!session || session.connected_at === null) {
    res.status(404).json({ ok: false, error: 'unknown session' });
    return;
  }
  const body = (req.body ?? {}) as { name?: unknown; arguments?: unknown; step?: unknown };
  const name = typeof body.name === 'string' ? body.name : '';
  if (!name) {
    res.status(400).json({ ok: false, error: 'name required' });
    return;
  }
  const args = body.arguments && typeof body.arguments === 'object' ? (body.arguments as Record<string, unknown>) : {};
  const step = typeof body.step === 'number' ? body.step : 0;
  const result = await dispatchVoiceTool(session, name, args, step);
  res.json(result);
});

voiceAgentRtRouter.post('/sessions/:id/events', (req: Request, res: Response) => {
  const id = sessionIdParam(req, res);
  if (!id) return;
  const session = getSession(id);
  if (!session) {
    res.status(404).json({ ok: false });
    return;
  }
  const body = (req.body ?? {}) as {
    type?: unknown; state?: unknown; turns?: unknown;
    provider?: unknown; error_class?: unknown; message?: unknown; from?: unknown; to?: unknown; reason?: unknown;
  };
  session.live.last_event_at = Date.now();
  if (body.type === 'state' && typeof body.state === 'string' && (VOICE_AGENT_STATES as string[]).includes(body.state)) {
    session.live.state = body.state as VoiceAgentState;
  }
  if (body.type === 'turn' && typeof body.turns === 'number') {
    session.live.turns = body.turns;
  }
  if (body.type === 'error') {
    // A provider (Deepgram STT / OpenAI LLM or Realtime / ElevenLabs TTS) failed
    // DURING a live call, inside voice-rt. voice-rt is a separate Python process
    // with no reportError of its own, so it POSTs the failure here and THIS is
    // the only place it enters our alert pipeline. The "we ran out of money on a
    // service" case shows up as error_class auth_failure / quota_exhausted, which
    // must page immediately and can never be silenced (a dead provider = the AI
    // phone line is down for that customer). Mirrors callOpenAi's classification.
    const providerName = typeof body.provider === 'string' ? body.provider : 'unknown';
    const errorClass = typeof body.error_class === 'string' ? body.error_class : 'provider_error';
    const providerMsg = typeof body.message === 'string' ? body.message.slice(0, 500) : '';
    const pageWorthy = errorClass === 'auth_failure' || errorClass === 'quota_exhausted';
    const subject = errorClass === 'auth_failure'
      ? `[CRITICAL] Voice agent provider key broken: ${providerName}`
      : errorClass === 'quota_exhausted'
        ? `[CRITICAL] Voice agent provider out of funds/quota: ${providerName}`
        : `Voice agent provider error (${providerName}/${errorClass})`;
    reportError(new Error(`${subject}: ${providerMsg}`), {
      // `:critical` structurally forces a page and defeats any silent flag.
      type: pageWorthy ? 'voice_agent_provider_failure:critical' : 'voice_agent_provider_failure',
      metadata: {
        source: 'voiceAgent.routes.rt.events',
        provider: providerName,
        error_class: errorClass,
        provider_message: providerMsg,
        company_id: session.company_id,
        location_id: session.location_id,
        session_id: id,
        note: pageWorthy
          ? 'A voice-agent provider rejected on auth/quota mid-call: the AI phone line is DOWN for this company until the provider account is fixed (topped up / key rotated).'
          : 'A voice-agent provider errored mid-call.',
      },
    });
  }
  if (body.type === 'engine_fallback') {
    // The Lifelike (s2s) engine failed to build and we degraded to chained at
    // connect time. One-off is benign (chained still served the call), so track
    // it silently; a flood means s2s is broken for everyone and must surface.
    reportError(new Error(`Voice agent engine fell back ${String(body.from)} -> ${String(body.to)}: ${String(body.reason).slice(0, 300)}`), {
      type: 'voice_agent_engine_fallback',
      dedupe: 'silent',
      escalateAfter: 10,
      metadata: {
        source: 'voiceAgent.routes.rt.events',
        from: String(body.from ?? ''),
        to: String(body.to ?? ''),
        reason: String(body.reason ?? '').slice(0, 300),
        company_id: session.company_id,
        location_id: session.location_id,
        session_id: id,
      },
    });
  }
  res.json({ ok: true });
});

/**
 * Raw WAV upload. Stored under {company_id}/{session_id}.wav in the same bucket
 * the Retell recordings live in, so the existing recording UI plays it.
 */
voiceAgentRtRouter.put('/sessions/:id/recording', async (req: Request, res: Response) => {
  const id = sessionIdParam(req, res);
  if (!id) return;
  const session = getSession(id);
  if (!session) {
    res.status(404).json({ error: 'unknown session' });
    return;
  }
  const buf = req.body as Buffer | undefined;
  if (!buf || !Buffer.isBuffer(buf) || buf.length === 0) {
    res.status(400).json({ error: 'empty body' });
    return;
  }
  const contentType = (req.headers['content-type'] as string | undefined) || 'audio/wav';
  const ext = contentType.includes('mpeg') || contentType.includes('mp3') ? 'mp3' : 'wav';
  const path = `${session.company_id}/${session.session_id}.${ext}`;
  const { error } = await supabaseAdmin.storage
    .from(RECORDINGS_BUCKET)
    .upload(path, buf, { contentType, upsert: true });
  if (error) {
    reportError(new Error(`voice-agent recording upload failed: ${error.message}`), {
      type: 'voice_agent_recording_upload_error',
      metadata: { source: 'voiceAgent.routes.rt.recording', session_id: id, company_id: session.company_id, bytes: buf.length },
    });
    res.status(500).json({ error: 'upload failed' });
    return;
  }
  session.recording_bucket_path = path;
  // If the call already finalized (recording arrived late), link it now.
  if (session.finalized_at !== null) {
    await supabaseAdmin
      .from('call_history')
      .update({ recording_bucket_id: path })
      .eq('company_id', session.company_id)
      .eq('call_sid', session.session_id);
  }
  res.json({ ok: true, path });
});

voiceAgentRtRouter.post('/sessions/:id/end', (req: Request, res: Response) => {
  const id = sessionIdParam(req, res);
  if (!id) return;
  const session = getSession(id);
  if (!session) {
    res.status(404).json({ ok: false, error: 'unknown session' });
    return;
  }
  const end = req.body as VoiceRtEndPayload | undefined;
  if (!end || typeof end !== 'object' || !Array.isArray(end.transcript)) {
    res.status(400).json({ ok: false, error: 'invalid end payload' });
    return;
  }
  // Ack immediately; the runtime process is about to exit and must not wait
  // on our LLM analysis + storage work.
  res.status(202).json({ ok: true });
  void finalizeVoiceAgentCall(session, end).catch((err) => {
    reportError(err instanceof Error ? err : new Error(String(err)), {
      type: 'voice_agent_post_call_error',
      metadata: { source: 'voiceAgent.routes.rt.end', session_id: id, company_id: session.company_id },
    });
  });
});
