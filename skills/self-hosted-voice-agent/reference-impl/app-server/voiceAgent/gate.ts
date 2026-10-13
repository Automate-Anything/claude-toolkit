/**
 * The test gate for the self-hosted voice agent. Two layers, BOTH must be
 * open, or the self-hosted path is inert and callers go to the human fallback:
 *
 *   1. MASTER SWITCH: env `VOICE_AGENT_ENABLED=true` on app-server (Render).
 *      Default off. Flipping it off is the kill switch: every self-hosted number
 *      instantly stops reaching voice-rt (callers get the transfer number).
 *   2. TARGETING: the `self_hosted_voice_agent` prompt flag (retell_prompt_flags,
 *      managed in the superadmin portal, Retell -> Flags) lists the company_ids /
 *      location_ids that may use it. No new table: the flag system already has
 *      per-company/location targeting + a UI.
 *
 * Enforced at THREE points so a gate cannot be bypassed by ordering:
 *   - switching a number to 'pipecat' (provider.ts) and enabling AI with the
 *     pipecat provider (enableRole.ts) refuse when the gate is closed;
 *   - answering an inbound call (session.ts) re-checks it live, so a number
 *     flipped earlier goes back to the human fallback the moment the master
 *     switch is off or the company is removed from the flag.
 */
import { config } from '../config/env.js';
import { evaluateFlagsForCall } from '../retell/inboundCall/flags.js';
import { reportError } from '../utils/errorReporter.js';

export const VOICE_AGENT_FLAG_KEY = 'self_hosted_voice_agent';

export type GateReason = 'master_off' | 'company_not_targeted' | 'flag_lookup_error';

export interface GateResult {
  allowed: boolean;
  reason: GateReason | null;
}

export async function evaluateVoiceAgentGate(
  companyId: string | null,
  locationId: string | null,
): Promise<GateResult> {
  if (!config.voiceAgentEnabled) return { allowed: false, reason: 'master_off' };
  try {
    const flags = await evaluateFlagsForCall(companyId, locationId);
    if (flags[VOICE_AGENT_FLAG_KEY] === true) return { allowed: true, reason: null };
    return { allowed: false, reason: 'company_not_targeted' };
  } catch (err) {
    // Fail CLOSED: an unreadable flag table must never open the gate.
    reportError(err instanceof Error ? err : new Error(String(err)), {
      type: 'voice_agent_gate_lookup_error',
      dedupe: 'silent',
      metadata: { source: 'voiceAgent.gate.evaluateVoiceAgentGate', companyId, locationId },
    });
    return { allowed: false, reason: 'flag_lookup_error' };
  }
}

/**
 * THE single routing decision: should THIS company's AI calls use the self-hosted
 * system instead of Retell? Every inbound/outbound/visibility decision keys off
 * this ONE function so the owner's Phase 2 ("shut off the switch -> everyone")
 * is a one-line change here: replace the body with `return true` and the whole
 * platform is self-hosted, Retell retired.
 *
 * Phase 1 (now): true only when the master env is on AND the company is in the
 * self_hosted_voice_agent flag (the superadmin per-company test switch). Fails
 * SAFE to false (= Retell) on any error, so a flag-table blip never reroutes a
 * live call away from the working provider.
 */
export async function shouldUseSelfHosted(
  companyId: string | null,
  locationId: string | null,
): Promise<boolean> {
  const gate = await evaluateVoiceAgentGate(companyId, locationId);
  return gate.allowed;
}

export function describeGateReason(reason: GateReason): string {
  switch (reason) {
    case 'master_off':
      return 'The self-hosted voice agent master switch is OFF (set VOICE_AGENT_ENABLED=true on app-server).';
    case 'company_not_targeted':
      return `This company/location is not targeted by the "${VOICE_AGENT_FLAG_KEY}" flag (Retell -> Flags in the superadmin portal).`;
    case 'flag_lookup_error':
      return 'The flag table could not be read; the gate fails closed.';
  }
}
