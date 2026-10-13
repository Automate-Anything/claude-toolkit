/**
 * Outbound self-hosted voice-agent calls.
 *
 * The agent places a call (reminder that can rebook, waitlist offer, no-show
 * win-back, review request, or an operator/Operations-Agent-initiated call) and
 * talks to the customer through the SAME runtime + tool library as inbound.
 *
 * Flow:
 *   startOutboundCall() -> build the session context (tenant + enrichment +
 *     prompts, outbound variant) -> stash it -> cxmlOriginate(from, to,
 *     url=/api/voice/laml/voice-agent/outbound-answer?session_id=...). On
 *     answer, SignalWire fetches that URL, which returns <Connect><Stream> to
 *     voice-rt with the session_id. From there it is identical to an inbound
 *     call: voice-rt claims the session, runs the pipeline, reports the end.
 *
 * Gated by the SAME two-layer test gate as inbound (master switch + the
 * `self_hosted_voice_agent` flag), so outbound cannot fire for a non-test
 * company either.
 */
import { config } from '../config/env.js';
import { supabaseAdmin } from '../config/supabase.js';
import { reportError } from '../utils/errorReporter.js';
import { cxmlOriginate } from '../voice/conferenceOrchestrate.js';
import { loadRetellConfig } from '../retell/inboundCall/settings.js';
import { loadLocationVars } from '../retell/inboundCall/locationVars.js';
import { resolveVoiceBundle } from '../retell/inboundCall/voiceBundle.js';
import { computeScheduleContext } from '../retell/inboundCall/scheduleCompute.js';
import { getLocationKnowledgeBase } from '../ai/tools/knowledge-base/index.js';
import { applyPreferredTechnicianToKb } from '../ai/tools/bookings/find-locked-technicians.js';
import { resolveDefaultTechnicianRows } from '../ai/tools/bookings/find-new-client-technician.js';
import { findOrCreateContactByPhone } from '../retell/inboundCall/contactLookup.js';
import { resolveBookedStatus } from '../booking/statusResolver.js';
import type { Part2HandoffPayload } from '../inbound/types.js';
import { toE164Digits } from '../utils/phoneCanonical.js';
import { createSession, newSessionId } from './sessionStore.js';
import { voiceToolDefs, voiceToolRouting } from './tools.js';
import { resolveVoiceRtVoice } from './voices.js';
import { substituteDynamicVars } from './session.js';
import { getLocationCurrencyCached } from '../utils/currency.js';
import { evaluateVoiceAgentGate, describeGateReason } from './gate.js';
import {
  VOICE_AGENT_STATES,
  type VoiceAgentSession,
  type VoiceAgentState,
  type VoiceRtSessionContext,
} from './types.js';

export class OutboundError extends Error {
  constructor(public readonly code: string, message: string, public readonly httpStatus = 400) {
    super(message);
    this.name = 'OutboundError';
  }
}

export interface StartOutboundInput {
  companyId: string;
  locationId: string | null;
  /** The customer's number (any format; normalized to E.164). */
  toNumber: string;
  /** OUR number to call from (E.164 with +). Must be an AI-enabled voice number. */
  fromNumber: string;
  /**
   * The agent's objective for THIS call, injected as an outbound directive at
   * the top of the starter prompt. e.g. "Call to remind them of their 3pm
   * haircut tomorrow and offer to reschedule if it does not work."
   */
  objective: string;
  /** Optional campaign/reason tag for the call record + logs. */
  reason?: string;
  /** Optional structured variables the objective text can reference. */
  variables?: Record<string, string>;
  /** Which consent dimension this call belongs to (Do-Not-Call scope).
   *  Defaults to 'marketing' (reminders/win-back/reviews are marketing-class). */
  consentScope?: 'marketing' | 'transactional';
}

export interface StartOutboundResult {
  session_id: string;
  provider_call_sid: string;
  status: string;
}

/**
 * The outbound starter directive. Prepended to the starter prompt so the agent
 * OPENS the call with its purpose instead of waiting to be greeted (an outbound
 * agent speaks first). Kept short; the rest of the persona/tools come from the
 * same rendered prompts as inbound.
 */
