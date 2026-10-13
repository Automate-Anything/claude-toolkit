/**
 * Boots a self-hosted voice-agent call.
 *
 * `answerInboundWithPipecat` is the inbound seam the LaML router calls for a
 * number whose `voice_numbers.ai_provider = 'pipecat'`. It runs the SAME
 * decision tree Retell gets (`resolveInboundCall`, one brain), then:
 *   - live     -> creates a session, stashes the context, returns
 *                 `<Connect><Stream>` cXML pointing at voice-rt.
 *   - transfer -> `<Dial>` straight to the merchant's fallback human (no AI leg,
 *                 no minutes billed; this replaces Retell's inactive agent).
 *   - hangup   -> `<Hangup/>`.
 * Every decision is written to `retell_inbound_call_logs` (our audit log for
 * AI-call decisions; the name is legacy, the table is provider-agnostic).
 */
import { config } from '../config/env.js';
import { supabaseAdmin } from '../config/supabase.js';
import { reportError } from '../utils/errorReporter.js';
import { resolveInboundCall, type InboundResolution } from '../retell/inboundCall/handler.js';
import type { Part2HandoffPayload } from '../inbound/types.js';
import { buildHangupTwiml, buildStreamTwiml, buildTransferTwiml } from './laml.js';
import { createSession, newSessionId } from './sessionStore.js';
import { describeGateReason, evaluateVoiceAgentGate } from './gate.js';
import { voiceToolDefs, voiceToolRouting } from './tools.js';
import { getLocationCurrencyCached } from '../utils/currency.js';
import { resolveVoiceRtVoice } from './voices.js';
import {
  VOICE_AGENT_STATES,
  type VoiceAgentSession,
  type VoiceAgentState,
  type VoiceRtSessionContext,
} from './types.js';

/**
 * Substitute Retell-style `{{dynamic_var}}` tokens. Retell did this itself at
 * call time; the self-hosted runtime gets finished text. Unknown tokens are
 * left as-is (they render as literal braces, exactly as Retell would leave an
 * undefined variable).
 */
export function substituteDynamicVars(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : m,
  );
}

/**
 * The begin message: the exact line the agent speaks the instant the call
 * connects (Retell parity), before the LLM runs. Rendered from the resolved
 * location vars. Kept here as the one place the opening is defined; when a
 * per-location custom begin-message field is added, read it here and fall back
 * to this template. A trailing space is trimmed; names are already resolved.
 */
export function renderBeginMessage(locationName: string, receptionistName: string): string {
  // Static first message, spoken verbatim the instant the call connects (Pipecat
  // TTSSpeakFrame, before the LLM). Two variables: the business name (= the
  // LOCATION name) and the receptionist name. Matches the operator's Retell begin
  // message: "{{location_name}}, this is {{receptionist_name}} speaking, how can I
  // help you?".
  const businessName = (locationName || 'our office').trim();
  const who = (receptionistName || 'the front desk').trim();
  return `${businessName}, this is ${who} speaking, how can I help you?`;
}

function stateKey(slot: string): VoiceAgentState | null {
  return (VOICE_AGENT_STATES as string[]).includes(slot) ? (slot as VoiceAgentState) : null;
}

export interface BuildSessionInput {
  resolution: Extract<InboundResolution, { kind: 'live' }>;
  call_sid: string;
  voice_number_id: string | null;
  direction: 'inbound' | 'outbound';
  /** The location's currency (uppercase ISO). Omitted = USD (tool wording unchanged). */
  currency?: string | null;
}

