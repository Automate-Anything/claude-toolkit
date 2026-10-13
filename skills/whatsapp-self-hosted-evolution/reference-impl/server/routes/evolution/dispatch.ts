/**
 * Evolution dispatch router - mounted BEFORE the WHAPI routers on the SAME paths
 * (/api/whapi/* and /api/whatsapp/*). For each provisioning request it decides
 * whether Evolution should handle it; if not, it calls next() and the request
 * falls through to the existing WHAPI handler UNCHANGED.
 *
 * This is how the frontend stays untouched: it keeps POSTing to
 * /api/whapi/create-channel, /api/whapi/create-qr, etc. The dispatcher routes to
 * the right backend based on:
 *   - create-channel: the company's EFFECTIVE provider (a per-company override in
 *     whatsapp_provider_overrides wins, else config.whatsappNewChannelProvider).
 *   - all others:     the EXISTING channel row's `provider` column.
 *
 * IDOR: for operations on an existing channel we run the same
 * authorizeChannelRequest guard the WHAPI routers use (it keys on channel_id,
 * which Evolution rows also populate with the instance name).
 */
import { Router, Request, Response, NextFunction } from 'express';
import { config } from '../../config/env.js';
import { reportError } from '../../utils/errorReporter.js';
import { supabaseAdmin } from '../../config/supabase.js';
import { authorizeChannelRequest } from '../whapi/helpers.js';
import { evoSetWebhook, evolutionInboundWebhookUrlFor } from '../../whatsapp/evolution/evolutionClient.js';
import {
  createEvolutionChannel,
  createEvolutionQr,
  requestEvolutionCode,
  evolutionHealthCheck,
  evolutionLogout,
  deleteEvolutionChannel,
  type EvolutionChannelRow,
} from './provision.js';

export const evolutionDispatchRouter = Router();

const CHANNEL_SELECT =
  'id, company_id, channel_id, channel_name, channel_token, phone_number, evolution_instance_name, provider';

/** Load a channel row by its channel_id (which for Evolution == instance name). */
async function loadChannel(channelId: string): Promise<(EvolutionChannelRow & { provider: string }) | null> {
  const { data, error } = await supabaseAdmin
    .from('whatsapp_channels')
    .select(CHANNEL_SELECT)
    .eq('channel_id', channelId)
    .neq('lifecycle_state', 'deleted')
    .maybeSingle();
  if (error || !data) return null;
  return data as EvolutionChannelRow & { provider: string };
}

/**
 * Resolve the effective NEW-channel provider for a company. A per-company override
 * row (the superadmin-controlled rollout, in the service-role-only
 * whatsapp_provider_overrides table) WINS; otherwise the global default
 * (config.whatsappNewChannelProvider, normally 'whapi'). `companyId` is the
 * client-supplied body value, which is safe for ROUTING because ownership of that
 * company is still enforced downstream (createEvolutionChannel and the WHAPI handler
 * both validate operator access). So a client can never provision for a company it
 * doesn't own, and a merchant can't self-opt-in to Evolution (only superadmin writes
 * overrides).
 */
async function resolveNewChannelProvider(companyId: unknown): Promise<'whapi' | 'evolution'> {
  if (typeof companyId === 'string' && companyId) {
    const { data } = await supabaseAdmin
      .from('whatsapp_provider_overrides')
      .select('provider')
      .eq('company_id', companyId)
      .maybeSingle();
    const p = (data as { provider?: string } | null)?.provider;
    if (p === 'evolution' || p === 'whapi') return p;
  }
  return config.whatsappNewChannelProvider === 'evolution' ? 'evolution' : 'whapi';
}

// ─── create-channel: dispatch by the PER-COMPANY effective provider ──────────
evolutionDispatchRouter.post('/create-channel', async (req: Request, res: Response, next: NextFunction) => {
  const provider = await resolveNewChannelProvider(req.body?.company_id);
  if (provider !== 'evolution') return next(); // → WHAPI handler
  try {
    await createEvolutionChannel(req, res);
  } catch (err) {
    next(err);
  }
});

// ─── Operations on an EXISTING channel: dispatch by its provider column ──────

evolutionDispatchRouter.post('/create-qr', async (req: Request, res: Response, next: NextFunction) => {
  const channelId = req.body?.channel_id;
  if (!channelId || typeof channelId !== 'string') return next();
  const ch = await loadChannel(channelId);
  if (!ch || ch.provider !== 'evolution') return next(); // WHAPI (or unknown) → WHAPI handler
  const auth = await authorizeChannelRequest(req, res, channelId);
  if (!auth.ok) return;
  try {
    await createEvolutionQr(ch, res);
  } catch (err) {
    next(err);
  }
});

