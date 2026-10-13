/**
 * Operator-facing voice routes for the self-hosted phone agent, mounted at
 * /api/voice-agent/voices. GATED by the per-company cutover switch
 * (shouldUseSelfHosted): a company not switched on sees a locked list, so the
 * picker only does anything for a company testing the new system.
 *
 *   GET  /                 -> { catalog[], cloned[], selected }  (grouped by gender in the UI)
 *   PUT  /select           -> body { voice_key } saves location_prompt_variables.ai_voice_id
 *   POST /clone            -> multipart { clip, name, gender, consent } -> Cartesia clone -> store
 *
 * Auth: operator bearer token -> getUserCached -> users.company_id (blocked check).
 * Uses getSupabaseClient() (the server's shared service client), as the other
 * app-server routes do.
 */
import { Router, type Request, type Response } from 'express';
import { getUserCached } from '../../middleware/authUserCache.js';
import { getSupabaseClient } from '../../config/supabase.js';
import { reportError } from '../../utils/errorReporter.js';
import { config } from '../../config/env.js';
import { shouldUseSelfHosted } from '../gate.js';
import { canAccessLocation } from '../../operationsAgent/accessGate.js';
import { CARTESIA_VOICES } from '../cartesiaVoices.js';

interface AuthedCompany {
  userId: string;
  companyId: string;
  locationId: string | null;
}

async function authCompany(req: Request, res: Response): Promise<AuthedCompany | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization' });
    return null;
  }
  try {
    const user = await getUserCached(authHeader.slice(7));
    if (!user) {
      res.status(401).json({ error: 'Invalid token' });
      return null;
    }
    const db = getSupabaseClient();
    const { data: row } = await db
      .from('users')
      .select('id, company_id, is_blocked, role_id')
      .eq('id', user.id)
      .maybeSingle();
    const u = row as { id: string; company_id: string | null; is_blocked: boolean | null; role_id: string | null } | null;
    if (!u || u.is_blocked || !u.company_id) {
      res.status(403).json({ error: 'No access' });
      return null;
    }
    const locationId = typeof req.query.location_id === 'string' ? req.query.location_id : null;
    // location_id comes from the caller, so it must be proven before any route
    // reads or writes with it: the location belongs to the caller's company AND
    // the caller has access to it (same gate as the operations agent). Without
    // this, PUT /select could change another company's voice.
    if (locationId) {
      const { data: loc } = await db
        .from('locations')
        .select('id')
        .eq('id', locationId)
        .eq('company_id', u.company_id)
        .maybeSingle();
      if (!loc || !u.role_id || !(await canAccessLocation(u.id, u.role_id, locationId))) {
        res.status(403).json({ error: 'You do not have access to this location.' });
        return null;
      }
    }
    return { userId: u.id, companyId: u.company_id, locationId };
  } catch (err) {
    reportError(err instanceof Error ? err : new Error(String(err)), {
      type: 'voice_agent_voices_auth_error',
      dedupe: 'silent',
      metadata: { source: 'voiceAgent.routes.voices.authCompany' },
    });
    res.status(500).json({ error: 'auth failed' });
    return null;
  }
}

export const voiceAgentVoicesRouter: Router = Router();

voiceAgentVoicesRouter.get('/', async (req: Request, res: Response) => {
  const a = await authCompany(req, res);
  if (!a) return;
  const enabled = await shouldUseSelfHosted(a.companyId, a.locationId);
  if (!enabled) {
    res.json({ enabled: false, catalog: [], cloned: [], selected: null });
    return;
  }
  const db = getSupabaseClient();
  const { data: cloned } = await db
    .from('voice_agent_cloned_voices')
    .select('id, cartesia_voice_id, name, gender, language, created_at')
    .eq('company_id', a.companyId)
    .order('created_at', { ascending: false });
  let selected: string | null = null;
  if (a.locationId) {
    const { data: lpv } = await db
      .from('location_prompt_variables')
      .select('ai_voice_id')
      .eq('location_id', a.locationId)
      .maybeSingle();
    selected = (lpv as { ai_voice_id?: string | null } | null)?.ai_voice_id ?? null;
  }
  res.json({
    enabled: true,
    catalog: CARTESIA_VOICES,
    cloned: (cloned ?? []).map((c) => {
      const row = c as { id: string; cartesia_voice_id: string; name: string; gender: string; language: string };
      return { key: `cartesia:${row.cartesia_voice_id}:${row.gender}`, cartesia_id: row.cartesia_voice_id, name: row.name, gender: row.gender, accent: 'Your voice', description: 'Custom cloned voice.' };
    }),
    selected,
  });
});