export function buildVoiceAgentSession(input: BuildSessionInput): VoiceAgentSession {
  const r = input.resolution;
  const sessionId = newSessionId();
  const engine = config.voiceAgentDefaultEngine;

  const prompts = {} as Record<VoiceAgentState, string>;
  for (const [slot, body] of Object.entries(r.rendered_prompts)) {
    const k = stateKey(slot);
    if (!k) continue;
    prompts[k] = substituteDynamicVars(body, r.dynamic_variables);
  }
  for (const k of VOICE_AGENT_STATES) if (!prompts[k]) prompts[k] = '';

  const canTransfer = !!r.transfer_to_number;
  const tools = voiceToolDefs({ canTransferToHuman: canTransfer, currency: input.currency });
  const locationName = r.locationVars?.location_name || r.config.settings.default_location_name;
  const receptionistName = r.locationVars?.receptionist_name || r.config.settings.default_receptionist_name;

  // Retell parity: the BEGIN MESSAGE. The agent speaks this fixed line the instant
  // the call connects, verbatim, BEFORE the LLM runs, so the opening is identical
  // every call and never improvised (Retell's "begin message" with {{variables}}).
  // Mirrors the operator's Retell template: "Thank you for calling {location}, this
  // is {receptionist} speaking, how can I help you?". Variables come from the same
  // resolved location vars the prompts use.
  // SHARED CHANNELS: a number serving several locations greets as the COMPANY (the home
  // site's voice and receptionist name); the location is pinned mid-call.
  const beginMessage = renderBeginMessage(r.shared ? (r.company_name || locationName) : locationName, receptionistName);

  const context: VoiceRtSessionContext = {
    session_id: sessionId,
    direction: input.direction,
    call_sid: input.call_sid,
    from_number: r.from_number,
    to_number: r.to_number,
    company_id: r.company_id,
    location_id: r.location_id,
    timezone: r.enrichment_timezone,
    prompts,
    disambiguation_instruction: r.disambiguation_instruction,
    initial_state: 'starter',
    voice: resolveVoiceRtVoice(r.voice, engine),
    settings: {
      turn_taking_mode: 'balanced',
      // Max call duration (owner 2026-10-06: Retell was 7m, bump to 10m). A hard
      // safety cap; a normal booking call is far shorter.
      max_duration_seconds: 10 * 60,
      stt_model: config.voiceAgentSttModel,
      llm_model: config.voiceAgentLlmModel,
      greeting: beginMessage,
    },
    tools,
    tool_routing: voiceToolRouting(tools),
    can_transfer_to_human: canTransfer,
  };

  // The chat-agent dispatcher payload. Field parity with the SMS/WhatsApp
  // handoff so every shared tool behaves identically on the phone. `channel`
  // 'voice' maps to source_ref_type 'retell_call' in dispatchTool (the value
  // every existing reader keys on for AI phone bookings).
  const toolPayload: Part2HandoffPayload = {
    company_id: r.company_id,
    location_id: r.location_id,
    channel: 'voice',
    database_message_id: '',
    session_id: sessionId,
    timezone: r.enrichment_timezone,
    first_name: r.contact?.first_name ?? '',
    last_name: r.contact?.last_name ?? '',
    phoneNumber: r.from_number,
    receivingPhone: r.to_number,
    contact_id: r.pinned_contact_id,
    contact_disambiguated: false,
    booking_status_id: r.tenant.booking_status_id,
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
    // SHARED CHANNELS: the location gate refuses location-scoped tools until the caller
    // chooses (set_call_location / set_conversation_location pins it and flips confirmed).
    shared_channel: r.shared
      ? {
          group_id: r.shared.groupId,
          home_location_id: r.shared.homeLocationId,
          confirmed: false,
          served: r.shared.served.map((s) => ({ location_id: s.location_id, name: s.name })),
        }
      : null,
    allowed_location_ids: r.location_id ? [r.location_id] : [],
  };

  return createSession({
    session_id: sessionId,
    created_at: Date.now(),
    connected_at: null,
    ended_at: null,
    finalized_at: null,
    direction: input.direction,
    call_sid: input.call_sid,
    from_number: r.from_number,
    to_number: r.to_number,
    company_id: r.company_id,
    location_id: r.location_id,
    voice_number_id: input.voice_number_id,
    timezone: r.enrichment_timezone,
    receptionist_name: receptionistName,
    location_name: locationName,
    transfer_to_number: r.transfer_to_number,
    contact: {
      id: r.pinned_contact_id || null,
      first_name: r.contact?.first_name ?? null,
      last_name: r.contact?.last_name ?? null,
      disambiguated: false,
    },
    dynamic_variables: { ...r.dynamic_variables },
    context,
    tool_payload: toolPayload,
    live: { state: 'starter', turns: 0, tool_calls: 0, last_event_at: null },
    recording_bucket_path: null,
    end: null,
  });
}