evolutionDispatchRouter.post('/request-code', async (req: Request, res: Response, next: NextFunction) => {
  const channelId = req.body?.channel_id;
  if (!channelId || typeof channelId !== 'string') return next();
  const ch = await loadChannel(channelId);
  if (!ch || ch.provider !== 'evolution') return next();
  const auth = await authorizeChannelRequest(req, res, channelId);
  if (!auth.ok) return;
  const phone = String(req.body?.phone_number ?? '');
  if (!phone) {
    res.status(400).json({ error: 'phone_number is required' });
    return;
  }
  try {
    await requestEvolutionCode(ch, phone, res);
  } catch (err) {
    next(err);
  }
});

evolutionDispatchRouter.post('/health-check', async (req: Request, res: Response, next: NextFunction) => {
  const channelId = req.body?.channel_id;
  if (!channelId || typeof channelId !== 'string') return next();
  const ch = await loadChannel(channelId);
  if (!ch || ch.provider !== 'evolution') return next();
  // health-check is a read; still verify ownership (it reveals connection state).
  const auth = await authorizeChannelRequest(req, res, channelId);
  if (!auth.ok) return;
  try {
    await evolutionHealthCheck(ch, res);
  } catch (err) {
    next(err);
  }
});

evolutionDispatchRouter.post('/logout', async (req: Request, res: Response, next: NextFunction) => {
  const channelId = req.body?.channel_id;
  if (!channelId || typeof channelId !== 'string') return next();
  const ch = await loadChannel(channelId);
  if (!ch || ch.provider !== 'evolution') return next();
  const auth = await authorizeChannelRequest(req, res, channelId);
  if (!auth.ok) return;
  try {
    await evolutionLogout(ch, res);
  } catch (err) {
    next(err);
  }
});

evolutionDispatchRouter.post('/delete-channel', async (req: Request, res: Response, next: NextFunction) => {
  const channelId = req.body?.channel_id;
  if (!channelId || typeof channelId !== 'string') return next();
  const ch = await loadChannel(channelId);
  if (!ch || ch.provider !== 'evolution') return next();
  const auth = await authorizeChannelRequest(req, res, channelId);
  if (!auth.ok) return;
  try {
    await deleteEvolutionChannel(ch, res);
  } catch (err) {
    next(err);
  }
});

// set-webhook: the UI calls this right after a channel finishes pairing (the
// provider-agnostic "add dynamic webhook" step, useWhatsAppChannels →
// addDynamicWebhook). For Evolution we (re)apply our canonical webhook config
// here so EVERY freshly-connected instance runs with base64:false regardless of
// how it paired (QR or code) - instance-create sets it too, but a channel created
// before that config change, or any drift, is corrected on connect. base64:false
// keeps inbound media OUT of the webhook body so a photo/voice note never exceeds
// the body limit and 413s (which would silently drop the customer's message).
// Best-effort: a webhook-set hiccup must not fail the connect flow, so we still
// return success (the config is also set at create time and re-applied next
// connect); we surface a real failure to logs for visibility.
evolutionDispatchRouter.post('/set-webhook', async (req: Request, res: Response, next: NextFunction) => {
  const channelId = req.body?.channel_id;
  if (!channelId || typeof channelId !== 'string') return next();
  const ch = await loadChannel(channelId);
  if (!ch || ch.provider !== 'evolution') return next();
  // Same IDOR guard as the sibling existing-channel routes: this now performs a
  // real write (re-applies webhook config to the instance), so verify the caller
  // owns this channel before acting.
  const auth = await authorizeChannelRequest(req, res, channelId);
  if (!auth.ok) return;
  const result = await evoSetWebhook({
    instanceName: ch.evolution_instance_name!,
    webhookUrl: evolutionInboundWebhookUrlFor(ch.evolution_instance_name!),
    instanceToken: ch.channel_token,
  });
  if (!result.ok) {
    console.warn(`[Evolution set-webhook] failed for ${ch.evolution_instance_name}: ${result.error ?? result.status}`);
    // The webhook config is what delivers this channel's inbound messages (and
    // carries the base64:false 413 fix). If re-applying it fails, messages can
    // silently stop arriving, so this is a real alert (WHAPI parity).
    reportError(new Error(`Evolution set-webhook failed: ${result.error ?? result.status}`), {
      type: 'evolution_set_webhook_failed',
      metadata: { source: 'routes.evolution.dispatch.setWebhook', instance: ch.evolution_instance_name, channelId, status: result.status ?? null },
    });
  }
  res.json({ success: true });
});

// get-info: return the paired phone. Twin of WHAPI /get-info.
evolutionDispatchRouter.post('/get-info', async (req: Request, res: Response, next: NextFunction) => {
  const channelId = req.body?.channel_id;
  if (!channelId || typeof channelId !== 'string') return next();
  const ch = await loadChannel(channelId);
  if (!ch || ch.provider !== 'evolution') return next();
  res.json([{ phone: ch.phone_number, activeTill: null }]);
});