function outboundDirective(objective: string, receptionistName: string, locationName: string): string {
  return [
    `## THIS IS AN OUTBOUND CALL YOU ARE PLACING`,
    `You are ${receptionistName} calling on behalf of ${locationName}. The customer did NOT call you; you called them.`,
    `As soon as they answer, greet them warmly, say who you are and where you are calling from, and state why you are calling in one sentence.`,
    `Your objective for this call: ${objective}`,
    `Be brief and respectful of their time. If they are busy or ask to be called later, apologize, offer to follow up, and end the call politely.`,
    `If they ask you to stop calling or express that they do not want these calls, acknowledge it, tell them you will note it, and end the call.`,
    ``,
  ].join('\n');
}

export async function startOutboundCall(input: StartOutboundInput): Promise<StartOutboundResult> {
  // Gate FIRST: outbound must respect the same test gate as inbound.
  const gate = await evaluateVoiceAgentGate(input.companyId, input.locationId);
  if (!gate.allowed) {
    throw new OutboundError('gate_closed', gate.reason ? describeGateReason(gate.reason) : 'gate closed', 409);
  }
  if (!config.voiceRtUrl) {
    throw new OutboundError('runtime_unconfigured', 'VOICE_RT_URL is not set; deploy voice-rt first', 409);
  }

  const toDigits = toE164Digits(input.toNumber);
  if (!toDigits) throw new OutboundError('bad_to_number', 'toNumber is not a valid phone number');
  const fromE164 = input.fromNumber.startsWith('+') ? input.fromNumber : `+${input.fromNumber}`;
  const toE164 = `+${toDigits}`;

  // Do-Not-Call: never place an outbound agent call to a number that opted out
  // of calls. Scope 'marketing' by default (reminders/win-back/reviews are
  // marketing-class); a caller can pass consentScope to distinguish. TCPA:
  // voice opt-out is a SEPARATE channel from SMS, so we check voice_call_opt_outs
  // (is_call_opted_out), never the SMS table. Fails SAFE: a lookup error blocks.
  const consentScope = input.consentScope ?? 'marketing';
  try {
    const { data: blocked, error: optErr } = await supabaseAdmin.rpc('is_call_opted_out', {
      p_company_id: input.companyId,
      p_phone: toDigits,
      p_scope: consentScope,
    });
    if (optErr) {
      reportError(optErr as unknown as Error, {
        type: 'voice_agent_optout_check_failed',
        metadata: { source: 'voiceAgent.outbound.startOutboundCall', company_id: input.companyId, note: 'blocked the call to be safe' },
      });
      throw new OutboundError('optout_check_failed', 'Could not verify the customer has not opted out of calls; the call was not placed.', 502);
    }
    if (blocked === true) {
      throw new OutboundError('opted_out', 'This customer has opted out of calls, so the agent will not call them.', 409);
    }
  } catch (err) {
    if (err instanceof OutboundError) throw err;
    reportError(err instanceof Error ? err : new Error(String(err)), {
      type: 'voice_agent_optout_check_failed',
      metadata: { source: 'voiceAgent.outbound.startOutboundCall', company_id: input.companyId },
    });
    throw new OutboundError('optout_check_failed', 'Could not verify call consent; the call was not placed.', 502);
  }

  // Confirm the FROM number is an AI-enabled, self-hosted voice number for this
  // company (never let an arbitrary caller id go out, and never place an AI call
  // from a number that is not ours + not on the self-hosted provider).
  const { data: vn } = await supabaseAdmin
    .from('voice_numbers')
    .select('id, company_id, location_id, ai_provider, ai_active, is_active, lifecycle_state')
    .or(`phone_number.eq.${fromE164},phone_number.eq.${fromE164.slice(1)}`)
    .eq('company_id', input.companyId)
    .eq('is_active', true)
    .maybeSingle();
  const vnRow = vn as {
    id: string; company_id: string; location_id: string | null;
    ai_provider: string | null; ai_active: boolean | null; lifecycle_state: string;
  } | null;
  if (!vnRow || vnRow.lifecycle_state === 'deleted') {
    throw new OutboundError('from_not_found', 'The from number is not an active voice number for this company', 404);
  }
  if (vnRow.ai_provider !== 'pipecat' || vnRow.ai_active === false) {
    throw new OutboundError('from_not_self_hosted', 'The from number is not on the self-hosted AI provider (or AI is suspended)', 409);
  }

  const config_ = await loadRetellConfig();
  const locationId = input.locationId ?? vnRow.location_id;
  const locationVars = locationId ? await loadLocationVars(locationId) : null;
  const timezone = locationVars?.timezone || config_.settings.default_timezone;
  const voiceBundle = await resolveVoiceBundle(input.companyId, locationVars, config_.settings);
  const engine = config.voiceAgentDefaultEngine;

  // Enrichment (best-effort, same helpers as inbound). Outbound has no live
  // caller gates to run; we just want the contact + schedule + KB for context.
  const [contact, schedule, baseKnowledgeBase, bookedStatus] = await Promise.all([
    findOrCreateContactByPhone(input.companyId, toDigits, {}).catch(() => null),
    locationId
      ? computeScheduleContext(locationId, input.companyId, timezone, config_.settings.open_now_buffer_minutes).catch(() => null)
      : Promise.resolve(null),
    locationId
      ? getLocationKnowledgeBase({ companyId: input.companyId, locationIds: [locationId] }).then((r) => r.knowledge_base).catch(() => '')
      : Promise.resolve(''),
    resolveBookedStatus(input.companyId).catch(() => null),
  ]);
  const bookingStatusId = bookedStatus?.id ?? '';

  // Same default-technician rule as inbound (retell/inboundCall/handler.ts): the client's own
  // preferred technician, else the location's new-client technician for someone with no history.
  // Best-effort: a failed lookup leaves the KB's own default and never blocks the call.
  let knowledgeBase = baseKnowledgeBase ?? '';
  if (knowledgeBase && locationId) {
    try {
      const { rows } = await resolveDefaultTechnicianRows({
        companyId: input.companyId,
        contactId: contact?.id ?? null,
        locationId,
      });
      knowledgeBase = applyPreferredTechnicianToKb(knowledgeBase, rows, locationId);
    } catch (err) {
      reportError(err instanceof Error ? err : new Error(String(err)), {
        type: 'api_error',
        metadata: {
          source: 'voiceAgent.outbound.resolveDefaultTechnicianRows',
          companyId: input.companyId,
          locationId,
        },
      });
    }
  }

  const receptionistName = locationVars?.receptionist_name || config_.settings.default_receptionist_name;
  const locationName = locationVars?.location_name || config_.settings.default_location_name;

  // Dynamic variables mirror the inbound bundle shape so the SAME prompt bodies
  // render. call_from_number/call_to_number are swapped for the outbound
  // direction (we are calling THEM).
  const callerFirst = (contact?.first_name ?? '').trim();
  const callerLast = (contact?.last_name ?? '').trim();
  const dynamicVariables: Record<string, string> = {
    company_id: input.companyId,
    location_id: locationId ?? '',
    timezone,
    call_to_number: toDigits,
    call_from_number: fromE164.slice(1),
    booking_status_id: bookingStatusId,
    receptionist_name: receptionistName,
    location_name: locationName,
    user_name: [callerFirst, callerLast].filter(Boolean).join(' '),
    knowledge_base: knowledgeBase ?? '',
    contact_id: contact?.id ?? '',
    disambiguation_instruction: '',
    business_is_now: schedule?.the_business_is_now ?? '',
    current_date_and_time: schedule?.current_date_and_time ?? '',
    schedule_markdown: schedule?.schedule ?? '',
    calendar_21_day: schedule?.calendar_21_day ?? '',
    ...(input.variables ?? {}),
  };

  // Build per-state prompts: reuse the starter body with the outbound directive
  // prepended. The other states carry the same rendered bodies so a mid-call
  // switch (e.g. into booking) behaves exactly as inbound.
  const directive = outboundDirective(input.objective, receptionistName, locationName);
  const starterBody = substituteDynamicVars(config_.prompts.starter || '', dynamicVariables);
  const prompts = {} as Record<VoiceAgentState, string>;
  for (const state of VOICE_AGENT_STATES) {
    const body = substituteDynamicVars(config_.prompts[state] || '', dynamicVariables);
    prompts[state] = state === 'starter' ? `${directive}\n${starterBody}` : body;
  }

  const sessionId = newSessionId();
  const canTransfer = !!locationVars?.transfer_to_number;
  // Cached, fails safe to 'USD' (which leaves the tool definitions untouched).
  const tools = voiceToolDefs({ canTransferToHuman: canTransfer, currency: await getLocationCurrencyCached(supabaseAdmin, locationId) });

  const context: VoiceRtSessionContext = {
    session_id: sessionId,
    direction: 'outbound',
    call_sid: '', // filled once SignalWire returns the sid below
    from_number: fromE164.slice(1),
    to_number: toDigits,
    company_id: input.companyId,
    location_id: locationId,
    timezone,
    prompts,
    disambiguation_instruction: '',
    initial_state: 'starter',
    voice: resolveVoiceRtVoice(voiceBundle, engine),
    settings: {
      turn_taking_mode: 'balanced',
      max_duration_seconds: 30 * 60, // outbound calls are shorter; cap tighter
      stt_model: config.voiceAgentSttModel,
      llm_model: config.voiceAgentLlmModel,
      // Outbound agent speaks first: greet-and-state-purpose is driven by the
      // directive + LLMRunFrame kickoff (no fixed greeting string needed).
      greeting: null,
    },
    tools,
    tool_routing: voiceToolRouting(tools),
    can_transfer_to_human: canTransfer,
  };

  const toolPayload: Part2HandoffPayload = {
    company_id: input.companyId,
    location_id: locationId,
    channel: 'voice',
    database_message_id: '',
    session_id: sessionId,
    timezone,
    first_name: callerFirst,
    last_name: callerLast,
    phoneNumber: toDigits,
    receivingPhone: fromE164.slice(1),
    contact_id: contact?.id ?? '',
    contact_disambiguated: false,
    booking_status_id: bookingStatusId,
    connected_to_whatsapp_channel_id: null,
    messageId: '',
    raw_chat_id: '',
    twilio_number_id: null,
    chat_id: '',
    timestamp: String(Date.now()),
    execution_url: '',
    messageBody: '',
    sms_number_id: null,
    tier: '',
  };

  const session: VoiceAgentSession = createSession({
    session_id: sessionId,
    created_at: Date.now(),
    connected_at: null,
    ended_at: null,
    finalized_at: null,
    direction: 'outbound',
    call_sid: '',
    from_number: fromE164.slice(1),
    to_number: toDigits,
    company_id: input.companyId,
    location_id: locationId,
    voice_number_id: vnRow.id,
    timezone,
    receptionist_name: receptionistName,
    location_name: locationName,
    transfer_to_number: locationVars?.transfer_to_number ?? null,
    contact: {
      id: contact?.id ?? null,
      first_name: contact?.first_name ?? null,
      last_name: contact?.last_name ?? null,
      disambiguated: false,
    },
    dynamic_variables: dynamicVariables,
    context,
    tool_payload: toolPayload,
    live: { state: 'starter', turns: 0, tool_calls: 0, last_event_at: null },
    recording_bucket_path: null,
    end: null,
  });

  // Originate. On answer SignalWire fetches the outbound-answer cXML, which
  // returns <Connect><Stream> with this session_id.
  const answerUrl = `${config.billingServerUrl}/api/voice/laml/voice-agent/outbound-answer?session_id=${encodeURIComponent(sessionId)}`;
  try {
    const { sid, status } = await cxmlOriginate({ from: fromE164, to: toE164, url: answerUrl });
    session.call_sid = sid;
    session.context.call_sid = sid;
    return { session_id: sessionId, provider_call_sid: sid, status };
  } catch (err) {
    // Originate failed: the customer was never called. The caller still gets the
    // thrown OutboundError and handles it. A single carrier/SIP originate
    // rejection (unreachable number, carrier block, transient 5xx) is a routine
    // outcome when dialing consumers at scale (e.g. the collections cron), so
    // this is reported SILENTLY with an escalation threshold: it is visible in
    // the alerts UI and only pages the team on a real spike (a genuine outbound
    // outage), never per failed call. One-off callers still see the spike.
    reportError(err instanceof Error ? err : new Error(String(err)), {
      type: 'voice_agent_outbound_originate_failed',
      dedupe: 'silent',
      escalateAfter: 25,
      metadata: {
        source: 'voiceAgent.outbound.startOutboundCall',
        company_id: input.companyId,
        from: fromE164,
        to: toE164,
        reason: input.reason ?? null,
      },
    });
    throw new OutboundError('originate_failed', `Could not place the call: ${err instanceof Error ? err.message : String(err)}`, 502);
  }
}