/** Fire-and-forget decision audit (same table Retell decisions land in). */
function logDecision(args: {
  company_id: string | null;
  location_id: string | null;
  from_number: string;
  to_number: string;
  disposition: 'live' | 'transfer' | 'hangup' | 'error';
  decision_reason: string | null;
  duration_ms: number;
  session_id?: string;
  call_sid: string;
}): void {
  setImmediate(() => {
    void supabaseAdmin
      .from('retell_inbound_call_logs')
      .insert({
        company_id: args.company_id,
        location_id: args.location_id,
        from_number: args.from_number,
        to_number: args.to_number,
        disposition: args.disposition,
        decision_reason: args.decision_reason,
        duration_ms: args.duration_ms,
        signature_ok: null,
        request_body: { provider: 'pipecat', call_sid: args.call_sid },
        response_body: { provider: 'pipecat', session_id: args.session_id ?? null },
      })
      .then(({ error }) => {
        if (error) {
          reportError(new Error(`retell_inbound_call_logs insert failed: ${error.message}`), {
            type: 'api_error',
            dedupe: 'silent',
            metadata: { context: 'voice_agent_inbound_log_insert_failed', server: 'billing' },
          });
        }
      });
  });
}

export interface AnswerInboundInput {
  call_sid: string;
  /** E.164 with + as SignalWire posts it. */
  from: string;
  to: string;
  voice_number_id: string | null;
}

/**
 * The inbound seam. Returns a complete cXML document. NEVER throws: any
 * failure degrades to the merchant's fallback number when one exists, else a
 * hangup, and reports the error.
 */
