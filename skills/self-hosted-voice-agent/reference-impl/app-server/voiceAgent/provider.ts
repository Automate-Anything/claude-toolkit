/**
 * Per-number AI provider cutover (superadmin). Reversible, one number at a
 * time, never a flag-day. See the plan's "Migration & cutover".
 *
 *   retell  -> pipecat : best-effort remove the Retell registration (so Retell
 *                        stops billing/holding the number), make sure the
 *                        number is bound to the LaML inbound resource (the only
 *                        path that can `<Connect><Stream>`), stamp ai_provider.
 *   pipecat -> retell  : re-import into Retell exactly like enableAi does.
 *
 * The DB CHECK `voice_numbers_ai_provider_check` must allow 'pipecat' first
 * (migration 20260922_100000_voice_numbers_ai_provider_pipecat.sql).
 */
import { supabaseAdmin } from '../config/supabase.js';
import { config } from '../config/env.js';
import { reportError } from '../utils/errorReporter.js';
import { retellClient, RetellApiError } from '../retell/retellClient.js';
import { getInboundWebhookUrl } from '../retell/numberService.js';
import { getSignalwireSipTerminationUri } from '../voice/providers/aiForward.js';
import { importExistingVoiceNumber } from '../voice/providers/signalwireVoice.js';
import { describeGateReason, evaluateVoiceAgentGate } from './gate.js';
import type { VoiceAgentProvider } from './types.js';

export class ProviderSwitchError extends Error {
  constructor(public readonly code: string, message: string, public readonly httpStatus = 400) {
    super(message);
    this.name = 'ProviderSwitchError';
  }
}

interface VoiceNumberRow {
  id: string;
  company_id: string;
  location_id: string | null;
  phone_number: string;
  provider_sid: string | null;
  ai_provider: string | null;
  ai_active: boolean | null;
  lifecycle_state: string;
  is_active: boolean;
}

export async function switchAiProvider(
  voiceNumberId: string,
  target: VoiceAgentProvider,
): Promise<{ voice_number_id: string; phone_number: string; from: string | null; to: VoiceAgentProvider; warnings: string[] }> {
  const { data, error } = await supabaseAdmin
    .from('voice_numbers')
    .select('id, company_id, location_id, phone_number, provider_sid, ai_provider, ai_active, lifecycle_state, is_active')
    .eq('id', voiceNumberId)
    .maybeSingle();
  if (error) throw new ProviderSwitchError('lookup_error', error.message, 500);
  const vn = data as VoiceNumberRow | null;
  if (!vn) throw new ProviderSwitchError('not_found', 'voice number not found', 404);
  if (vn.lifecycle_state === 'deleted' || !vn.is_active) {
    throw new ProviderSwitchError('inactive', 'voice number is not active', 409);
  }
  if (!vn.ai_provider) {
    throw new ProviderSwitchError('ai_not_enabled', 'AI is not enabled on this number; turn AI on first, then switch providers', 409);
  }
  if (vn.ai_provider === target) {
    return { voice_number_id: vn.id, phone_number: vn.phone_number, from: vn.ai_provider, to: target, warnings: ['already on that provider'] };
  }

  const warnings: string[] = [];

  if (target === 'pipecat') {
    // TEST GATE: master switch + company targeting must both be open.
    const gate = await evaluateVoiceAgentGate(vn.company_id, vn.location_id);
    if (!gate.allowed) {
      throw new ProviderSwitchError('gate_closed', gate.reason ? describeGateReason(gate.reason) : 'gate closed', 409);
    }
    if (!config.voiceRtUrl) {
      throw new ProviderSwitchError('runtime_unconfigured', 'VOICE_RT_URL is not set; deploy voice-rt before cutting a number over', 409);
    }
    // Guarantee the LaML binding: it is the only inbound path that can open a
    // media stream. importExistingVoiceNumber prefers the LaML resource when
    // SIGNALWIRE_VOICE_LAML_WEBHOOK_RESOURCE_ID is set.
    if (!config.signalwireVoiceLamlWebhookResourceId) {
      throw new ProviderSwitchError('laml_unconfigured', 'SIGNALWIRE_VOICE_LAML_WEBHOOK_RESOURCE_ID is not set; the self-hosted agent needs the LaML inbound path', 409);
    }
    if (vn.provider_sid) {
      try {
        await importExistingVoiceNumber(vn.provider_sid);
      } catch (err) {
        throw new ProviderSwitchError('laml_bind_failed', `could not bind the number to the LaML inbound resource: ${err instanceof Error ? err.message : String(err)}`, 502);
      }
    } else {
      warnings.push('no provider_sid on the row; could not re-verify the LaML binding');
    }
    // Retell side: drop the registration so Retell stops routing/billing it.
    // Best-effort; a stale Retell registration cannot hurt (SignalWire no
    // longer dials Retell for this number) but is untidy.
    try {
      await retellClient.deletePhoneNumber(vn.phone_number);
    } catch (err) {
      warnings.push(`Retell unregister failed (left registered): ${err instanceof RetellApiError ? err.message : String(err)}`);
      reportError(err instanceof Error ? err : new Error(String(err)), {
        type: 'retell_unregister_failed',
        dedupe: 'silent',
        metadata: { source: 'voiceAgent.provider.switchAiProvider', phone: vn.phone_number, voiceNumberId },
      });
    }
    const { error: upErr } = await supabaseAdmin
      .from('voice_numbers')
      .update({ ai_provider: 'pipecat', ai_agent_id: null, ai_sip_termination_uri: null })
      .eq('id', vn.id);
    if (upErr) throw new ProviderSwitchError('db_write_failed', upErr.message, 500);
    return { voice_number_id: vn.id, phone_number: vn.phone_number, from: vn.ai_provider, to: target, warnings };
  }

  // target === 'retell': re-register with Retell the way enableAi does.
  const terminationUri = getSignalwireSipTerminationUri();
  try {
    await retellClient.importPhoneNumber({
      phone_number: vn.phone_number,
      termination_uri: terminationUri,
      sip_trunk_auth_username: config.retellByoSipUsername || undefined,
      sip_trunk_auth_password: config.retellByoSipPassword || undefined,
      nickname: vn.id,
      inbound_webhook_url: getInboundWebhookUrl(),
    });
  } catch (err) {
    const msg = err instanceof RetellApiError ? err.message : String(err);
    if (!msg.toLowerCase().includes('already exists')) {
      throw new ProviderSwitchError('retell_register_failed', `Retell import failed: ${msg}`, 502);
    }
    warnings.push('Retell already had this number registered; kept the existing registration');
  }
  const { error: upErr } = await supabaseAdmin
    .from('voice_numbers')
    .update({ ai_provider: 'retell', ai_sip_termination_uri: terminationUri })
    .eq('id', vn.id);
  if (upErr) throw new ProviderSwitchError('db_write_failed', upErr.message, 500);
  return { voice_number_id: vn.id, phone_number: vn.phone_number, from: vn.ai_provider, to: target, warnings };
}
