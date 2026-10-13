/**
 * Superadmin endpoints for the self-hosted voice agent. Mounted at
 * /api/voice-agent/admin, gated by requireSuperAdmin (same posture as
 * /api/retell/admin). Backs the "Self-hosted" tab on the superadmin Retell page.
 *
 *   GET  /health                         voice-rt reachability + capacity
 *   GET  /numbers                        every AI-enabled voice number + provider
 *   PUT  /numbers/:voiceNumberId/provider {provider} per-number cutover
 *   GET  /sessions                       pending/live/ended sessions in memory
 *   POST /sessions/:id/inject            {additional_context, trigger_response, speak_verbatim}
 *   POST /sessions/:id/hangup
 */
import { Router, type Request, type Response } from 'express';
import { requireSuperAdmin } from '../../middleware/superAdminAuth.js';
import { supabaseAdmin } from '../../config/supabase.js';
import { config } from '../../config/env.js';
import { reportError } from '../../utils/errorReporter.js';
import { listSessions, getSession, liveSessionCount } from '../sessionStore.js';
import { voiceRtHealth, voiceRtInject, voiceRtHangup, VoiceRtUnavailableError } from '../rtClient.js';
import { switchAiProvider, ProviderSwitchError } from '../provider.js';
import { VOICE_AGENT_FLAG_KEY } from '../gate.js';
import { startOutboundCall, OutboundError } from '../outbound.js';
import { lamlEndCall } from '../../voice/conferenceOrchestrate.js';

export const voiceAgentAdminRouter: Router = Router();
voiceAgentAdminRouter.use(requireSuperAdmin);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

voiceAgentAdminRouter.get('/health', async (_req: Request, res: Response) => {
  // Gate status: master switch + how many companies/locations the flag targets.
  let targeted = { companies: 0, locations: 0 };
  try {
    const { data } = await supabaseAdmin
      .from('retell_prompt_flags')
      .select('company_ids, location_ids')
      .eq('key', VOICE_AGENT_FLAG_KEY)
      .maybeSingle();
    const row = data as { company_ids?: string[] | null; location_ids?: string[] | null } | null;
    targeted = { companies: row?.company_ids?.length ?? 0, locations: row?.location_ids?.length ?? 0 };
  } catch {
    // shown as 0/0; the gate itself fails closed on read errors
  }
  const base = {
    master_enabled: config.voiceAgentEnabled,
    gate_flag_key: VOICE_AGENT_FLAG_KEY,
    targeted,
    configured: !!config.voiceRtUrl,
    voice_rt_url: config.voiceRtUrl || null,
    default_provider: config.voiceAgentDefaultProvider,
    default_engine: config.voiceAgentDefaultEngine,
    live_sessions_here: liveSessionCount(),
  };
  if (!config.voiceRtUrl) {
    res.json({ ...base, reachable: false, runtime: null });
    return;
  }
  try {
    const runtime = await voiceRtHealth();
    res.json({ ...base, reachable: true, runtime });
  } catch (err) {
    res.json({ ...base, reachable: false, runtime: null, error: err instanceof Error ? err.message : String(err) });
  }
});

voiceAgentAdminRouter.get('/numbers', async (_req: Request, res: Response) => {
  const { data, error } = await supabaseAdmin
    .from('voice_numbers')
    .select('id, company_id, location_id, phone_number, nickname, ai_provider, ai_active, ai_enabled_at, is_active, lifecycle_state')
    .not('ai_provider', 'is', null)
    .neq('lifecycle_state', 'deleted')
    .order('ai_enabled_at', { ascending: false })
    .limit(1000);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  const rows = (data ?? []) as Array<{
    id: string; company_id: string; location_id: string | null; phone_number: string; nickname: string | null;
    ai_provider: string | null; ai_active: boolean | null; ai_enabled_at: string | null; is_active: boolean; lifecycle_state: string;
  }>;
  const companyIds = [...new Set(rows.map((r) => r.company_id))];
  const locationIds = [...new Set(rows.map((r) => r.location_id).filter((x): x is string => !!x))];
  const [companies, locations] = await Promise.all([
    companyIds.length
      ? supabaseAdmin.from('companies').select('id, company_name').in('id', companyIds)
      : Promise.resolve({ data: [] as Array<{ id: string; company_name: string }> }),
    locationIds.length
      ? supabaseAdmin.from('locations').select('id, name').in('id', locationIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
  ]);
  const companyName = new Map((companies.data ?? []).map((c) => [c.id as string, (c as { company_name?: string }).company_name ?? '']));
  const locationName = new Map((locations.data ?? []).map((l) => [l.id as string, (l as { name?: string }).name ?? '']));
  res.json({
    numbers: rows.map((r) => ({
      ...r,
      company_name: companyName.get(r.company_id) ?? null,
      location_name: r.location_id ? locationName.get(r.location_id) ?? null : null,
    })),
  });
});

voiceAgentAdminRouter.put('/numbers/:voiceNumberId/provider', async (req: Request, res: Response) => {
  const id = String(req.params.voiceNumberId ?? '');
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: 'bad voice number id' });
    return;
  }
  const provider = (req.body as { provider?: unknown } | undefined)?.provider;
  if (provider !== 'retell' && provider !== 'pipecat') {
    res.status(400).json({ error: "provider must be 'retell' or 'pipecat'" });
    return;
  }
  try {
    const result = await switchAiProvider(id, provider);
    res.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof ProviderSwitchError) {
      res.status(err.httpStatus).json({ error: err.message, code: err.code });
      return;
    }
    reportError(err instanceof Error ? err : new Error(String(err)), {
      type: 'voice_agent_provider_switch_error',
      metadata: { source: 'voiceAgent.routes.admin.provider', voiceNumberId: id, provider },
    });
    res.status(500).json({ error: 'provider switch failed' });
  }
});