voiceAgentVoicesRouter.put('/select', async (req: Request, res: Response) => {
  const a = await authCompany(req, res);
  if (!a) return;
  if (!a.locationId) {
    res.status(400).json({ error: 'location_id required' });
    return;
  }
  const voiceKey = typeof req.body?.voice_key === 'string' ? req.body.voice_key : '';
  if (!voiceKey) {
    res.status(400).json({ error: 'voice_key required' });
    return;
  }
  const db = getSupabaseClient();
  const isCatalog = CARTESIA_VOICES.some((v) => v.key === voiceKey);
  let ok = isCatalog;
  if (!ok && voiceKey.startsWith('cartesia:')) {
    const id = voiceKey.split(':')[1];
    const { data } = await db
      .from('voice_agent_cloned_voices')
      .select('id')
      .eq('company_id', a.companyId)
      .eq('cartesia_voice_id', id)
      .maybeSingle();
    ok = !!data;
  }
  if (!ok) {
    res.status(400).json({ error: 'unknown voice' });
    return;
  }
  const { error } = await db
    .from('location_prompt_variables')
    .update({ ai_voice_id: voiceKey })
    .eq('location_id', a.locationId);
  if (error) {
    reportError(new Error(`voice select failed: ${error.message}`), {
      type: 'voice_agent_voice_select_error',
      metadata: { source: 'voiceAgent.routes.voices.select', companyId: a.companyId, locationId: a.locationId },
    });
    res.status(500).json({ error: 'could not save voice' });
    return;
  }
  res.json({ ok: true, selected: voiceKey });
});

/**
 * Preview: synthesize a fixed sample line in a voice so the operator can hear it
 * in the picker. Server-side so the browser never needs the Cartesia key. Returns
 * audio/wav bytes. Gated like the rest.
 */
voiceAgentVoicesRouter.post('/sample', async (req: Request, res: Response) => {
  const a = await authCompany(req, res);
  if (!a) return;
  if (!(await shouldUseSelfHosted(a.companyId, a.locationId))) {
    res.status(403).json({ error: 'not enabled' });
    return;
  }
  const cartesiaId = typeof req.body?.cartesia_id === 'string' ? req.body.cartesia_id : '';
  if (!cartesiaId) {
    res.status(400).json({ error: 'cartesia_id required' });
    return;
  }
  const apiKey = config.cartesiaApiKey;
  if (!apiKey) {
    res.status(503).json({ error: 'voice preview not configured' });
    return;
  }
  try {
    const resp = await fetch('https://api.cartesia.ai/tts/bytes', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Cartesia-Version': '2024-11-13', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model_id: 'sonic-3.6',
        transcript: "Hi, thanks for calling! I can book you an appointment, check your package balance, or answer any questions. How can I help you today?",
        voice: { mode: 'id', id: cartesiaId },
        language: 'en',
        output_format: { container: 'wav', encoding: 'pcm_s16le', sample_rate: 24000 },
      }),
    });
    if (!resp.ok) {
      res.status(502).json({ error: 'preview failed' });
      return;
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    res.setHeader('Content-Type', 'audio/wav');
    res.send(buf);
  } catch (err) {
    reportError(err instanceof Error ? err : new Error(String(err)), {
      type: 'voice_agent_sample_error',
      dedupe: 'silent',
      metadata: { source: 'voiceAgent.routes.voices.sample', companyId: a.companyId },
    });
    res.status(500).json({ error: 'preview error' });
  }
});

/**
 * Clone a voice from a sample the MERCHANT provides (recorded per on-screen
 * instructions, or uploaded). The UI reads the file and sends it base64 (fits the
 * existing JSON body; no multipart dependency). We POST it to Cartesia
 * /voices/clone (instant, returns a voice id) and store it against the company.
 * A consent string is required and recorded.
 */
