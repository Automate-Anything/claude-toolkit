/**
 * The voice agent's tool library = the SHARED chat-agent tool library + the
 * voice-only tools. Defined ONCE here (schemas + dispatch); voice-rt only
 * proxies tool calls back to `POST /sessions/:id/tool-call`, so there is no
 * second copy of any tool in Python. Adding a tool for the receptionist means
 * adding it to ai/chat-agent/tools.ts; the phone agent picks it up on the
 * next call with zero voice-rt changes.
 *
 * Tool NAMES are load-bearing: the live prompt bodies (retell_prompts) tell the
 * model to call `checkAvailability`, `CreateAppointment`, `transfer_call`,
 * `end_call`, `booking_agent_transfer`, ... by those exact names. Do not
 * rename without re-reading every slot.
 */
import { TOOL_DEFS, dispatchTool, toolDefsForCurrency, type OpenAIToolDef } from '../ai/chat-agent/tools.js';
import { supabaseAdmin } from '../config/supabase.js';
import { resolveCallerIdentity } from '../contacts/resolveCallerIdentity.js';
import { lamlModifyCallUrl } from '../voice/conferenceOrchestrate.js';
import { reportError } from '../utils/errorReporter.js';
import { transferRedirectUrl } from './laml.js';
import { STATE_SWITCH_TOOLS, type VoiceAgentSession, type VoiceToolRouting } from './types.js';

const noParams = { type: 'object' as const, properties: {}, required: [] as string[], additionalProperties: false as const };

/** Voice-only tools (not in the chat library). */
export const VOICE_ONLY_TOOL_DEFS: OpenAIToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'set_caller_identity',
      description:
        'Identify WHICH customer is calling when this phone number is shared by more than one person. Pass the first and last name the caller spoke. Returns the resolved contact so later tools act on the right person. Call it again with is_new=true if the caller says they are a new customer.',
      parameters: {
        type: 'object',
        properties: {
          first_name: { type: 'string' },
          last_name: { type: 'string' },
          name: { type: 'string', description: 'Full spoken name (alternative to first_name + last_name).' },
          is_new: { type: 'boolean', description: 'True when the caller says they are a new customer not on file.' },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'transfer_call',
      description:
        'Send the caller to a live HUMAN at the business. A genuine last resort: only when the caller explicitly asks for a person, or a tool/system error stops you from helping. Say one short sentence first (e.g. "One moment while I transfer you") and then call this.',
      parameters: noParams,
    },
  },
  {
    type: 'function',
    function: {
      name: 'end_call',
      description: 'Hang up after the goodbye has been said and the caller has nothing else.',
      parameters: noParams,
    },
  },
  {
    type: 'function',
    function: {
      name: 'mark_do_not_call',
      description:
        "Record that this caller does NOT want to be called again, when they ask you to stop calling, remove them from the list, or say they never want these calls. Acknowledge it warmly, tell them you have noted it, then call this. By default it stops marketing/outreach calls; if they say to stop ALL calls including reminders, pass scope 'all'.",
      parameters: {
        type: 'object',
        properties: {
          scope: {
            type: 'string',
            enum: ['marketing', 'all'],
            description: "'marketing' (default): stop outreach/promo/reminder calls. 'all': stop every call including transactional.",
          },
        },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_availability_recurring',
      description: 'Alias of checkAvailabilityRecurring (same behavior). Prefer checkAvailabilityRecurring.',
      parameters: {
        type: 'object',
        properties: {
          technician_id: { type: 'string' },
          location_id: { type: 'string' },
          services_id: { type: 'string' },
          duration: { type: 'string' },
          booking_start_datetime: { type: 'string' },
          freq: { type: 'string', enum: ['weekly', 'bi-weekly', 'tri-weekly', 'monthly'] },
          byday: { type: 'string' },
          until: { type: 'number' },
        },
        required: ['location_id', 'services_id', 'duration', 'booking_start_datetime', 'freq', 'byday', 'until'],
        additionalProperties: false,
      },
    },
  },
  // Internal state switches (Retell multi-prompt parity). voice-rt handles
  // these locally: swap the system prompt to the target state and continue.
  ...Object.entries(STATE_SWITCH_TOOLS).map(([name, state]): OpenAIToolDef => ({
    type: 'function',
    function: {
      name,
      description: `INTERNAL switch: hand the conversation to the ${state} specialist. The caller stays on the line with you. Not a human transfer.`,
      parameters: noParams,
    },
  })),
];