voiceAgentAdminRouter.get('/sessions', (_req: Request, res: Response) => {
  res.json({ sessions: listSessions() });
});

// Manual outbound test dial from the portal (same gate + path as the internal
// endpoint). Lets a superadmin place a self-hosted agent call to their own
// phone to hear it, without a script.
voiceAgentAdminRouter.post('/outbound-test', async (req: Request, res: Response) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const companyId = typeof b.company_id === 'string' ? b.company_id.trim() : '';
  const locationId = typeof b.location_id === 'string' ? b.location_id.trim() : null;
  const toNumber = typeof b.to_number === 'string' ? b.to_number.trim() : '';
  const fromNumber = typeof b.from_number === 'string' ? b.from_number.trim() : '';
  const objective =
    typeof b.objective === 'string' && b.objective.trim()
      ? b.objective.trim()
      : 'This is a test call to check the voice agent. Greet the person, confirm they can hear you clearly, ask if the audio sounds natural, then thank them and end the call.';
  if (!companyId || !toNumber || !fromNumber) {
    res.status(400).json({ error: 'company_id, to_number, from_number required' });
    return;
  }
  try {
    const result = await startOutboundCall({
      companyId,
      locationId: locationId && /^[0-9a-f-]{36}$/i.test(locationId) ? locationId : null,
      toNumber,
      fromNumber,
      objective,
      reason: 'superadmin_test',
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof OutboundError) {
      res.status(err.httpStatus).json({ error: err.message, code: err.code });
      return;
    }
    reportError(err instanceof Error ? err : new Error(String(err)), {
      type: 'voice_agent_outbound_error',
      metadata: { source: 'voiceAgent.routes.admin.outbound-test', company_id: companyId },
    });
    res.status(500).json({ error: 'outbound test failed' });
  }
});

voiceAgentAdminRouter.post('/sessions/:id/inject', async (req: Request, res: Response) => {
  const id = String(req.params.id ?? '');
  const session = getSession(id);
  if (!session || session.ended_at !== null) {
    res.status(404).json({ error: 'no live session with that id' });
    return;
  }
  const body = (req.body ?? {}) as { additional_context?: unknown; trigger_response?: unknown; speak_verbatim?: unknown };
  const payload = {
    additional_context: typeof body.additional_context === 'string' ? body.additional_context.slice(0, 4000) : undefined,
    trigger_response: body.trigger_response === true,
    speak_verbatim: typeof body.speak_verbatim === 'string' ? body.speak_verbatim.slice(0, 1000) : undefined,
  };
  if (!payload.additional_context && !payload.speak_verbatim) {
    res.status(400).json({ error: 'additional_context or speak_verbatim required' });
    return;
  }
  try {
    const r = await voiceRtInject(id, payload);
    res.json(r);
  } catch (err) {
    const status = err instanceof VoiceRtUnavailableError ? 503 : 502;
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

voiceAgentAdminRouter.post('/sessions/:id/hangup', async (req: Request, res: Response) => {
  const id = String(req.params.id ?? '');
  const session = getSession(id);
  if (!session || session.ended_at !== null) {
    res.status(404).json({ error: 'no live session with that id' });
    return;
  }
  let runtimeOk = false;
  try {
    runtimeOk = (await voiceRtHangup(id, 'superadmin')).ok;
  } catch {
    runtimeOk = false;
  }
  // Belt and braces: end the PSTN leg via SignalWire too.
  const carrierOk = await lamlEndCall(session.call_sid).catch(() => false);
  res.json({ ok: runtimeOk || carrierOk, runtime: runtimeOk, carrier: carrierOk });
});