export async function answerInboundWithPipecat(input: AnswerInboundInput): Promise<string> {
  const t0 = Date.now();
  const fromDigits = input.from.replace(/^\+/, '');
  const toDigits = input.to.replace(/^\+/, '');
  try {
    const resolution = await resolveInboundCall({ fromNumberRaw: input.from, toNumberRaw: input.to });

    if (resolution.kind === 'hangup') {
      logDecision({
        company_id: resolution.company_id, location_id: resolution.location_id,
        from_number: fromDigits, to_number: toDigits, disposition: 'hangup',
        decision_reason: resolution.reason, duration_ms: Date.now() - t0, call_sid: input.call_sid,
      });
      return buildHangupTwiml();
    }

    if (resolution.kind === 'transfer') {
      logDecision({
        company_id: resolution.company_id, location_id: resolution.location_id,
        from_number: fromDigits, to_number: toDigits, disposition: 'transfer',
        decision_reason: resolution.reason, duration_ms: Date.now() - t0, call_sid: input.call_sid,
      });
      return buildTransferTwiml({ toE164: resolution.transfer_to_number, callerId: input.from });
    }

    // TEST GATE (re-checked on EVERY call): master switch + company targeting.
    // A closed gate on a number that was switched to self-hosted sends the
    // caller to the human fallback (never dead air) and pages, because it means
    // either the kill switch was thrown or the company was removed from the flag.
    const gate = await evaluateVoiceAgentGate(resolution.company_id, resolution.location_id);
    if (!gate.allowed) {
      reportError(new Error(`self-hosted voice agent gate closed on a live number: ${gate.reason}`), {
        type: 'voice_agent_gate_closed',
        dedupe: 'silent',
        escalateAfter: 5,
        metadata: {
          source: 'voiceAgent.session.answerInboundWithPipecat',
          company_id: resolution.company_id,
          location_id: resolution.location_id,
          to_number: toDigits,
          reason: gate.reason,
          note: gate.reason ? describeGateReason(gate.reason) : null,
        },
      });
      logDecision({
        company_id: resolution.company_id, location_id: resolution.location_id,
        from_number: fromDigits, to_number: toDigits,
        disposition: resolution.transfer_to_number ? 'transfer' : 'hangup',
        decision_reason: `gate_${gate.reason}`, duration_ms: Date.now() - t0, call_sid: input.call_sid,
      });
      return resolution.transfer_to_number
        ? buildTransferTwiml({ toE164: resolution.transfer_to_number, callerId: input.from })
        : buildHangupTwiml();
    }

    // live
    const session = buildVoiceAgentSession({
      resolution,
      call_sid: input.call_sid,
      voice_number_id: input.voice_number_id,
      direction: 'inbound',
      // Cached, fails safe to 'USD' (which leaves the tool definitions untouched).
      currency: await getLocationCurrencyCached(supabaseAdmin, resolution.location_id),
    });
    const twiml = buildStreamTwiml(session.session_id);
    if (!twiml) {
      // Runtime not deployed/configured. Never dead-air: fall back to the
      // human, and page (this is a real misconfiguration on a live number).
      reportError(new Error('ai_provider=pipecat but VOICE_RT_URL is not configured'), {
        type: 'voice_agent_runtime_unconfigured',
        metadata: { source: 'voiceAgent.session.answerInboundWithPipecat', company_id: resolution.company_id, to_number: toDigits },
      });
      logDecision({
        company_id: resolution.company_id, location_id: resolution.location_id,
        from_number: fromDigits, to_number: toDigits,
        disposition: resolution.transfer_to_number ? 'transfer' : 'hangup',
        decision_reason: 'runtime_unconfigured', duration_ms: Date.now() - t0, call_sid: input.call_sid,
      });
      return resolution.transfer_to_number
        ? buildTransferTwiml({ toE164: resolution.transfer_to_number, callerId: input.from })
        : buildHangupTwiml();
    }
    logDecision({
      company_id: resolution.company_id, location_id: resolution.location_id,
      from_number: fromDigits, to_number: toDigits, disposition: 'live',
      decision_reason: null, duration_ms: Date.now() - t0, call_sid: input.call_sid,
      session_id: session.session_id,
    });
    // SHARED CHANNELS: the per-call location row (keyed by the session id the tool payload
    // carries). Unconfirmed on a shared number until set_call_location; confirmed by
    // construction on an ordinary number. Fire-and-forget: a failure only loses the
    // post-call attribution fallback (the in-memory session still carries the pin).
    void supabaseAdmin
      .from('ai_call_state')
      .upsert(
        {
          call_id: session.session_id,
          provider: 'pipecat',
          company_id: resolution.company_id,
          to_number: toDigits,
          shared_group_id: resolution.shared?.groupId ?? null,
          location_id: resolution.shared ? null : resolution.location_id,
          location_confirmed_at: resolution.shared ? null : new Date().toISOString(),
          location_confirmed_by: resolution.shared ? null : 'system',
        },
        { onConflict: 'call_id' },
      )
      .then(({ error }) => {
        if (error) {
          reportError(error as unknown as Error, {
            type: 'api_error',
            dedupe: 'silent',
            metadata: { source: 'voiceAgent.session.aiCallState', session_id: session.session_id },
          });
        }
      });
    return twiml;
  } catch (err) {
    reportError(err instanceof Error ? err : new Error(String(err)), {
      type: 'voice_agent_inbound_error',
      metadata: { source: 'voiceAgent.session.answerInboundWithPipecat', from: fromDigits, to: toDigits, call_sid: input.call_sid, note: 'caller fell back to transfer/hangup' },
    });
    logDecision({
      company_id: null, location_id: null, from_number: fromDigits, to_number: toDigits,
      disposition: 'error', decision_reason: 'handler_error', duration_ms: Date.now() - t0, call_sid: input.call_sid,
    });
    // Best-effort fallback: the location's transfer number, if we can find it.
    try {
      const { data: lv } = await supabaseAdmin
        .from('voice_numbers')
        .select('location_id')
        .or(`phone_number.eq.+${toDigits},phone_number.eq.${toDigits}`)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();
      const locationId = (lv as { location_id?: string | null } | null)?.location_id ?? null;
      if (locationId) {
        const { data: pv } = await supabaseAdmin
          .from('location_prompt_variables')
          .select('transfer_to_number')
          .eq('location_id', locationId)
          .maybeSingle();
        const t = (pv as { transfer_to_number?: string | null } | null)?.transfer_to_number;
        if (t) return buildTransferTwiml({ toE164: t, callerId: input.from });
      }
    } catch {
      // fall through to hangup
    }
    return buildHangupTwiml();
  }
}