voiceAgentVoicesRouter.post('/clone', async (req: Request, res: Response) => {
  const a = await authCompany(req, res);
  if (!a) return;
  if (!(await shouldUseSelfHosted(a.companyId, a.locationId))) {
    res.status(403).json({ error: 'self-hosted voice agent not enabled for this company' });
    return;
  }
  const body = (req.body ?? {}) as { audio_base64?: unknown; filename?: unknown; name?: unknown; gender?: unknown; language?: unknown; consent?: unknown };
  const audioB64 = typeof body.audio_base64 === 'string' ? body.audio_base64 : '';
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 60) : '';
  const gender = body.gender === 'male' ? 'male' : 'female';
  const language = typeof body.language === 'string' && body.language ? body.language.slice(0, 8) : 'en';
  const consent = typeof body.consent === 'string' ? body.consent.trim() : '';
  const filename = typeof body.filename === 'string' && body.filename ? body.filename : 'voice-sample.wav';
  if (!audioB64 || !name) {
    res.status(400).json({ error: 'audio_base64 and name are required' });
    return;
  }
  if (!consent) {
    res.status(400).json({ error: 'consent is required to clone a voice' });
    return;
  }
  const apiKey = config.cartesiaApiKey;
  if (!apiKey) {
    res.status(503).json({ error: 'voice cloning is not configured' });
    return;
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(audioB64.replace(/^data:[^,]*,/, ''), 'base64');
  } catch {
    res.status(400).json({ error: 'invalid audio' });
    return;
  }
  if (bytes.length < 2000 || bytes.length > 16 * 1024 * 1024) {
    res.status(400).json({ error: 'audio must be between ~2 KB and 16 MB' });
    return;
  }
  try {
    const form = new FormData();
    const type = filename.endsWith('.mp3') ? 'audio/mpeg' : filename.endsWith('.webm') ? 'audio/webm' : 'audio/wav';
    form.append('clip', new Blob([new Uint8Array(bytes)], { type }), filename);
    form.append('name', name);
    form.append('language', language);
    form.append('description', `Cloned voice for company ${a.companyId}`);
    const resp = await fetch('https://api.cartesia.ai/voices/clone', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Cartesia-Version': '2024-11-13' },
      body: form,
    });
    if (!resp.ok) {
      const txt = (await resp.text()).slice(0, 400);
      reportError(new Error(`Cartesia clone failed ${resp.status}: ${txt}`), {
        type: 'voice_agent_clone_failed',
        metadata: { source: 'voiceAgent.routes.voices.clone', companyId: a.companyId, status: resp.status },
      });
      res.status(502).json({ error: 'voice cloning failed, please try a clearer sample' });
      return;
    }
    const out = (await resp.json()) as { id?: string };
    const voiceId = out.id;
    if (!voiceId) {
      res.status(502).json({ error: 'voice cloning returned no voice' });
      return;
    }
    const db = getSupabaseClient();
    const { error } = await db.from('voice_agent_cloned_voices').insert({
      company_id: a.companyId,
      location_id: a.locationId,
      cartesia_voice_id: voiceId,
      name,
      gender,
      language,
      created_by: a.userId,
      consent_text: consent,
      consent_at: new Date().toISOString(),
    });
    if (error) {
      reportError(new Error(`cloned voice insert failed: ${error.message}`), {
        type: 'voice_agent_clone_store_error',
        metadata: { source: 'voiceAgent.routes.voices.clone', companyId: a.companyId, note: 'Cartesia cloned the voice but we failed to store it' },
      });
      res.status(500).json({ error: 'cloned but could not save; contact support' });
      return;
    }
    res.json({ ok: true, voice: { key: `cartesia:${voiceId}:${gender}`, cartesia_id: voiceId, name, gender } });
  } catch (err) {
    reportError(err instanceof Error ? err : new Error(String(err)), {
      type: 'voice_agent_clone_error',
      metadata: { source: 'voiceAgent.routes.voices.clone', companyId: a.companyId },
    });
    res.status(500).json({ error: 'voice cloning error' });
  }
});
