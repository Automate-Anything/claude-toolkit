/**
 * Outbound self-hosted voice-agent trigger.
 *
 *   POST /api/internal/voice-agent/outbound   (Internal-Secret)
 *     For the Operations Agent, crons (reminders / waitlist / win-back /
 *     review requests), and the phone-actions script. Server-to-server.
 *
 * The superadmin admin router (routes/admin.ts) exposes a thin wrapper of the
 * same for manual test dials from the portal.
 *
 * Body: { company_id, location_id?, to_number, from_number, objective,
 *         reason?, variables? }
 */
import { Router, type Request, type Response } from 'express';
import { config } from '../../config/env.js';
import { reportError } from '../../utils/errorReporter.js';
import { startOutboundCall, OutboundError } from '../outbound.js';
import { createVoiceCampaign, CampaignError } from '../campaigns.js';

export const voiceAgentOutboundRouter: Router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function checkInternalSecret(req: Request, res: Response): boolean {
  const expected = config.internalApiSecret;
  if (!expected) {
    res.status(503).json({ error: 'internal secret not configured' });
    return false;
  }
  const provided = req.headers['internal-secret'];
  if (typeof provided !== 'string' || provided.length !== expected.length) {
    res.status(401).json({ error: 'invalid Internal-Secret' });
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < provided.length; i++) mismatch |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  if (mismatch !== 0) {
    res.status(401).json({ error: 'invalid Internal-Secret' });
    return false;
  }
  return true;
}

export async function handleOutboundRequest(req: Request, res: Response): Promise<void> {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const companyId = typeof b.company_id === 'string' ? b.company_id.trim() : '';
  const locationId = typeof b.location_id === 'string' && UUID_RE.test(b.location_id) ? b.location_id : null;
  const toNumber = typeof b.to_number === 'string' ? b.to_number.trim() : '';
  const fromNumber = typeof b.from_number === 'string' ? b.from_number.trim() : '';
  const objective = typeof b.objective === 'string' ? b.objective.trim() : '';
  const reason = typeof b.reason === 'string' ? b.reason.trim() : undefined;
  const variables =
    b.variables && typeof b.variables === 'object' && !Array.isArray(b.variables)
      ? (b.variables as Record<string, string>)
      : undefined;

  if (!UUID_RE.test(companyId)) {
    res.status(400).json({ error: 'company_id must be a uuid' });
    return;
  }
  if (!toNumber || !fromNumber) {
    res.status(400).json({ error: 'to_number and from_number are required' });
    return;
  }
  if (!objective) {
    res.status(400).json({ error: 'objective is required (what the agent should accomplish on the call)' });
    return;
  }

  try {
    const result = await startOutboundCall({ companyId, locationId, toNumber, fromNumber, objective, reason, variables });
    res.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof OutboundError) {
      res.status(err.httpStatus).json({ error: err.message, code: err.code });
      return;
    }
    reportError(err instanceof Error ? err : new Error(String(err)), {
      type: 'voice_agent_outbound_error',
      metadata: { source: 'voiceAgent.routes.outbound', company_id: companyId, reason: reason ?? null },
    });
    res.status(500).json({ error: 'outbound call failed' });
  }
}

voiceAgentOutboundRouter.post('/voice-agent/outbound', async (req: Request, res: Response) => {
  if (!checkInternalSecret(req, res)) return;
  await handleOutboundRequest(req, res);
});

// Create (and optionally start) a batch voice campaign. Internal-Secret.
voiceAgentOutboundRouter.post('/voice-agent/campaign', async (req: Request, res: Response) => {
  if (!checkInternalSecret(req, res)) return;
  const b = (req.body ?? {}) as Record<string, unknown>;
  const companyId = typeof b.company_id === 'string' ? b.company_id.trim() : '';
  if (!UUID_RE.test(companyId)) {
    res.status(400).json({ error: 'company_id must be a uuid' });
    return;
  }
  const contactIds = Array.isArray(b.contact_ids) ? b.contact_ids.filter((x): x is string => typeof x === 'string') : [];
  try {
    const result = await createVoiceCampaign({
      companyId,
      locationId: typeof b.location_id === 'string' && UUID_RE.test(b.location_id) ? b.location_id : null,
      name: typeof b.name === 'string' ? b.name : 'Voice campaign',
      objective: typeof b.objective === 'string' ? b.objective : '',
      fromNumber: typeof b.from_number === 'string' ? b.from_number : '',
      contactIds,
      consentScope: b.consent_scope === 'transactional' ? 'transactional' : 'marketing',
      maxConcurrency: typeof b.max_concurrency === 'number' ? b.max_concurrency : undefined,
      quietHoursStart: typeof b.quiet_hours_start === 'number' ? b.quiet_hours_start : undefined,
      quietHoursEnd: typeof b.quiet_hours_end === 'number' ? b.quiet_hours_end : undefined,
      maxAttempts: typeof b.max_attempts === 'number' ? b.max_attempts : undefined,
      startNow: b.start_now === true,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof CampaignError) {
      res.status(err.httpStatus).json({ error: err.message, code: err.code });
      return;
    }
    reportError(err instanceof Error ? err : new Error(String(err)), {
      type: 'voice_campaign_create_error',
      metadata: { source: 'voiceAgent.routes.outbound.campaign', company_id: companyId },
    });
    res.status(500).json({ error: 'campaign creation failed' });
  }
});