/** Chat-tool names -> the canonical dispatcher name (aliases the prompts use). */
const ALIASES: Record<string, string> = {
  check_availability_recurring: 'checkAvailabilityRecurring',
  // SHARED CHANNELS: the phone prompt names the Retell function; the chat library owns the tool.
  set_call_location: 'set_conversation_location',
};

export function voiceToolDefs(opts: { canTransferToHuman: boolean; currency?: string | null }): OpenAIToolDef[] {
  // Same per-currency wrap the chat agent uses (it rewords the money parameters for a
  // non-USD location). USD, or no currency passed, returns the definitions untouched.
  const defs = toolDefsForCurrency([...TOOL_DEFS, ...VOICE_ONLY_TOOL_DEFS], opts.currency);
  // Never offer transfer_call when there is nobody to transfer to: the model
  // would call it, we would fail it, and the caller would hear a dead end.
  return opts.canTransferToHuman ? defs : defs.filter((d) => d.function.name !== 'transfer_call');
}

export function voiceToolRouting(defs: OpenAIToolDef[]): Record<string, VoiceToolRouting> {
  const out: Record<string, VoiceToolRouting> = {};
  for (const d of defs) {
    const n = d.function.name;
    if (n in STATE_SWITCH_TOOLS) out[n] = 'local_state_switch';
    else if (n === 'end_call') out[n] = 'local_end_call';
    else if (n === 'transfer_call') out[n] = 'transfer_call';
    else out[n] = 'server';
  }
  return out;
}

export interface VoiceToolCallResult {
  ok: boolean;
  result: unknown;
  error?: string | null;
  latency_ms: number;
}

/**
 * Run one tool for a live session. Called by routes/rt.ts. Chat-library tools
 * go through the SAME `dispatchTool` the SMS/WhatsApp/webchat receptionist
 * uses; voice-only tools are handled here.
 */
export async function dispatchVoiceTool(
  session: VoiceAgentSession,
  name: string,
  args: Record<string, unknown>,
  step: number,
): Promise<VoiceToolCallResult> {
  const t0 = Date.now();
  session.live.tool_calls += 1;
  session.live.last_event_at = t0;

  try {
    if (name in STATE_SWITCH_TOOLS) {
      // Defensive: voice-rt handles these locally, but if one reaches us just
      // acknowledge so the model is never stuck.
      session.live.state = STATE_SWITCH_TOOLS[name];
      return { ok: true, result: { switched_to: STATE_SWITCH_TOOLS[name] }, latency_ms: Date.now() - t0 };
    }

    if (name === 'end_call') {
      return { ok: true, result: { ok: true }, latency_ms: Date.now() - t0 };
    }

    if (name === 'mark_do_not_call') {
      const scope = args.scope === 'all' ? 'all' : 'marketing';
      // The CUSTOMER's number: the caller (from) on an inbound call, the callee
      // (to) on an outbound/campaign call. Both are stored as bare E.164 digits
      // (no leading +), which is exactly what is_call_opted_out looks up, so the
      // next dial to this person is actually suppressed. Writing from_number on
      // an outbound call would opt out OUR own number and never block the
      // customer (TCPA violation).
      const customerNumber = session.direction === 'outbound' ? session.to_number : session.from_number;
      const { error } = await supabaseAdmin.from('voice_call_opt_outs').insert({
        company_id: session.company_id,
        location_id: session.location_id,
        phone_number: customerNumber,
        contact_id: session.contact.id,
        source_call_session_id: session.session_id,
        opt_out_method: 'agent',
        opt_out_message: `Requested during ${session.direction} call ${session.session_id}`,
        scope,
      });
      if (error) {
        reportError(error as unknown as Error, {
          type: 'voice_agent_optout_write_failed',
          metadata: { source: 'voiceAgent.tools.mark_do_not_call', session_id: session.session_id, company_id: session.company_id, note: 'customer asked to stop calls but the opt-out did not save' },
        });
        return { ok: false, result: null, error: 'could not record the do-not-call request', latency_ms: Date.now() - t0 };
      }
      return { ok: true, result: { recorded: true, scope }, latency_ms: Date.now() - t0 };
    }

    if (name === 'transfer_call') {
      const target = session.transfer_to_number;
      if (!target) {
        return { ok: false, result: null, error: 'no transfer number configured for this location', latency_ms: Date.now() - t0 };
      }
      // Redirect the caller's leg to a <Dial> to the human. SignalWire fetches
      // the transfer URL, which ends the media stream (voice-rt sees the
      // disconnect and reports ended_by='transfer').
      const ok = await lamlModifyCallUrl(session.call_sid, transferRedirectUrl(session.session_id));
      if (!ok) {
        reportError(new Error('voice-agent transfer_call: modify-call failed'), {
          type: 'voice_agent_transfer_failed',
          metadata: { source: 'voiceAgent.tools.transfer_call', session_id: session.session_id, call_sid: session.call_sid, company_id: session.company_id },
        });
        return { ok: false, result: null, error: 'transfer failed', latency_ms: Date.now() - t0 };
      }
      return { ok: true, result: { transferring_to: `+${target}` }, latency_ms: Date.now() - t0 };
    }

    if (name === 'set_caller_identity') {
      const spokenName = typeof args.name === 'string'
        ? args.name
        : [args.first_name, args.last_name].filter((x) => typeof x === 'string').join(' ');
      const r = await resolveCallerIdentity({
        companyId: session.company_id,
        userNumber: session.from_number,
        locationId: session.location_id,
        spokenName,
        isNew: args.is_new === true,
      });
      if (r.resolved && r.contact_id) {
        // Pin the person for every later tool in this call (the Retell
        // `{{contact_id}}` response-variable behavior, done server-side).
        session.contact.id = r.contact_id;
        session.contact.disambiguated = r.disambiguated;
        session.tool_payload.contact_id = r.contact_id;
        session.tool_payload.contact_disambiguated = r.disambiguated;
        session.dynamic_variables.contact_id = r.contact_id;
      }
      return { ok: true, result: r, latency_ms: Date.now() - t0 };
    }

    const canonical = ALIASES[name] ?? name;
    const entry = await dispatchTool({
      name: canonical,
      rawArgs: JSON.stringify(args ?? {}),
      payload: session.tool_payload,
      dryRun: false,
      step,
    });
    if (canonical === 'set_conversation_location' && entry.ok) {
      // SHARED CHANNELS: mirror the pin onto the live session so transfer_call dials the
      // pinned site's desk, post-call attribution lands there, and the dynamic variables the
      // prompts read reflect the choice (set_caller_identity does the same for the contact).
      const r = entry.result as { location_id?: string; location_name?: string; timezone?: string; transfer_to_number?: string | null } | null;
      if (r?.location_id) {
        session.location_id = r.location_id;
        session.location_name = r.location_name ?? session.location_name;
        if (r.timezone) session.timezone = r.timezone;
        // Keep the home's transfer number when the pinned site has none: never drop the tool mid-call.
        if (r.transfer_to_number) session.transfer_to_number = r.transfer_to_number;
        session.context.location_id = r.location_id;
        session.dynamic_variables.location_id = r.location_id;
        if (r.location_name) session.dynamic_variables.location_name = r.location_name;
        if (r.transfer_to_number) session.dynamic_variables.transfer_to_number = r.transfer_to_number;
      }
    }
    return {
      ok: entry.ok,
      result: entry.result ?? null,
      error: entry.error ?? null,
      latency_ms: Date.now() - t0,
    };
  } catch (err) {
    reportError(err instanceof Error ? err : new Error(String(err)), {
      type: 'voice_agent_tool_error',
      metadata: { source: 'voiceAgent.tools.dispatchVoiceTool', tool: name, session_id: session.session_id, company_id: session.company_id },
    });
    return { ok: false, result: null, error: err instanceof Error ? err.message : String(err), latency_ms: Date.now() - t0 };
  }
}
