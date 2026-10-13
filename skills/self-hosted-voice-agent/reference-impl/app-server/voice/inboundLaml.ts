/**
 * LAML (cXML/TwiML) inbound handler - sibling of the SWML inbound webhook in
 * routes/webhooks.ts, returning XML instead of SWML JSON.
 *
 * Why this exists: SignalWire's SWML join_conference leaves the customer's
 * leg in a namespace where LAML modify-call / end-conference return 200 but
 * don't actually drop the leg, so after the last agent leaves the customer
 * sits in a dead conference for ~30s before SignalWire's internal timeout
 * evicts them. Per SignalWire support, putting the customer's inbound leg
 * inside a cXML <Dial><Conference> instead puts the leg in the LAML
 * namespace where end-conference reliably terminates it.
 *
 * Architecture mirrors webhooks.ts:
 *   - Inbound entrypoint at /api/voice/inbound-laml.
 *   - IVR walked node-by-node via /api/voice/laml/ivr-node?flow=&node=,
 *     because TwiML is request/response (each <Gather> POSTs back to an
 *     action URL) rather than a single document with internal sections.
 *   - Voicemail recording finalization at /api/voice/laml/voicemail-callback
 *     (Twilio-form-style payload, distinct from SWML's status_url shape).
 *
 * Agents still join the conference via SWML originate (Realtime SDK +
 * /api/voice/transfer/swml?room=&role=agent). Conferences are namespace-
 * agnostic at the FreeSWITCH layer, so a TwiML-joined customer + SWML-joined
 * agents meet in the same room.
 */

import { Router, type Request, type Response } from 'express';
import axios from 'axios';
import { randomUUID } from 'node:crypto';
import { getSupabaseClient } from '../config/supabase.js';
import { config } from '../config/env.js';
import {
  getLocationRecordingMode,
  getLocationRecordingConfig,
  shouldRecordHuman,
  recordingAnnouncementLaml,
} from './recording.js';
import {
  markCustomerJoined,
  registerCustomerInboundCallId,
  originateFabricUserIntoConference,
  originatePhoneIntoConference,
  countConferenceParticipants,
  findConferenceSid,
  lamlEndConference,
  roomEverHadAgent,
  registerCallHistoryContext,
  flushRoomCallHistory,
  markCustomerLamlNamespace,
} from './conferenceOrchestrate.js';
import { lookupRetellOverflowNumber, resolveQueueAiOverflowTarget, orderMembersOneAtATime, resolveQueueDeviceMembers, deviceSipUri } from './queueRouting.js';
import { getSipHost } from './providers/sipEndpoints.js';
import { retellClient } from '../retell/retellClient.js';
import { captureSignalwireRecording, downloadSignalwireRecording } from './callRecordingStorage.js';
import { reportError } from '../utils/errorReporter.js';
import { signalWireCallbackQuery } from '../sms/utils/signalwireSignature.js';
import { normalizeBranches } from './ivrBranchShape.js';
import { processVoicemailPostCapture } from './voicemailPostProcess.js';
import { resolveVoicemailGreeting } from './voicemailGreeting.js';
import { resolveSmsCallForwardTarget } from './smsCallForwardTarget.js';
import { answerInboundWithPipecat } from '../voiceAgent/session.js';
import { shouldUseSelfHosted } from '../voiceAgent/gate.js';

// ─── Self-hosted AI (pipecat) helpers ───────────────────────────────────────

/**
 * Which AI brain a voice number is on, gated on the AI switch. Used wherever
 * the LaML path would otherwise dial Retell's SIP trunk, so the same decision
 * points (direct dispatch, IVR transfer_ai, queue overflow) can hand the
 * caller to the self-hosted runtime instead.
 */
async function loadAiProviderForVoiceNumber(
  voiceNumberId: string,
): Promise<'retell' | 'pipecat' | null> {
  const supabase = getSupabaseClient();
  const { data: vn } = await supabase
    .from('voice_numbers')
    .select('ai_provider, ai_active, company_id, location_id')
    .eq('id', voiceNumberId)
    .maybeSingle();
  const row = vn as { ai_provider?: string | null; ai_active?: boolean | null; company_id?: string | null; location_id?: string | null } | null;
  if (!row?.ai_provider || row.ai_active === false) return null;
  // Per-company cutover (owner's model): a company switched on in the superadmin
  // self_hosted_voice_agent flag uses the self-hosted runtime for ALL its AI call
  // paths, regardless of the number's stored ai_provider. This is the ONE routing
  // decision; Phase 2 ("everyone") is a one-line change in shouldUseSelfHosted.
  // Fails SAFE: shouldUseSelfHosted returns false on any error, so the call stays
  // on whatever ai_provider the number already has (Retell today).
  try {
    if (await shouldUseSelfHosted(row.company_id ?? null, row.location_id ?? null)) {
      return 'pipecat';
    }
  } catch {
    // keep the stored provider below
  }
  return row.ai_provider === 'pipecat' ? 'pipecat' : row.ai_provider === 'retell' ? 'retell' : null;
}

/** The full cXML doc that hands the caller to voice-rt (never throws). */
function pipecatAnswerTwiml(ctx: LamlContext): Promise<string> {
  return answerInboundWithPipecat({
    call_sid: ctx.callSid,
    from: ctx.fromNumber,
    to: ctx.toNumber,
    voice_number_id: ctx.voiceNumberId,
  });
}

// ─── TwiML XML helpers ──────────────────────────────────────────────────────

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function attrs(pairs: Record<string, string | number | boolean | undefined>): string {
  const out: string[] = [];
  for (const [k, v] of Object.entries(pairs)) {
    if (v === undefined || v === null || v === '') continue;
    out.push(`${k}="${xmlEscape(String(v))}"`);
  }
  return out.length ? ' ' + out.join(' ') : '';
}

function twimlDoc(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;
}

function sendTwiml(res: Response, body: string): void {
  res.setHeader('Content-Type', 'text/xml; charset=utf-8');
  res.status(200).send(body);
}

function tHangup(): string {
  return '<Hangup/>';
}

function tPlay(url: string): string {
  return `<Play>${xmlEscape(url)}</Play>`;
}

function tSay(text: string): string {
  return `<Say>${xmlEscape(text)}</Say>`;
}

function tRedirect(url: string): string {
  return `<Redirect>${xmlEscape(url)}</Redirect>`;
}

// ─── Voicemail context (mirrors webhooks.ts:VoicemailContext) ───────────────

interface LamlContext {
  callSid: string;
  voiceNumberId: string;
  locationId: string;
  companyId: string;
  fromNumber: string;
  toNumber: string;
}

async function loadPromptUrl(promptId: string | undefined | null): Promise<string | null> {
  if (!promptId) return null;
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from('ivr_prompts')
    .select('audio_url')
    .eq('id', promptId)
    .maybeSingle();
  return data?.audio_url || null;
}

// ─── Business-hours helpers (copy of webhooks.ts impls, kept local to avoid
// exporting them from webhooks.ts and tangling the SWML path further) ───────

function nowInTimezone(timezone: string, at: Date): { weekdayShort: string; minutes: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(at);
  const weekdayShort = parts.find(p => p.type === 'weekday')?.value || 'Sun';
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
  const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
  return { weekdayShort, minutes: hour * 60 + minute };
}

function isOpenNow(
  hoursRows: Array<{ day_of_week: number; open_time: string; close_time: string; is_closed: boolean; timezone: string }>,
  at: Date = new Date(),
): boolean {
  if (hoursRows.length === 0) return false;
  const timezone = hoursRows[0].timezone || 'America/New_York';
  const { weekdayShort, minutes: nowMinutes } = nowInTimezone(timezone, at);
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dow = dayMap[weekdayShort] ?? 0;
  const row = hoursRows.find(r => r.day_of_week === dow);
  if (!row || row.is_closed) return false;
  const [oh, om] = row.open_time.split(':').map(x => parseInt(x, 10));
  const [ch, cm] = row.close_time.split(':').map(x => parseInt(x, 10));
  return nowMinutes >= oh * 60 + om && nowMinutes < ch * 60 + cm;
}

function parse12hToMinutes(s: string): number | null {
  const m = s.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12;
  else if (m[3].toUpperCase() === 'AM' && h === 12) h = 0;
  return h * 60 + min;
}

function isOpenNowFromSchedule(
  dayAndTime: Record<string, string> | null | undefined,
  timezone: string,
  at: Date = new Date(),
): boolean {
  if (!dayAndTime) return false;
  const { weekdayShort, minutes: nowMinutes } = nowInTimezone(timezone || 'America/New_York', at);
  const dayString = dayAndTime[weekdayShort];
  if (!dayString || typeof dayString !== 'string') return false;
  for (const range of dayString.split(',')) {
    const [start, end] = range.trim().split('-').map(s => s?.trim());
    if (!start || !end) continue;
    const startMin = parse12hToMinutes(start);
    const endMin = parse12hToMinutes(end);
    if (startMin === null || endMin === null) continue;
    if (nowMinutes >= startMin && nowMinutes < endMin) return true;
  }
  return false;
}

// ─── Forwarding member type + loader ────────────────────────────────────────

interface MemberWithForwarding {
  user_id: string;
  priority: number;
  forward_calls_enabled: boolean;
  forward_calls_to: string | null;
  forward_after_seconds: number;
  forward_calls_parallel: boolean;
}

async function loadForwardingByUser(
  userIds: string[],
): Promise<Map<string, { enabled: boolean; to: string | null; after: number; parallel: boolean }>> {
  const out = new Map<string, { enabled: boolean; to: string | null; after: number; parallel: boolean }>();
  if (userIds.length === 0) return out;
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from('users')
    .select('id, forward_calls_to, forward_calls_enabled, forward_after_seconds, forward_calls_parallel')
    .in('id', userIds);
  for (const u of data || []) {
    out.set(u.id as string, {
      enabled: !!u.forward_calls_enabled,
      to: (u.forward_calls_to as string | null) ?? null,
      after: (u.forward_after_seconds as number | null) ?? 15,
      parallel: !!u.forward_calls_parallel,
    });
  }
  return out;
}

// ─── IVR flow types (same shape as webhooks.ts) ─────────────────────────────

interface IVRBranchObj { id?: string; digit?: string; voice?: string; target: string; }
interface IVRMenuNode { type: 'menu'; prompt_id?: string; max_digits?: number; timeout_ms?: number; branches: Record<string, string> | IVRBranchObj[]; default_target?: string; }
interface IVRPlayNode { type: 'play'; prompt_id?: string; next_node_id?: string; }
interface IVRQueueNode { type: 'queue'; queue_id: string; prompt_before_id?: string; }
interface IVRVoicemailNode { type: 'voicemail'; prompt_id?: string; }
interface IVRTransferAINode { type: 'transfer_ai'; }
interface IVRHangupNode { type: 'hangup'; }
interface IVRRingUserNode { type: 'ring_user'; user_id: string; ring_seconds?: number; prompt_before_id?: string; next_node_id?: string; }
interface IVRForwardNumberNode { type: 'forward_number'; forward_number: string; ring_seconds?: number; next_node_id?: string; }
interface IVRScheduleNode { type: 'schedule'; open_target?: string; closed_target?: string; }
/** Hand the caller to another phone menu at the same location (its start step). */
interface IVRGotoMenuNode { type: 'goto_menu'; flow_id: string; }
type IVRNode = IVRMenuNode | IVRPlayNode | IVRQueueNode | IVRVoicemailNode | IVRTransferAINode | IVRHangupNode | IVRRingUserNode | IVRForwardNumberNode | IVRScheduleNode | IVRGotoMenuNode;

interface IVRFlow {
  id: string;
  company_id: string;
  location_id: string;
  /** Legacy: the number a menu was first built for. NOT the called number; see resolveIvrCallContext. */
  voice_number_id: string | null;
  is_active: boolean;
  root_node_id: string | null;
  nodes: Record<string, IVRNode>;
}

async function loadActiveFlow(flowId: string): Promise<IVRFlow | null> {
  const supabase = getSupabaseClient();
  const { data } = await supabase
    .from('ivr_flows')
    .select('id, company_id, location_id, voice_number_id, is_active, root_node_id, nodes')
    .eq('id', flowId)
    .maybeSingle();
  if (!data || !data.is_active || !data.root_node_id) return null;
  return data as IVRFlow;
}

// ─── Persistence - record customer leg in voice_active_calls ────────────────

async function persistConfRoom(opts: {
  callSid: string;
  companyId: string;
  voiceNumberId: string;
  fromNumber: string;
  toNumber: string;
  confRoom: string;
}): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('voice_active_calls').upsert(
      {
        provider_call_sid: opts.callSid,
        node_id: null,
        company_id: opts.companyId,
        voice_number_id: opts.voiceNumberId,
        from_number: opts.fromNumber,
        to_number: opts.toNumber,
        conf_room: opts.confRoom,
        // LaML inbound path - persist so a restart can restore the correct
        // terminate primitive when rehydrating a parked call.
        customer_namespace: 'laml',
      },
      { onConflict: 'provider_call_sid' },
    );
    if (error) {
      console.error('[Voice/LAML] voice_active_calls upsert failed:', error);
      reportError(error as unknown as Error, {
        type: 'voice_active_calls_error',
        metadata: { source: 'inboundLaml.persistConfRoom', note: 'transfer lookups will fail for this call' },
      });
    }
  } catch (err) {
    console.error('[Voice/LAML] persistConfRoom threw:', err);
    reportError(err as Error, {
      type: 'voice_active_calls_error',
      metadata: { source: 'inboundLaml.persistConfRoom' },
    });
  }
}

// ─── Customer-side <Dial><Conference> builder ───────────────────────────────

function buildConferenceDial(opts: {
  room: string;
  recordHuman: boolean;
  /** Play "this call may be recorded" before the dial (location opt-in). */
  announceRecording?: boolean;
  publicBase: string;
  /** Where to send the caller after the conference ends. When 'voicemail',
   *  the post-conference endpoint redirects to a <Record>-based voicemail
   *  TwiML doc, but only when no agent ever joined (i.e. the call rang out
   *  unanswered). For successful conversations the post-conference endpoint
   *  returns <Hangup/> instead. */
  postConferenceCtx?: {
    ctx: LamlContext;
    overflowAction: 'retell' | 'voicemail' | 'hangup';
    /** Call-path continuation: on no-answer, continue the flow here. */
    cont?: { flowId: string; nextNode: string; hops: number };
  };
  /** Company id whose custom audio should play while the caller waits for
   *  an agent to join. When set, `waitUrl` resolves to our TwiML endpoint
   *  that plays the company's ring-back or queue music (with a built-in
   *  default fallback). When omitted, waitUrl is empty (legacy silence). */
  companyId?: string;
  /** Which wait audio to play. 'ringback' fits direct-route calls
   *  (one phone ringing); 'queue-music' fits ring-all queues where the
   *  caller is parked while multiple agents are dialed in parallel. */
  waitAudioType?: 'ringback' | 'queue-music';
}): string {
  const cbUrl =
    `${opts.publicBase}/api/voice/conference/event?` +
    signalWireCallbackQuery({ room: opts.room, role: 'customer' });

  // Conference attrs:
  //  - startConferenceOnEnter=false: customer is passive; conference doesn't
  //    "start" until an active participant (agent) joins.
  //  - endConferenceOnExit=false: customer leaving doesn't end the conference.
  //  - waitUrl: TwiML doc that plays the company's ring-back / queue music
  //    while the customer is alone in the conference. Falls back to the
  //    built-in default file on disk in app-server when the company
  //    hasn't uploaded a custom audio. Setting to "" suppresses SignalWire's
  //    own default hold music - we used to do that to get silence, but now
  //    we serve actual audio.
  //  - statusCallback fires on join/leave/end so existing handlers in
  //    conferenceOrchestrate continue to fire the 15s grace timer and
  //    LAML end-conference. With the customer now in the LAML namespace,
  //    LAML end-conference actually drops the leg (it returned 200 but
  //    no-op'd on SWML legs).
  const waitUrl = opts.companyId
    ? `${opts.publicBase}/api/voice/audio/twiml/${opts.waitAudioType ?? 'ringback'}?` +
      new URLSearchParams({ company_id: opts.companyId }).toString()
    : '';
  const confAttrs = attrs({
    startConferenceOnEnter: 'false',
    endConferenceOnExit: 'false',
    beep: 'false',
    waitUrl,
    // TwiML's waitMethod defaults to POST, but our audio TwiML endpoint
    // serves a static, idempotent response - GET both lets it cache at
    // the edge and avoids the "Cannot POST" 404 that nukes the conference
    // when the endpoint doesn't accept POST.
    waitMethod: waitUrl ? 'GET' : undefined,
    statusCallback: cbUrl,
    statusCallbackEvent: 'start end join leave',
    statusCallbackMethod: 'POST',
  });

  // Dial attrs:
  //  - timeLimit prevents zombie conferences from billing forever in
  //    pathological cases.
  //  - record='record-from-answer' captures the bridged audio. The
  //    recordingStatusCallback below is how we learn the final
  //    recording URL - the project-level /status webhook is not
  //    reliable for LaML-controlled calls, so we set our own callback
  //    on the <Dial> directly.
  //  - action= fires when <Dial> returns (conference ended). The endpoint
  //    inspects roomEverHadAgent to decide whether to send the caller to
  //    voicemail (rang out unanswered) or hang up (real conversation ended).
  //    Without action=, <Dial> falls through to the next verb unconditionally,
  //    which can't distinguish those two cases.
  const actionUrl = opts.postConferenceCtx
    ? postConferenceUrl(opts.postConferenceCtx.ctx, opts.room, opts.postConferenceCtx.overflowAction, opts.postConferenceCtx.cont)
    : undefined;
  const recordingCbUrl = opts.recordHuman
    ? `${opts.publicBase}/api/voice/laml/recording-callback`
    : undefined;
  const dialAttrs = attrs({
    timeLimit: 7200,
    record: opts.recordHuman ? 'record-from-answer' : undefined,
    recordingStatusCallback: recordingCbUrl,
    recordingStatusCallbackEvent: opts.recordHuman ? 'completed' : undefined,
    recordingStatusCallbackMethod: recordingCbUrl ? 'POST' : undefined,
    action: actionUrl,
    method: actionUrl ? 'POST' : undefined,
  });

  // When action= is set, Twilio runs the TwiML returned by the action URL
  // after <Dial> ends (rather than continuing in this doc). The trailing
  // <Hangup/> is only a fallback for the no-action case.
  const trailing = actionUrl ? '' : tHangup();
  // Recording disclosure plays to the caller BEFORE the dial/record begins, so
  // the announcement itself precedes the recorded audio.
  const announce = opts.recordHuman && opts.announceRecording ? recordingAnnouncementLaml() : '';
  return `${announce}<Dial${dialAttrs}><Conference${confAttrs}>${xmlEscape(opts.room)}</Conference></Dial>${trailing}`;
}

function postConferenceUrl(
  ctx: LamlContext,
  room: string,
  overflowAction: 'retell' | 'voicemail' | 'hangup',
  /** Call-path continuation: on no-answer, continue the flow at this node
   *  instead of applying overflowAction. */
  cont?: { flowId: string; nextNode: string; hops: number },
): string {
  const base = config.billingServerUrl || '';
  const qs = new URLSearchParams({
    room,
    overflow: overflowAction,
    voice_number_id: ctx.voiceNumberId,
    location_id: ctx.locationId,
    company_id: ctx.companyId,
    from: ctx.fromNumber,
    to: ctx.toNumber,
    call_sid: ctx.callSid,
  });
  if (cont) {
    qs.set('flow', cont.flowId);
    qs.set('next_node', cont.nextNode);
    qs.set('hops', String(cont.hops));
  }
  return `${base}/api/voice/laml/post-conference?${qs.toString()}`;
}

// ─── Queue routing (port of buildConferenceQueueActions) ────────────────────

interface QueueDispatchOpts {
  ctx: LamlContext;
  members: MemberWithForwarding[];
  /** Desk phones, always rung. deviceId carried for call_history attribution. */
  deviceSipUris?: Array<{ sipUri: string; deviceId: string }>;
  strategy: 'ring_all' | 'round_robin';
  ringSeconds: number;
  recordHuman: boolean;
  announceRecording?: boolean;
  overflowAction: 'retell' | 'voicemail' | 'hangup';
  queueId: string;
  lastDialedIndex: number;
}

async function buildQueueTwiml(opts: QueueDispatchOpts): Promise<string> {
  const publicBase = config.billingServerUrl;
  if (!publicBase) {
    console.error('[Voice/LAML] BILLING_SERVER_URL not set - hanging up');
    reportError(new Error('BILLING_SERVER_URL not set; inbound LAML call hung up'), {
      type: 'voice_config_error:critical',
      metadata: { source: 'inboundLaml.buildQueueTwiml' },
    });
    return twimlDoc(tHangup());
  }
  const room = `call_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

  // Side effects fire BEFORE we return the TwiML. Unlike SWML where the
  // executor blocks on a `request` action, TwiML is a single response -
  // we synchronously persist the room and originate agent legs, then
  // hand SignalWire the TwiML that puts the customer in the conference.
  // The originates run in parallel with SignalWire fetching the TwiML
  // (we don't await), so the customer hits the conference instantly and
  // agents converge a moment later.
  await persistConfRoom({
    callSid: opts.ctx.callSid,
    companyId: opts.ctx.companyId,
    voiceNumberId: opts.ctx.voiceNumberId,
    fromNumber: opts.ctx.fromNumber,
    toNumber: opts.ctx.toNumber,
    confRoom: room,
  });
  markCustomerJoined(room, undefined, opts.ctx.fromNumber);
  registerCustomerInboundCallId(room, opts.ctx.callSid, '');
  markCustomerLamlNamespace(room);
  registerCallHistoryContext(room, {
    providerCallSid: opts.ctx.callSid,
    fromNumber: opts.ctx.fromNumber,
    toNumber: opts.ctx.toNumber,
    companyId: opts.ctx.companyId,
    locationId: opts.ctx.locationId,
    voiceNumberId: opts.ctx.voiceNumberId,
  });

  const toDial = await pickMembersForStrategy(opts);

  for (const member of toDial) {
    void originateFabricUserIntoConference({
      fromNumber: opts.ctx.toNumber,
      callerId: opts.ctx.fromNumber,
      userId: member.user_id,
      room,
      publicBase,
    }).catch(err => {
      console.error(`[Voice/LAML] originate Fabric failed user=${member.user_id}:`, err);
      reportError(err as Error, {
        type: 'voice_originate_error',
        metadata: { source: 'inboundLaml.buildQueueTwiml', target: 'fabric_user', userId: member.user_id, room },
      });
    });

    if (member.forward_calls_enabled && member.forward_calls_to) {
      const cell = member.forward_calls_to;
      const fire = () => {
        void originatePhoneIntoConference({
          fromNumber: opts.ctx.toNumber,
          toPhone: cell,
          room,
          publicBase,
          // A ringing personal cell is not an answer - don't suppress overflow
          // until it's actually picked up (the join webhook flips everHadAgent).
          countsAsAgent: false,
        }).catch(err => {
          console.error(`[Voice/LAML] originate cell failed user=${member.user_id} cell=${cell}:`, err);
          reportError(err as Error, {
            type: 'voice_originate_error',
            metadata: { source: 'inboundLaml.buildQueueTwiml', target: 'forward_cell', userId: member.user_id, room },
          });
        });
      };
      if (member.forward_calls_parallel) fire();
      else {
        const delayMs = Math.max(1, member.forward_after_seconds) * 1000;
        setTimeout(fire, delayMs);
      }
    }
  }

  // Ring desk phones in parallel (always reachable; no rotation).
  for (const dev of opts.deviceSipUris ?? []) {
    void originatePhoneIntoConference({
      fromNumber: opts.ctx.toNumber,
      toPhone: dev.sipUri,
      room,
      publicBase,
      // Ringing a desk phone is not an answer - don't suppress overflow until
      // the phone is actually picked up (the join webhook flips everHadAgent).
      countsAsAgent: false,
      deviceId: dev.deviceId,
    }).catch(err => {
      console.error(`[Voice/LAML] originate device failed sip=${dev.sipUri}:`, err);
      reportError(err as Error, {
        type: 'voice_originate_error',
        metadata: { source: 'inboundLaml.buildQueueTwiml', target: 'device', sipUri: dev.sipUri, room },
      });
    });
  }

  scheduleQueueOverflow(room, opts);

  // Multiple parallel dials feels like a queue (caller is parked while
  // several phones ring); a single dial feels like a direct call (caller
  // hears one phone ringing). Matches the heuristic in the SWML path.
  const waitAudioType: 'ringback' | 'queue-music' =
    toDial.length > 1 ? 'queue-music' : 'ringback';

  return twimlDoc(buildConferenceDial({
    room,
    recordHuman: opts.recordHuman,
    announceRecording: opts.announceRecording,
    publicBase,
    postConferenceCtx: { ctx: opts.ctx, overflowAction: opts.overflowAction },
    companyId: opts.ctx.companyId,
    waitAudioType,
  }));
}

async function pickMembersForStrategy(opts: QueueDispatchOpts): Promise<MemberWithForwarding[]> {
  if (opts.strategy === 'round_robin' && opts.members.length > 1) {
    // One at a time: the queue's ring_order decides who rings first.
    const ordered = await orderMembersOneAtATime(
      getSupabaseClient(),
      { queueId: opts.queueId, lastDialedIndex: opts.lastDialedIndex, fromNumber: opts.ctx.fromNumber },
      opts.members,
    );
    return [ordered[0]];
  }
  return opts.members;
}

function scheduleQueueOverflow(room: string, opts: QueueDispatchOpts): void {
  setTimeout(async () => {
    try {
      if (roomEverHadAgent(room)) return;
      const count = await countConferenceParticipants(room);
      if (count >= 2) return;
      console.warn(
        `[Voice/LAML] room=${room} no agent in ${opts.ringSeconds}s - overflow=${opts.overflowAction}`,
      );
      const publicBase = config.billingServerUrl;
      if (opts.overflowAction === 'retell') {
        // Self-hosted AI cannot be dialed INTO a conference (it is a media
        // stream on the caller's own leg, not a SIP endpoint). End the
        // conference instead; the <Dial> action URL (post-conference) then
        // hands the caller's leg to voice-rt.
        if ((await loadAiProviderForVoiceNumber(opts.ctx.voiceNumberId)) === 'pipecat') {
          await endConferenceRoom(room);
          return;
        }
        const target = await resolveQueueAiOverflowTarget(getSupabaseClient(), {
          queueId: opts.queueId,
          locationId: opts.ctx.locationId,
          fromNumber: opts.ctx.fromNumber,
          toNumber: opts.ctx.toNumber,
          retellClient,
        });
        if (target && publicBase) {
          await originatePhoneIntoConference({
            fromNumber: opts.ctx.toNumber,
            // cxmlOriginate accepts SIP URIs in the To param the same way as
            // E.164 - Twilio/SignalWire compat. So we can pass either.
            toPhone: target.kind === 'sip' ? target.uri : target.e164,
            room,
            publicBase,
          });
          return;
        }
      }
      // voicemail / hangup / retell-with-no-number: end the conference so
      // the customer's <Dial> returns. The post-conference action URL on
      // <Dial> decides whether to play voicemail or hang up based on
      // roomEverHadAgent (still false here, so voicemail wins when configured).
      await endConferenceRoom(room);
    } catch (err) {
      console.error(`[Voice/LAML] overflow timer failed room=${room}:`, err);
      reportError(err as Error, {
        type: 'voice_overflow_error',
        metadata: { source: 'inboundLaml.scheduleQueueOverflow', room, overflowAction: opts.overflowAction, note: 'caller may be stuck in empty conference' },
      });
    }
  }, opts.ringSeconds * 1000);
}

async function endConferenceRoom(room: string): Promise<void> {
  try {
    const sid = await findConferenceSid(room);
    if (!sid) return;
    await lamlEndConference(sid);
  } catch (err) {
    console.error(`[Voice/LAML] endConferenceRoom threw room=${room}:`, err);
    reportError(err as Error, {
      type: 'voice_conference_error',
      dedupe: 'silent',
      metadata: { source: 'inboundLaml.endConferenceRoom', room },
    });
  }
}

// ─── Overflow-only (no eligible members) ────────────────────────────────────

async function buildOverflowOnlyTwiml(opts: {
  ctx: LamlContext;
  recordHuman: boolean;
  announceRecording?: boolean;
  overflowAction: 'retell' | 'hangup' | 'voicemail';
  /** Optional - when set, the M3.5 per-queue ai_overflow_agent_id is
   *  consulted before falling back to the legacy retell_numbers lookup. */
  queueId?: string;
  /** Optional - when set, used directly as the dial destination for the
   *  Retell-overflow path, skipping the queueId/legacy lookups. Set by
   *  callers (like the IVR transfer_ai node) that have already resolved
   *  the right SIP URI or PSTN number for their context. */
  preferredAiAddress?: string | null;
  /** True when the caller was explicitly routed to the AI (an IVR transfer_ai
   *  node), as opposed to 'retell' being the implicit overflow default. Decides
   *  whether an unresolvable agent is a fault worth reporting. */
  aiExplicitlyRequested?: boolean;
}): Promise<string> {
  if (opts.overflowAction === 'hangup') {
    return twimlDoc(tHangup());
  }
  if (opts.overflowAction === 'voicemail') {
    return buildVoicemailTwiml(opts.ctx, 'queue_overflow');
  }

  // retell
  const publicBase = config.billingServerUrl;
  if (!publicBase) return twimlDoc(tHangup());
  const supabase = getSupabaseClient();

  // Self-hosted AI on this number: stream the caller's leg to voice-rt
  // directly (no conference, no SIP dial). Same gates + prompts as Retell via
  // resolveInboundCall; falls back to transfer/hangup on its own.
  if ((await loadAiProviderForVoiceNumber(opts.ctx.voiceNumberId)) === 'pipecat') {
    return pipecatAnswerTwiml(opts.ctx);
  }

  // Resolution order:
  //   1. preferredAiAddress (caller-supplied, e.g. IVR transfer_ai → number's own Retell SIP URI)
  //   2. M3.5 per-queue ai_overflow_agent_id (when queueId is provided)
  //   3. Legacy per-location retell_numbers lookup (grandfathered configs)
  let toAddress: string | null = opts.preferredAiAddress ?? null;
  if (!toAddress && opts.queueId) {
    const target = await resolveQueueAiOverflowTarget(supabase, {
      queueId: opts.queueId,
      locationId: opts.ctx.locationId,
      fromNumber: opts.ctx.fromNumber,
      toNumber: opts.ctx.toNumber,
      retellClient,
    });
    if (target) toAddress = target.kind === 'sip' ? target.uri : target.e164;
  }
  if (!toAddress) {
    toAddress = await lookupRetellOverflowNumber(supabase, opts.ctx.locationId);
  }
  if (!toAddress) {
    // overflow=retell but no AI agent/number resolved. Never hang up on the
    // caller: fall back to voicemail so the call is captured.
    //
    // 'retell' is the DEFAULT overflow, not a choice: it is the fallback when a
    // location has no queue at all (buildQueueRoutingTwiml) AND the column default
    // on call_queues.overflow_action. So for a location that never set up an AI
    // agent, landing here is the normal, intended outcome ("AI if there is one,
    // else voicemail"), and reporting it paged on every unanswered call to such a
    // location (alerts #2930, #3548). Report ONLY when an AI agent was actually
    // asked for and could not be reached, which is the real fault: an IVR
    // "transfer to AI" node, or a queue with an overflow agent assigned.
    let queueHasAgent = false;
    if (opts.queueId) {
      const { data: q } = await supabase
        .from('call_queues')
        .select('ai_overflow_agent_id')
        .eq('id', opts.queueId)
        .maybeSingle();
      queueHasAgent = !!q?.ai_overflow_agent_id;
    }
    if (opts.aiExplicitlyRequested || queueHasAgent) {
      reportError(new Error('overflow=retell but no AI agent/number resolvable - fell back to voicemail'), {
        type: 'voice_config_error',
        dedupe: 'silent',
        escalateAfter: 20,
        metadata: {
          source: 'inboundLaml.buildOverflowOnlyTwiml',
          locationId: opts.ctx.locationId,
          companyId: opts.ctx.companyId,
          queueId: opts.queueId,
          trigger: opts.aiExplicitlyRequested ? 'ivr_transfer_ai' : 'queue_overflow_agent',
        },
      });
    } else {
      console.warn(
        `[Voice/LAML] overflow default (AI) with no AI agent set up for location=${opts.ctx.locationId}; sending caller to voicemail.`,
      );
    }
    return buildVoicemailTwiml(opts.ctx, 'queue_overflow');
  }

  const room = `call_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  await persistConfRoom({
    callSid: opts.ctx.callSid,
    companyId: opts.ctx.companyId,
    voiceNumberId: opts.ctx.voiceNumberId,
    fromNumber: opts.ctx.fromNumber,
    toNumber: opts.ctx.toNumber,
    confRoom: room,
  });
  markCustomerJoined(room, undefined, opts.ctx.fromNumber);
  registerCustomerInboundCallId(room, opts.ctx.callSid, '');
  markCustomerLamlNamespace(room);
  registerCallHistoryContext(room, {
    providerCallSid: opts.ctx.callSid,
    fromNumber: opts.ctx.fromNumber,
    toNumber: opts.ctx.toNumber,
    companyId: opts.ctx.companyId,
    locationId: opts.ctx.locationId,
    voiceNumberId: opts.ctx.voiceNumberId,
  });

  void originatePhoneIntoConference({
    fromNumber: opts.ctx.toNumber,
    toPhone: toAddress,
    room,
    publicBase,
  }).catch((err) => reportError(err, { type: 'retell_originate_call_failed', metadata: { file: 'voice/inboundLaml.ts', call_sid: opts.ctx.callSid, from_number: opts.ctx.fromNumber, to_number: opts.ctx.toNumber, retell_target: toAddress } }));

  // Retell-only overflow: if retell hangs up without bridging back to a
  // human (and roomEverHadAgent still false, which it will be because the
  // retell originate uses originatePhoneIntoConference not the agent
  // tracker), the post-conference endpoint will fall back to voicemail
  // when configured. Treat the same as queue overflow=retell.
  return twimlDoc(buildConferenceDial({
    room,
    recordHuman: opts.recordHuman,
    announceRecording: opts.announceRecording,
    publicBase,
    postConferenceCtx: { ctx: opts.ctx, overflowAction: opts.overflowAction },
    companyId: opts.ctx.companyId,
    // Single retell originate is a direct route from the caller's perspective.
    waitAudioType: 'ringback',
  }));
}

// ─── Voicemail TwiML ────────────────────────────────────────────────────────

async function buildVoicemailTwiml(
  ctx: LamlContext,
  source: 'ivr' | 'queue_overflow',
  nodePromptUrl: string | null = null,
): Promise<string> {
  const publicBase = config.billingServerUrl || '';
  const cb = new URL(`${publicBase}/api/voice/laml/voicemail-callback`);
  cb.searchParams.set('voice_number_id', ctx.voiceNumberId);
  cb.searchParams.set('location_id', ctx.locationId);
  cb.searchParams.set('company_id', ctx.companyId);
  cb.searchParams.set('source', source);
  if (ctx.fromNumber) cb.searchParams.set('from', ctx.fromNumber);
  if (ctx.toNumber) cb.searchParams.set('to', ctx.toNumber);
  // SignalWire signs this URL as written but delivers it with the query sorted,
  // so it must be emitted sorted or its signature never verifies. See
  // signalWireCallbackQuery.
  cb.searchParams.sort();

  // recordingStatusCallback (not action) fires asynchronously after the
  // recording reaches the 'completed' state - including when the caller
  // hangs up instead of pressing #. action= would only fire on finishOnKey
  // or maxLength, losing hangup-terminated voicemails the same way the
  // pre-status_url SWML flow did. action="" with a Hangup after Record
  // prevents continuing the call after the recording finishes.
  const recordAttrs = attrs({
    maxLength: 120,
    finishOnKey: '#',
    playBeep: 'true',
    recordingStatusCallback: cb.toString(),
    recordingStatusCallbackEvent: 'completed',
    timeout: 5,
  });

  const resolved = await resolveVoicemailGreeting(getSupabaseClient(), {
    companyId: ctx.companyId,
    locationId: ctx.locationId,
    source,
    nodePromptUrl,
  });
  const greeting = resolved.url ? tPlay(resolved.url) : tSay(resolved.text);
  return twimlDoc(`${greeting}<Record${recordAttrs}/>${tHangup()}`);
}

// ─── IVR queue-leaf builder ─────────────────────────────────────────────────

async function buildQueueLeafTwiml(
  queueId: string,
  ctx: LamlContext,
  recordHuman: boolean,
  introUrl: string | null,
): Promise<string> {
  const supabase = getSupabaseClient();
  const { data: queue } = await supabase
    .from('call_queues')
    .select('id, strategy, ring_seconds, overflow_action, last_dialed_index')
    .eq('id', queueId)
    .maybeSingle();
  if (!queue) return twimlDoc(tHangup());

  const ringSeconds = queue.ring_seconds || config.signalwireVoiceRingSecondsDefault;
  const overflow: 'retell' | 'voicemail' | 'hangup' = queue.overflow_action || 'retell';
  const ninetySecondsAgo = new Date(Date.now() - 90_000).toISOString();
  // Recording-disclosure opt-in, resolved HERE (at the leaf) so the IVR-routed
  // queue path announces too - never rely on a caller to thread the flag.
  const announceRecording = recordHuman && (await getLocationRecordingConfig(ctx.locationId)).announce;

  const { data: m } = await supabase
    .from('call_queue_members')
    .select('user_id, priority, last_seen_at')
    .eq('queue_id', queue.id)
    // is_online AND fresh heartbeat (going offline refreshes last_seen_at).
    .eq('is_online', true)
    .gte('last_seen_at', ninetySecondsAgo)
    .order('priority');
  const baseMembers = (m || []).map(x => ({ user_id: x.user_id, priority: x.priority }));

  // Desk phones (always reachable). Resolved before the zero-users check so a
  // physical phone rings even when no softphone user is online.
  const deviceMembers = await resolveQueueDeviceMembers(supabase, queue.id);
  const deviceSipUris = deviceMembers.map(d => ({ sipUri: deviceSipUri(d.sip_username, getSipHost()), deviceId: d.device_id }));

  // Intro prompt plays before the conference dial. Both <Play> and <Dial>
  // run sequentially within the same TwiML response.
  const intro = introUrl ? tPlay(introUrl) : '';

  if (baseMembers.length === 0 && deviceSipUris.length === 0) {
    const overflowTwiml = await buildOverflowOnlyTwiml({ ctx, recordHuman, announceRecording, overflowAction: overflow, queueId: queue.id });
    // overflowTwiml is a full <Response>...</Response> doc; we need only
    // the inner contents to prepend the intro to.
    return intro
      ? twimlDoc(intro + stripResponseWrapper(overflowTwiml))
      : overflowTwiml;
  }

  const fwdMap = await loadForwardingByUser(baseMembers.map(mb => mb.user_id));
  const members: MemberWithForwarding[] = baseMembers.map(mb => {
    const f = fwdMap.get(mb.user_id);
    return {
      user_id: mb.user_id,
      priority: mb.priority,
      forward_calls_enabled: !!f?.enabled,
      forward_calls_to: f?.to ?? null,
      forward_after_seconds: f?.after ?? 15,
      forward_calls_parallel: !!f?.parallel,
    };
  });

  const queueTwiml = await buildQueueTwiml({
    ctx,
    members,
    deviceSipUris,
    strategy: queue.strategy === 'round_robin' ? 'round_robin' : 'ring_all',
    ringSeconds,
    recordHuman,
    announceRecording,
    overflowAction: overflow,
    queueId: queue.id,
    lastDialedIndex: queue.last_dialed_index ?? 0,
  });

  return intro ? twimlDoc(intro + stripResponseWrapper(queueTwiml)) : queueTwiml;
}

function stripResponseWrapper(doc: string): string {
  const start = doc.indexOf('<Response>');
  const end = doc.lastIndexOf('</Response>');
  if (start === -1 || end === -1) return '';
  return doc.slice(start + '<Response>'.length, end);
}

// ─── Call-path builder nodes: ring a specific user / forward to a number ─────

/**
 * Ring ONE specific user (their softphone + their own cell if forwarding is on),
 * for `ring_seconds`. On no-answer, continue the flow at `next_node_id` (or end
 * in voicemail when there's no next step). Built on the same conference
 * primitives the queue path uses, so a single user rings exactly like a
 * one-member queue and the post-conference action decides continue-vs-voicemail.
 */
async function buildRingUserTwiml(
  node: IVRRingUserNode,
  flow: IVRFlow,
  nodeId: string,
  ctx: LamlContext,
  recordHuman: boolean,
  hops: number,
): Promise<string> {
  const publicBase = config.billingServerUrl;
  if (!publicBase) return twimlDoc(tHangup());
  // Tenant guard at the point of effect. ivr_flows is client-writable under RLS
  // (company-scoped), so the save-time check in routes/ivr.ts can be bypassed;
  // never ring a user who isn't an active member of the number's company.
  let ringable = !!node.user_id;
  if (ringable) {
    const { data: target } = await getSupabaseClient()
      .from('users')
      .select('company_id, is_blocked')
      .eq('id', node.user_id)
      .maybeSingle();
    ringable = !!target && target.company_id === ctx.companyId && !target.is_blocked;
    if (!ringable) {
      reportError(new Error('IVR ring_user target is not an active member of the company'), {
        type: 'voice_ivr_misconfigured',
        metadata: { source: 'inboundLaml.buildRingUserTwiml', userId: node.user_id, companyId: ctx.companyId, flowId: flow.id, nodeId },
      });
    }
  }
  if (!ringable) {
    // Misconfigured node: no (valid) user chosen. Continue the flow if there's a
    // next step, else fall to the location's queue router rather than drop the call.
    if (node.next_node_id) return twimlDoc(tRedirect(ivrNodeUrl(flow.id, node.next_node_id, hops + 1, ctx.voiceNumberId)));
    return buildQueueRoutingTwiml(ctx, recordHuman);
  }

  const room = `call_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  await persistConfRoom({
    callSid: ctx.callSid,
    companyId: ctx.companyId,
    voiceNumberId: ctx.voiceNumberId,
    fromNumber: ctx.fromNumber,
    toNumber: ctx.toNumber,
    confRoom: room,
  });
  markCustomerJoined(room, undefined, ctx.fromNumber);
  registerCustomerInboundCallId(room, ctx.callSid, '');
  markCustomerLamlNamespace(room);
  registerCallHistoryContext(room, {
    providerCallSid: ctx.callSid,
    fromNumber: ctx.fromNumber,
    toNumber: ctx.toNumber,
    companyId: ctx.companyId,
    locationId: ctx.locationId,
    voiceNumberId: ctx.voiceNumberId,
  });

  // Ring the chosen user's softphone (and their cell if forwarding is on).
  void originateFabricUserIntoConference({
    fromNumber: ctx.toNumber,
    callerId: ctx.fromNumber,
    userId: node.user_id,
    room,
    publicBase,
  }).catch(err => {
    reportError(err as Error, {
      type: 'voice_originate_error',
      metadata: { source: 'inboundLaml.buildRingUserTwiml', userId: node.user_id, room },
    });
  });
  const fwd = (await loadForwardingByUser([node.user_id])).get(node.user_id);
  if (fwd?.enabled && fwd.to) {
    void originatePhoneIntoConference({
      fromNumber: ctx.toNumber, toPhone: fwd.to, room, publicBase, countsAsAgent: false,
    }).catch(err => reportError(err as Error, { type: 'voice_originate_error', metadata: { source: 'inboundLaml.buildRingUserTwiml.cell', userId: node.user_id, room } }));
  }

  const ringSeconds = Math.max(5, Math.min(120, node.ring_seconds ?? 20));
  // On no-answer: end the conference after ringSeconds so the <Dial> action
  // fires and the post-conference endpoint continues the flow (next_node) or
  // falls to voicemail when there's no next step.
  setTimeout(() => {
    void (async () => {
      try {
        if (roomEverHadAgent(room)) return;
        if ((await countConferenceParticipants(room)) >= 2) return;
        await endConferenceRoom(room);
      } catch { /* best-effort ring timeout */ }
    })();
  }, ringSeconds * 1000);

  const introUrl = await loadPromptUrl(node.prompt_before_id);
  const announceRecording = recordHuman && (await getLocationRecordingConfig(ctx.locationId)).announce;
  const dial = buildConferenceDial({
    room,
    recordHuman,
    announceRecording,
    publicBase,
    postConferenceCtx: {
      ctx,
      overflowAction: 'voicemail',
      cont: node.next_node_id ? { flowId: flow.id, nextNode: node.next_node_id, hops } : undefined,
    },
    companyId: ctx.companyId,
    waitAudioType: 'ringback',
  });
  const intro = introUrl ? tPlay(introUrl) : '';
  return intro ? twimlDoc(intro + stripResponseWrapper(twimlDoc(dial))) : twimlDoc(dial);
}

/**
 * Forward the call to an external phone number for `ring_seconds`. On no-answer,
 * continue the flow at `next_node_id` (or hang up when there's no next step).
 */
async function buildForwardNumberTwiml(
  node: IVRForwardNumberNode,
  flow: IVRFlow,
  nodeId: string,
  ctx: LamlContext,
  recordHuman: boolean,
  hops: number,
): Promise<string> {
  const raw = (node.forward_number || '').replace(/[^\d+]/g, '');
  if (!raw) {
    // Misconfigured (no number): treat exactly like an unanswered forward.
    return continueAfterForward(flow, nodeId, ctx, recordHuman, hops, 'failed');
  }
  const dest = raw.startsWith('+') ? raw : `+${raw}`;
  const timeout = Math.max(5, Math.min(120, node.ring_seconds ?? 25));
  // <Dial action> fires on EVERY dial outcome, including an answered call that
  // later ended. Route it back to THIS node with after=forward so
  // continueAfterForward can tell "answered" (hang up) from "not answered"
  // (next step, else voicemail).
  const actionUrl = `${ivrNodeUrl(flow.id, nodeId, hops, ctx.voiceNumberId)}&after=forward`;
  const dialAttrs = attrs({ callerId: ctx.fromNumber, timeout, action: actionUrl, method: 'POST' });
  return twimlDoc(`<Dial${dialAttrs}>${xmlEscape(dest)}</Dial>`);
}

/**
 * Runs when a forward_number <Dial> ends. Answered ("completed") means the call
 * happened, so just end it. Anything else (no-answer / busy / failed / canceled)
 * continues to the node's "If no answer" step, or voicemail when there is none,
 * matching ring_user so an unanswered forward never drops the caller.
 */
async function continueAfterForward(
  flow: IVRFlow,
  nodeId: string,
  ctx: LamlContext,
  recordHuman: boolean,
  hops: number,
  dialStatus: string,
): Promise<string> {
  if (dialStatus === 'completed') return twimlDoc(tHangup());
  const node = flow.nodes[nodeId];
  const next = node?.type === 'forward_number' ? node.next_node_id : undefined;
  if (next) return renderIvrNode(flow, next, ctx, recordHuman, hops + 1);
  return buildVoicemailTwiml(ctx, 'ivr');
}

// ─── IVR node renderer ──────────────────────────────────────────────────────

async function renderIvrNode(
  flow: IVRFlow,
  nodeId: string,
  ctx: LamlContext,
  recordHuman: boolean,
  hops = 0,
): Promise<string> {
  // Cycle / runaway guard: a cyclic flow graph would <Redirect> forever.
  if (hops > MAX_IVR_HOPS) {
    console.warn(`[Voice/LAML] IVR hop limit hit flow=${flow.id} node=${nodeId} hops=${hops} - hanging up`);
    reportError(new Error('IVR flow exceeded max hops - likely a cycle; caller hung up'), {
      type: 'voice_config_error',
      metadata: { source: 'inboundLaml.renderIvrNode', flowId: flow.id, nodeId, hops, companyId: ctx.companyId },
    });
    return twimlDoc(tHangup());
  }

  const node = flow.nodes[nodeId];
  if (!node) return twimlDoc(tHangup());

  if (node.type === 'hangup') {
    return twimlDoc(tHangup());
  }

  if (node.type === 'play') {
    const url = await loadPromptUrl(node.prompt_id);
    const playFrag = url ? tPlay(url) : '';
    if (node.next_node_id) {
      const nextUrl = ivrNodeUrl(flow.id, node.next_node_id, hops + 1, ctx.voiceNumberId);
      return twimlDoc(playFrag + tRedirect(nextUrl));
    }
    return twimlDoc(playFrag + tHangup());
  }

  if (node.type === 'voicemail') {
    return buildVoicemailTwiml(ctx, 'ivr', await loadPromptUrl(node.prompt_id));
  }

  if (node.type === 'transfer_ai') {
    // Prefer the voice number's own Retell binding (modern path). When the
    // number has `ai_provider='retell'`, Retell has an agent registered for
    // its E.164 via /import-phone-number, so dialing the corresponding SIP
    // URI reaches that agent. Falls through to buildOverflowOnlyTwiml's
    // legacy retell_numbers lookup when not configured.
    let preferredAiAddress: string | null = null;
    const supabase = getSupabaseClient();
    const { data: vn } = await supabase
      .from('voice_numbers')
      .select('ai_provider, ai_active, company_id, location_id')
      .eq('id', ctx.voiceNumberId)
      .maybeSingle();
    // `ai_active === false` means credit suspension turned this agent off.
    // Dialing the Retell SIP URI is billable on connect, so a suspended number
    // must not be offered here either; leaving preferredAiAddress null falls
    // through to the legacy overflow lookup (a real human), which is the right
    // answer for a caller who explicitly asked for the agent.
    const vnRow = vn as { ai_provider?: string | null; ai_active?: boolean | null; company_id?: string | null; location_id?: string | null } | null;
    // Per-company cutover: a flagged company's "talk to the AI" goes self-hosted
    // regardless of the stored provider (the ONE routing decision). Fails safe.
    let flaggedSelfHosted = false;
    try {
      flaggedSelfHosted = vnRow?.ai_active !== false && (await shouldUseSelfHosted(vnRow?.company_id ?? null, vnRow?.location_id ?? null));
    } catch { /* keep stored provider */ }
    if (flaggedSelfHosted || (vnRow?.ai_provider === 'pipecat' && vnRow?.ai_active !== false)) {
      // "Press 1 for the AI agent" on a self-hosted number: hand this leg to
      // voice-rt right here (the IVR's <Redirect> chain ends in the stream).
      return pipecatAnswerTwiml(ctx);
    }
    if (vnRow?.ai_provider === 'retell' && vnRow?.ai_active !== false) {
      const { getRetellInboundSipUri } = await import('./providers/aiForward.js');
      preferredAiAddress = getRetellInboundSipUri(ctx.toNumber);
    }
    const announceRecording = recordHuman && (await getLocationRecordingConfig(ctx.locationId)).announce;
    return buildOverflowOnlyTwiml({
      ctx,
      recordHuman,
      announceRecording,
      overflowAction: 'retell',
      preferredAiAddress,
      aiExplicitlyRequested: true,
    });
  }

  if (node.type === 'queue') {
    const introUrl = await loadPromptUrl(node.prompt_before_id);
    return buildQueueLeafTwiml(node.queue_id, ctx, recordHuman, introUrl);
  }

  if (node.type === 'schedule') {
    // Day/night split off the LOCATION hours. Primary source is the booking
    // schedule (schedule_for_location.day_and_time), same as the queue path's
    // default. If that's empty, fall back to the classic location_business_hours
    // so a location whose hours live there still splits correctly. If BOTH are
    // empty we can't know the hours - default to OPEN (ringing the team / the
    // open path is far safer than silently sending every caller to the closed
    // path 24/7) and flag the misconfig so it gets fixed.
    const supabase = getSupabaseClient();
    const [{ data: sched }, { data: loc }, { data: bizHours }] = await Promise.all([
      supabase.from('schedule_for_location').select('day_and_time').eq('location_id', ctx.locationId).maybeSingle(),
      supabase.from('locations').select('timezone').eq('id', ctx.locationId).maybeSingle(),
      supabase.from('location_business_hours').select('day_of_week, open_time, close_time, is_closed, timezone').eq('location_id', ctx.locationId).order('day_of_week'),
    ]);
    const dayAndTime = (sched?.day_and_time as Record<string, string> | null) || null;
    const tz = (loc as { timezone?: string } | null)?.timezone || 'America/New_York';
    const hoursRows = (bizHours as Array<{ day_of_week: number; open_time: string; close_time: string; is_closed: boolean; timezone: string }> | null) || [];
    const hasBookingSchedule = !!dayAndTime && Object.keys(dayAndTime).length > 0;

    let openNow: boolean;
    if (hasBookingSchedule) {
      openNow = isOpenNowFromSchedule(dayAndTime, tz);
    } else if (hoursRows.length > 0) {
      openNow = isOpenNow(hoursRows);
    } else {
      // No hours configured anywhere: default OPEN, and surface the misconfig.
      openNow = true;
      reportError(new Error('Schedule node ran with no hours configured (empty booking schedule AND no business hours); defaulting to OPEN'), {
        type: 'voice_config_error',
        dedupe: 'silent',
        escalateAfter: 20,
        metadata: { source: 'inboundLaml.renderIvrNode.schedule', flowId: flow.id, nodeId, locationId: ctx.locationId, companyId: ctx.companyId },
      });
    }

    const target = openNow ? node.open_target : node.closed_target;
    if (target) return twimlDoc(tRedirect(ivrNodeUrl(flow.id, target, hops + 1, ctx.voiceNumberId)));
    // No branch configured for this side: fall back to the location's queue router.
    return buildQueueRoutingTwiml(ctx, recordHuman);
  }

  if (node.type === 'ring_user') {
    return buildRingUserTwiml(node, flow, nodeId, ctx, recordHuman, hops);
  }

  if (node.type === 'goto_menu') {
    // Same company AND same location as the CALLED number: menus are location-
    // separated, and the save-time check can be bypassed (ivr_flows is client-
    // writable under RLS), so re-check at the point of effect.
    const target = node.flow_id ? await loadActiveFlow(node.flow_id) : null;
    if (!target || target.company_id !== ctx.companyId || target.location_id !== ctx.locationId || !target.root_node_id) {
      reportError(new Error('IVR goto_menu target is missing, turned off, or at another location'), {
        type: 'voice_ivr_misconfigured',
        metadata: { source: 'inboundLaml.renderIvrNode.goto_menu', flowId: flow.id, nodeId, targetFlowId: node.flow_id, companyId: ctx.companyId },
      });
      return buildQueueRoutingTwiml(ctx, recordHuman);
    }
    return renderIvrNode(target, target.root_node_id, ctx, recordHuman, hops + 1);
  }

  if (node.type === 'forward_number') {
    return buildForwardNumberTwiml(node, flow, nodeId, ctx, recordHuman, hops);
  }

  if (node.type === 'menu') {
    const url = await loadPromptUrl(node.prompt_id);
    const maxDigits = node.max_digits ?? 1;
    const timeoutSec = Math.max(2, Math.round((node.timeout_ms ?? 5000) / 1000));

    const { branches, defaultTarget } = normalizeBranches(node);
    const hasVoiceBranch = branches.some(b => !!b.voice);
    const hasDigitBranch = branches.some(b => !!b.digit);
    // Carry the running hop count into the gather (caller input advances one
    // hop) so a menu that loops back to itself can't redirect forever.
    const gatherUrl = ivrGatherUrl(flow.id, nodeId, hops + 1, ctx.voiceNumberId);
    const inputs =
      hasDigitBranch && hasVoiceBranch
        ? 'dtmf speech'
        : hasVoiceBranch
          ? 'speech'
          : 'dtmf';
    const gatherAttrs = attrs({
      action: gatherUrl,
      method: 'POST',
      input: inputs,
      numDigits: maxDigits,
      timeout: timeoutSec,
      finishOnKey: '#',
      speechTimeout: hasVoiceBranch ? String(timeoutSec) : undefined,
      language: hasVoiceBranch ? 'en-US' : undefined,
    });
    const inner = url ? tPlay(url) : '';

    // If the caller times out without input, Twilio falls through past
    // <Gather> to the next verb. Hang up by default - but if a default
    // target is defined, redirect to that node instead.
    const fallthrough = defaultTarget
      ? tRedirect(ivrNodeUrl(flow.id, defaultTarget, hops + 1, ctx.voiceNumberId))
      : tHangup();

    return twimlDoc(`<Gather${gatherAttrs}>${inner}</Gather>${fallthrough}`);
  }

  return twimlDoc(tHangup());
}

// Max IVR hops before we abort. A misconfigured flow (a play->play cycle, or a
// menu default_target that points back up the chain) would otherwise <Redirect>
// forever, stranding the caller and billing the whole time. The runtime walker
// has no visited-set (each hop is a fresh stateless HTTP request), so we carry a
// hop counter in the redirect URL and hang up + alert once it's exceeded. A real
// flow is never more than a few nodes deep; 25 is far above any legitimate depth.
const MAX_IVR_HOPS = 25;

// `vn` is the CALLED number. A menu can answer several numbers (and callers can
// be handed between menus), so the call context must come from the call, never
// from the menu row. See resolveIvrCallContext.
/**
 * Call context for an /laml/ivr-node or /laml/ivr-gather hop. Comes from the
 * CALLED number carried in the URL (`vn`), verified to belong to the menu's
 * company. Fallbacks for calls that started on older code (no `vn` in the URL):
 * the menu's legacy voice_number_id, then any number that answers with this menu.
 */
async function resolveIvrCallContext(
  flow: IVRFlow,
  vnParam: string,
  callSid: string,
  from: string,
  to: string,
): Promise<LamlContext | null> {
  const supabase = getSupabaseClient();
  let vnId = vnParam || flow.voice_number_id || '';
  if (!vnId) {
    const { data: any1 } = await supabase
      .from('voice_numbers')
      .select('id')
      .eq('ivr_flow_id', flow.id)
      .limit(1)
      .maybeSingle();
    vnId = (any1?.id as string | undefined) ?? '';
  }
  if (!vnId) return null;
  const { data: vn } = await supabase
    .from('voice_numbers')
    .select('id, company_id, location_id')
    .eq('id', vnId)
    .maybeSingle();
  if (!vn || vn.company_id !== flow.company_id) return null;
  return {
    callSid,
    voiceNumberId: vn.id,
    locationId: vn.location_id,
    companyId: vn.company_id,
    fromNumber: from,
    toNumber: to,
  };
}

function ivrNodeUrl(flowId: string, nodeId: string, hops: number, voiceNumberId: string): string {
  const base = config.billingServerUrl || '';
  const qs = new URLSearchParams({ flow: flowId, node: nodeId, hops: String(hops), vn: voiceNumberId });
  return `${base}/api/voice/laml/ivr-node?${qs.toString()}`;
}

function ivrGatherUrl(flowId: string, nodeId: string, hops: number, voiceNumberId: string): string {
  const base = config.billingServerUrl || '';
  const qs = new URLSearchParams({ flow: flowId, node: nodeId, hops: String(hops), vn: voiceNumberId });
  return `${base}/api/voice/laml/ivr-gather?${qs.toString()}`;
}

// ─── Top-level routing (mirrors webhooks.ts buildVoiceSWML/buildQueueRoutingSWML) ─

async function buildInboundTwiml(
  toDigits: string,
  fromNumber: string,
  callSid: string,
): Promise<string> {
  const supabase = getSupabaseClient();

  // 1. Match voice_numbers by `to` digits (with and without leading +).
  // ai_* columns are included so an AI-enabled number can short-circuit the
  // queue path when no IVR is configured (see step 3 below). When BOTH an
  // IVR and AI are wired up on the same number, the IVR runs first and its
  // transfer_ai node forwards to the same Retell SIP URI we'd dial here.
  let { data: voiceNum } = await supabase
    .from('voice_numbers')
    .select('id, company_id, location_id, ivr_flow_id, ai_provider, ai_sip_termination_uri, ai_active')
    .eq('phone_number', `+${toDigits}`)
    .eq('is_active', true)
    .maybeSingle();
  if (!voiceNum) {
    const alt = await supabase
      .from('voice_numbers')
      .select('id, company_id, location_id, ivr_flow_id, ai_provider, ai_sip_termination_uri, ai_active')
      .eq('phone_number', toDigits)
      .eq('is_active', true)
      .maybeSingle();
    voiceNum = alt.data;
  }

  if (!voiceNum?.location_id) {
    // Marketing v2: if the dialed number is an SMS number, forward to the
    // location's main phone. `forward_to_location_id` is the explicit override
    // (set at purchase time, editable per number); falls back to the owning
    // `location_id` if not set. Same <Dial> shape as the communication_map
    // path below - we just resolve the destination from sms_numbers first.
    const { data: smsNum } = await supabase
      .from('sms_numbers')
      .select('forward_to_location_id, location_id')
      .or(`phone_number.eq.+${toDigits},phone_number.eq.${toDigits}`)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    const smsForwardLocationId = smsNum?.forward_to_location_id ?? smsNum?.location_id ?? null;
    if (smsForwardLocationId) {
      // Business phone, else the location's own voice number.
      const target = await resolveSmsCallForwardTarget(supabase, smsForwardLocationId, toDigits);
      if (target) {
        return twimlDoc(
          `<Dial${attrs({ callerId: fromNumber, timeout: 30 })}>${xmlEscape(target.to)}</Dial>${tHangup()}`,
        );
      }
    }

    // Legacy fallback: SMS-number call-forward (mirrors webhooks.ts). For
    // LAML we forward via <Dial>. No active filter and no channel_disabled
    // filter: forwarding to the merchant's own phone is inbound capture;
    // neither the AI Agent toggle nor the emergency shut-off should drop a
    // live customer call that can reach the merchant directly.
    const { data: smsMapping, error: smsMapErr } = await supabase
      .from('communication_map')
      .select('location_id')
      .eq('communication_value', toDigits)
      .eq('is_deleted', false)
      .not('connected_to_sms_number_id', 'is', null)
      // Shared channel: calls to a shared number forward to the HOME location.
      .order('is_home', { ascending: false })
      .order('active', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (smsMapErr) {
      // A failed lookup here means a live customer call falls through to
      // hangup - that's a real incident, not a benign miss.
      reportError(smsMapErr as unknown as Error, {
        type: 'call_forward_lookup_failed',
        metadata: { source: 'inboundLaml.legacySmsForward', to: toDigits },
      });
    }
    if (smsMapping?.location_id) {
      const target = await resolveSmsCallForwardTarget(supabase, smsMapping.location_id, toDigits);
      if (target) {
        return twimlDoc(
          `<Dial${attrs({ callerId: fromNumber, timeout: 30 })}>${xmlEscape(target.to)}</Dial>${tHangup()}`,
        );
      }
    }
    console.warn(`[Voice/LAML] no route for to=${toDigits}`);
    return twimlDoc(tHangup());
  }

  const ctx: LamlContext = {
    callSid,
    voiceNumberId: voiceNum.id,
    locationId: voiceNum.location_id,
    companyId: voiceNum.company_id,
    fromNumber,
    toNumber: `+${toDigits}`,
  };

  const recordingConfig = await getLocationRecordingConfig(ctx.locationId);
  const recordHuman = shouldRecordHuman(recordingConfig.mode);
  const announceRecording = recordHuman && recordingConfig.announce;

  // 2. IVR first. A configured menu always takes priority - its transfer_ai
  // node knows how to dial Retell, so "press 1 for AI agent" works on a
  // number that also has AI enabled.
  if (voiceNum.ivr_flow_id) {
    const flow = await loadActiveFlow(voiceNum.ivr_flow_id);
    if (flow && flow.root_node_id) {
      return renderIvrNode(flow, flow.root_node_id, ctx, recordHuman);
    }
  }

  // 3. AI short-circuit. When ai_provider='retell' and no IVR is configured,
  // forward straight to Retell's inbound SIP trunk. Retell uses the dialed
  // E.164 (userinfo) to match the inbound agent it has on file.
  //
  // Gated on `ai_active`: credit suspension flips it false, and the SIP dial
  // below is billable the moment it connects. Deciding "AI can't answer"
  // only inside Retell's webhook (which runs AFTER the leg is up) would mean
  // paying for every call to a suspended number. Falling through routes the
  // caller onward to queue/voicemail instead, so nobody is dropped.
  // `!== false` so a legacy NULL row keeps its current behavior.
  if ((voiceNum.ai_provider === 'retell' || voiceNum.ai_provider === 'pipecat') && voiceNum.ai_active === false) {
    console.warn(
      `[Voice/LAML] AI suspended (ai_active=false) to=+${toDigits} - skipping AI dispatch.`,
    );
  }
  // 3a. Self-hosted AI short-circuit: same gates as Retell (resolveInboundCall),
  // then `<Connect><Stream>` the caller's leg to voice-rt. The Stream verb is
  // the reason the self-hosted agent requires the LaML inbound path.
  if (voiceNum.ai_provider === 'pipecat' && voiceNum.ai_active !== false) {
    console.log(`[Voice/LAML] AI dispatch (self-hosted) to=+${toDigits}`);
    return pipecatAnswerTwiml(ctx);
  }
  if (voiceNum.ai_provider === 'retell' && voiceNum.ai_active !== false) {
    const { getRetellInboundSipUri } = await import('./providers/aiForward.js');
    const sipUri = getRetellInboundSipUri(`+${toDigits}`);
    console.log(`[Voice/LAML] AI dispatch to=${`+${toDigits}`} sip=${sipUri}`);
    const actionUrl =
      `${config.billingServerUrl}/api/voice/laml/ai-dispatch-result?` +
      new URLSearchParams({
        call_sid: callSid,
        from: fromNumber,
        to: `+${toDigits}`,
        voice_number_id: voiceNum.id,
        company_id: voiceNum.company_id,
        location_id: voiceNum.location_id || '',
        sip_uri: sipUri,
      }).toString();
    const dialAttrs = attrs({
      callerId: fromNumber,
      timeout: 30,
      action: actionUrl,
      method: 'POST',
    });
    return twimlDoc(
      `<Dial${dialAttrs}><Sip>${xmlEscape(sipUri)}</Sip></Dial>${tHangup()}`,
    );
  }

  return buildQueueRoutingTwiml(ctx, recordHuman, announceRecording);
}

async function buildQueueRoutingTwiml(
  ctx: LamlContext,
  recordHuman: boolean,
  announceRecording = false,
): Promise<string> {
  const supabase = getSupabaseClient();

  const queueQuery = supabase
    .from('call_queues')
    .select('id, strategy, ring_seconds, overflow_action, last_dialed_index, use_location_hours, is_default')
    .eq('location_id', ctx.locationId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(1);

  const [hoursRes, queueRes, scheduleRes, locationRes] = await Promise.all([
    supabase
      .from('location_business_hours')
      .select('day_of_week, open_time, close_time, is_closed, timezone')
      .eq('location_id', ctx.locationId)
      .order('day_of_week'),
    queueQuery.maybeSingle(),
    supabase
      .from('schedule_for_location')
      .select('day_and_time')
      .eq('location_id', ctx.locationId)
      .maybeSingle(),
    supabase
      .from('locations')
      .select('timezone')
      .eq('id', ctx.locationId)
      .maybeSingle(),
  ]);

  const hoursRows = hoursRes.data || [];
  const queue = queueRes.data;
  const dayAndTime = (scheduleRes.data?.day_and_time as Record<string, string> | null) || null;
  const locationTz = locationRes.data?.timezone || 'America/New_York';

  const overflow: 'retell' | 'voicemail' | 'hangup' = queue?.overflow_action || 'retell';
  const ringSeconds = queue?.ring_seconds || config.signalwireVoiceRingSecondsDefault;
  const useLocationHours = queue?.use_location_hours ?? true;
  const openNow = useLocationHours
    ? isOpenNowFromSchedule(dayAndTime, locationTz)
    : isOpenNow(hoursRows);

  let members: MemberWithForwarding[] = [];
  if (queue) {
    const ninetySecondsAgo = new Date(Date.now() - 90_000).toISOString();
    const { data: m } = await supabase
      .from('call_queue_members')
      .select('user_id, priority, last_seen_at, override_until')
      .eq('queue_id', queue.id)
      // is_online AND fresh heartbeat (going offline refreshes last_seen_at).
      .eq('is_online', true)
      .gte('last_seen_at', ninetySecondsAgo)
      .order('priority');
    const nowIso = new Date().toISOString();
    const rows = m || [];
    const filtered = openNow ? rows : rows.filter(x => x.override_until && x.override_until > nowIso);
    if (filtered.length > 0) {
      const fwdMap = await loadForwardingByUser(filtered.map(x => x.user_id));
      members = filtered.map(x => {
        const f = fwdMap.get(x.user_id);
        return {
          user_id: x.user_id,
          priority: x.priority,
          forward_calls_enabled: !!f?.enabled,
          forward_calls_to: f?.to ?? null,
          forward_after_seconds: f?.after ?? 15,
          forward_calls_parallel: !!f?.parallel,
        };
      });
    }
  }

  // Desk phones (always reachable; ring even with no online softphone users).
  const deviceSipUris = queue
    ? (await resolveQueueDeviceMembers(supabase, queue.id)).map(d => ({ sipUri: deviceSipUri(d.sip_username, getSipHost()), deviceId: d.device_id }))
    : [];

  if (queue && (members.length > 0 || deviceSipUris.length > 0)) {
    return buildQueueTwiml({
      ctx,
      members,
      deviceSipUris,
      strategy: queue.strategy === 'round_robin' ? 'round_robin' : 'ring_all',
      ringSeconds,
      recordHuman,
      announceRecording,
      overflowAction: overflow,
      queueId: queue.id,
      lastDialedIndex: queue.last_dialed_index ?? 0,
    });
  }

  return buildOverflowOnlyTwiml({
    ctx,
    recordHuman,
    announceRecording,
    overflowAction: overflow,
    queueId: queue?.id,
  });
}

// ─── Express routes ────────────────────────────────────────────────────────

export const lamlInboundRouter = Router();

/**
 * POST /api/voice/inbound-laml
 *
 * SignalWire's LAML webhook posts standard Twilio-style form params:
 *   CallSid, From, To, Direction, AccountSid, ApiVersion, ...
 *
 * We return TwiML XML. SignalWire fetches additional URLs (Gather action,
 * Redirect, Record recordingStatusCallback) as the call proceeds.
 */
lamlInboundRouter.post('/inbound-laml', async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const callSid = String(body.CallSid || '');
  const from = String(body.From || '');
  const to = String(body.To || '');
  const toDigits = to.replace(/^\+/, '');
  console.log(`[Voice/LAML] /inbound-laml from=${from} to=${to} callSid=${callSid}`);

  try {
    const twiml = await buildInboundTwiml(toDigits, from, callSid);
    sendTwiml(res, twiml);
  } catch (err) {
    console.error('[Voice/LAML] /inbound-laml error:', err);
    reportError(err as Error, {
      type: 'voice_inbound_webhook_error',
      metadata: { source: 'inboundLaml./inbound-laml', note: 'caller was hung up on', from, to, callSid },
    });
    sendTwiml(res, twimlDoc(tHangup()));
  }
});

/**
 * POST /api/voice/laml/ivr-node?flow=&node=
 *
 * Renders a single IVR node. Used for <Redirect> targets between play / queue
 * / voicemail / transfer_ai nodes inside an IVR flow.
 */
lamlInboundRouter.post('/laml/ivr-node', async (req: Request, res: Response) => {
  try {
    const flowId = String(req.query.flow || '');
    const nodeId = String(req.query.node || '');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const callSid = String(body.CallSid || '');
    const from = String(body.From || '');
    const to = String(body.To || '');
    if (!flowId || !nodeId) {
      sendTwiml(res, twimlDoc(tHangup()));
      return;
    }
    const flow = await loadActiveFlow(flowId);
    if (!flow) {
      sendTwiml(res, twimlDoc(tHangup()));
      return;
    }
    const ctx = await resolveIvrCallContext(flow, String(req.query.vn || ''), callSid, from, to);
    if (!ctx) {
      reportError(new Error('IVR hop could not resolve the called number'), {
        type: 'voice_ivr_error',
        metadata: { source: 'inboundLaml.resolveIvrCallContext', note: 'caller was hung up on mid-IVR', flow: flow.id, vn: String(req.query.vn || '') },
      });
      sendTwiml(res, twimlDoc(tHangup()));
      return;
    }
    const recordHuman = shouldRecordHuman(await getLocationRecordingMode(ctx.locationId));
    const hops = parseInt(String(req.query.hops || '0'), 10) || 0;
    if (req.query.after === 'forward') {
      sendTwiml(res, await continueAfterForward(flow, nodeId, ctx, recordHuman, hops, String(body.DialCallStatus || '')));
      return;
    }
    sendTwiml(res, await renderIvrNode(flow, nodeId, ctx, recordHuman, hops));
  } catch (err) {
    console.error('[Voice/LAML] /laml/ivr-node error:', err);
    reportError(err as Error, {
      type: 'voice_ivr_error',
      metadata: { source: 'inboundLaml./laml/ivr-node', note: 'caller was hung up on mid-IVR', flow: String(req.query.flow || ''), node: String(req.query.node || '') },
    });
    sendTwiml(res, twimlDoc(tHangup()));
  }
});

/**
 * POST /api/voice/laml/ivr-gather?flow=&node=
 *
 * <Gather action= /> target. Body carries Digits (DTMF) and/or SpeechResult
 * (transcript). We dispatch to the matching branch and either render the
 * target node inline (for fast paths) or redirect to it.
 */
lamlInboundRouter.post('/laml/ivr-gather', async (req: Request, res: Response) => {
  try {
    const flowId = String(req.query.flow || '');
    const nodeId = String(req.query.node || '');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const callSid = String(body.CallSid || '');
    const from = String(body.From || '');
    const to = String(body.To || '');
    const digits = String(body.Digits || '');
    const speech = String(body.SpeechResult || '').toLowerCase();
    if (!flowId || !nodeId) {
      sendTwiml(res, twimlDoc(tHangup()));
      return;
    }
    const flow = await loadActiveFlow(flowId);
    if (!flow) {
      sendTwiml(res, twimlDoc(tHangup()));
      return;
    }
    const node = flow.nodes[nodeId];
    if (!node || node.type !== 'menu') {
      sendTwiml(res, twimlDoc(tHangup()));
      return;
    }

    // Resolve which branch the caller picked. A branch can be matched by
    // its digit, its voice keyword, or either of the two.
    const { branches, defaultTarget } = normalizeBranches(node);
    let targetNodeId: string | null = null;
    if (digits) {
      const match = branches.find((b) => b.digit === digits);
      if (match) targetNodeId = match.target;
    }
    if (!targetNodeId && speech) {
      const match = branches.find((b) => b.voice && speech.includes(b.voice));
      if (match) targetNodeId = match.target;
    }
    if (!targetNodeId && defaultTarget) {
      targetNodeId = defaultTarget;
    }
    if (!targetNodeId) {
      sendTwiml(res, twimlDoc(tHangup()));
      return;
    }

    const ctx = await resolveIvrCallContext(flow, String(req.query.vn || ''), callSid, from, to);
    if (!ctx) {
      reportError(new Error('IVR hop could not resolve the called number'), {
        type: 'voice_ivr_error',
        metadata: { source: 'inboundLaml.resolveIvrCallContext', note: 'caller was hung up on mid-IVR', flow: flow.id, vn: String(req.query.vn || '') },
      });
      sendTwiml(res, twimlDoc(tHangup()));
      return;
    }
    const recordHuman = shouldRecordHuman(await getLocationRecordingMode(ctx.locationId));
    const hops = parseInt(String(req.query.hops || '0'), 10) || 0;
    sendTwiml(res, await renderIvrNode(flow, targetNodeId, ctx, recordHuman, hops));
  } catch (err) {
    console.error('[Voice/LAML] /laml/ivr-gather error:', err);
    reportError(err as Error, {
      type: 'voice_ivr_error',
      metadata: { source: 'inboundLaml./laml/ivr-gather', note: 'caller was hung up on mid-IVR', flow: String(req.query.flow || ''), node: String(req.query.node || '') },
    });
    sendTwiml(res, twimlDoc(tHangup()));
  }
});

/**
 * POST /api/voice/laml/post-conference
 *
 * Fired when the customer's <Dial><Conference> returns. The `room` query
 * param identifies the conference; we check whether any agent ever joined
 * (via roomEverHadAgent) and either:
 *   - send the caller to voicemail (overflow=voicemail AND no agent ever
 *     joined, i.e. ringout)
 *   - hang up (everything else - successful conversation, or
 *     overflow != voicemail)
 *
 * Without this endpoint we couldn't distinguish "rang out, send to
 * voicemail" from "real conversation just ended, drop the call" - both
 * cases hit the same point in TwiML execution.
 */
lamlInboundRouter.post('/laml/post-conference', async (req: Request, res: Response) => {
  try {
    const room = String(req.query.room || '');
    const overflow = String(req.query.overflow || 'hangup') as 'retell' | 'voicemail' | 'hangup';

    // Pull DialCallStatus to log; it's informational only. The branching
    // decision uses roomEverHadAgent because conference ends are
    // intentional (our grace timer), not Twilio's notion of dial failure.
    const body = (req.body ?? {}) as Record<string, unknown>;
    const dialStatus = String(body.DialCallStatus || '');
    const hadAgent = roomEverHadAgent(room);
    console.log(
      `[Voice/LAML] /laml/post-conference room=${room} overflow=${overflow} ` +
      `dialStatus=${dialStatus} hadAgent=${hadAgent}`,
    );

    // Call-path builder: a ring step (ring_user / forward_number / a ring stage
    // with a configured "then") passes next_node + flow. On no-answer, continue
    // the flow at that node instead of terminating. hadAgent means somebody
    // actually picked up, so there's nothing to continue to.
    const nextNode = String(req.query.next_node || '');
    const flowId = String(req.query.flow || '');
    if (nextNode && flowId && !hadAgent) {
      const hopsN = parseInt(String(req.query.hops || '0'), 10) || 0;
      sendTwiml(res, twimlDoc(tRedirect(ivrNodeUrl(flowId, nextNode, hopsN + 1, String(req.query.voice_number_id || '')))));
      return;
    }

    if (overflow === 'voicemail' && !hadAgent) {
      const ctx: LamlContext = {
        callSid: String(req.query.call_sid || body.CallSid || ''),
        voiceNumberId: String(req.query.voice_number_id || ''),
        locationId: String(req.query.location_id || ''),
        companyId: String(req.query.company_id || ''),
        fromNumber: String(req.query.from || body.From || ''),
        toNumber: String(req.query.to || body.To || ''),
      };
      sendTwiml(res, await buildVoicemailTwiml(ctx, 'queue_overflow'));
      return;
    }

    // Rang out with overflow=AI on a SELF-HOSTED number: scheduleQueueOverflow
    // ended the conference on purpose so this action fires; now hand the
    // caller's leg to voice-rt. (Retell overflow is dialed INTO the conference
    // instead and never reaches this branch with hadAgent=false.)
    if (overflow === 'retell' && !hadAgent) {
      const voiceNumberId = String(req.query.voice_number_id || '');
      if (voiceNumberId && (await loadAiProviderForVoiceNumber(voiceNumberId)) === 'pipecat') {
        const ctx: LamlContext = {
          callSid: String(req.query.call_sid || body.CallSid || ''),
          voiceNumberId,
          locationId: String(req.query.location_id || ''),
          companyId: String(req.query.company_id || ''),
          fromNumber: String(req.query.from || body.From || ''),
          toNumber: String(req.query.to || body.To || ''),
        };
        sendTwiml(res, await pipecatAnswerTwiml(ctx));
        return;
      }
    }

    // Agent-hangs-up success path: <Dial> has returned after a real
    // conversation. Flush the call_history row using the stashed room
    // context. The conference-leave handler also calls
    // flushRoomCallHistory for the customer-hangs-up case (where THIS
    // endpoint never fires because the parent leg is already gone) -
    // the flush is idempotent so whichever signal lands first wins.
    const dialDuration = parseInt(String(body.DialCallDuration || '0'), 10);
    void flushRoomCallHistory(room, {
      status: dialStatus || 'completed',
      durationSeconds: Number.isFinite(dialDuration) && dialDuration > 0 ? dialDuration : undefined,
    });

    sendTwiml(res, twimlDoc(tHangup()));
  } catch (err) {
    console.error('[Voice/LAML] /laml/post-conference error:', err);
    reportError(err as Error, {
      type: 'voice_status_webhook_error',
      metadata: { source: 'inboundLaml./laml/post-conference', room: String(req.query.room || ''), note: 'ringout-to-voicemail decision may have been skipped' },
    });
    sendTwiml(res, twimlDoc(tHangup()));
  }
});

/**
 * POST /api/voice/laml/ai-dispatch-result
 *
 * Diagnostic action= callback for the AI short-circuit `<Dial><Sip>` in
 * buildInboundTwiml. SignalWire posts the result of dialing Retell's
 * inbound SIP URI here so we can see exactly why a call dropped:
 *
 *   - DialCallStatus: completed | no-answer | busy | failed | canceled
 *   - DialSipResponseCode: the SIP response Retell sent back (404, 403, etc)
 *   - DialCallDuration: seconds the SIP leg was up (0 = never connected)
 *
 * Returns `<Hangup/>` since the call is done either way.
 */
lamlInboundRouter.post('/laml/ai-dispatch-result', async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const dialStatus = String(body.DialCallStatus || '');
    const sipCode = String(body.DialSipResponseCode || '');
    const duration = String(body.DialCallDuration || '0');
    const callSid = String(req.query.call_sid || body.CallSid || '');
    const fromNumber = String(req.query.from || body.From || '');
    const toNumber = String(req.query.to || body.To || '');
    const sipUri = String(req.query.sip_uri || '');

    const summary =
      `[Voice/LAML] AI dispatch result callSid=${callSid} from=${fromNumber} to=${toNumber} ` +
      `sip=${sipUri} status=${dialStatus} sipCode=${sipCode} duration=${duration}s`;

    if (dialStatus === 'completed' && parseInt(duration, 10) > 0) {
      console.log(summary);
    } else {
      console.warn(summary);
      console.warn(`[Voice/LAML] AI dispatch full body keys=${Object.keys(body).join(',')} body=${JSON.stringify(body)}`);
      // A failed AI dispatch means the caller never reached the agent (e.g.
      // Retell SIP 404 after registry drift). Track frequency; spikes mean
      // a number's Retell registration is broken.
      reportError(new Error(`AI dispatch failed status=${dialStatus} sipCode=${sipCode}`), {
        type: 'voice_ai_dispatch_error',
        dedupe: 'silent',
        escalateAfter: 10,
        metadata: { source: 'inboundLaml./laml/ai-dispatch-result', callSid, fromNumber, toNumber, sipUri, dialStatus, sipCode, duration },
      });
    }
  } catch (err) {
    console.error('[Voice/LAML] /laml/ai-dispatch-result error:', err);
    reportError(err as Error, {
      type: 'voice_status_webhook_error',
      dedupe: 'silent',
      metadata: { source: 'inboundLaml./laml/ai-dispatch-result' },
    });
  }
  sendTwiml(res, twimlDoc(tHangup()));
});

/**
 * POST /api/voice/laml/voicemail-callback
 *
 * Twilio-style recording completion callback. Mirrors the SWML
 * /api/voice/voicemail/recording-callback but parses Twilio form params
 * (RecordingUrl, RecordingSid, RecordingDuration) rather than the SWML
 * `record` action's status_url body shape.
 *
 * Query params (set by us at TwiML build time):
 *   voice_number_id, location_id, company_id, source, from, to
 */
lamlInboundRouter.post('/laml/voicemail-callback', async (req: Request, res: Response) => {
  // ACK fast - SignalWire's webhook timeout is ~15s and we retry the recording
  // download for up to ~50s waiting for the .mp3 to land on files.signalwire.com.
  // Without this, SignalWire would retry the webhook and we'd create duplicate
  // voicemail_messages rows.
  res.json({ ok: true });
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const recordingUrl = String(body.RecordingUrl || '');
    const recordingSid = String(body.RecordingSid || '');
    const recordingStatus = String(body.RecordingStatus || '');
    const callSid = String(body.CallSid || '');
    const duration = parseInt(String(body.RecordingDuration || '0'), 10);
    const durationSec = Number.isFinite(duration) && duration > 0 ? duration : null;

    console.log(
      `[Voice/LAML] /laml/voicemail-callback bodyKeys=${Object.keys(body).join(',')} ` +
      `status=${recordingStatus} sid=${recordingSid} url=${recordingUrl} duration=${duration}`,
    );

    const voiceNumberId = String(req.query.voice_number_id || '');
    const locationId = String(req.query.location_id || '');
    const companyId = String(req.query.company_id || '');
    const source = (String(req.query.source || 'ivr')) as 'ivr' | 'queue_overflow';
    const fromNumber = String(req.query.from || '');
    const toNumber = String(req.query.to || '');

    if (!companyId || !locationId) {
      console.warn('[Voice/LAML] voicemail-callback missing company_id/location_id');
      return;
    }

    const supabase = getSupabaseClient();

    // IDEMPOTENCY: SignalWire can redeliver the recording callback. Pre-check on
    // (company_id, call_sid) so a benign duplicate doesn't re-download/re-store,
    // mirroring the SWML recording-callback handler. The unique index backs the
    // simultaneous-webhook race; treat its violation (23505) as an expected skip
    // so a duplicate never pages the team.
    if (callSid) {
      const { data: existing } = await supabase
        .from('voicemail_messages')
        .select('id')
        .eq('company_id', companyId)
        .eq('call_sid', callSid)
        .maybeSingle();
      if (existing) {
        console.log('[Voice/LAML] voicemail-callback duplicate for call_sid=%s - already captured, skipping', callSid);
        return;
      }
    }

    const { data: inserted, error: insertErr } = await supabase
      .from('voicemail_messages')
      .insert({
        company_id: companyId,
        location_id: locationId,
        voice_number_id: voiceNumberId || null,
        call_sid: callSid || null,
        from_number: fromNumber || null,
        to_number: toNumber || null,
        audio_storage_path: null,
        audio_url: recordingUrl || null,
        duration_sec: durationSec,
        source,
        is_read: false,
      })
      .select('id')
      .single();
    if (insertErr || !inserted) {
      // 23505 = the unique index caught a simultaneous duplicate webhook. That's
      // expected and benign (the first delivery captured it) - log, don't alert.
      if ((insertErr as { code?: string } | null)?.code === '23505') {
        console.log('[Voice/LAML] voicemail-callback raced a duplicate (unique violation) for call_sid=%s - skipping', callSid);
        return;
      }
      console.error('[Voice/LAML] voicemail insert error:', insertErr);
      reportError((insertErr as unknown as Error) ?? new Error('voicemail insert returned no row'), {
        type: 'voicemail_persist_error',
        metadata: { source: 'inboundLaml./laml/voicemail-callback', companyId, locationId, callSid, note: 'voicemail lost; SignalWire does not retry' },
      });
      return;
    }

    // Use the shared downloader (axios with basic auth + redirect follow) that
    // call recording uses - keeps the two paths in sync. Append `.mp3` to the
    // bare LAML recording URL since the endpoint without an extension returns
    // JSON metadata; `.mp3` selects the encoded audio (Twilio convention).
    if (recordingUrl) {
      const lamlUrl = /\.(mp3|wav)$/i.test(recordingUrl) ? recordingUrl : `${recordingUrl}.mp3`;
      try {
        const { buf, contentType, ext } = await downloadSignalwireRecording(lamlUrl);
        const storagePath = `${companyId}/${inserted.id}.${ext}`;
        console.log(
          `[Voice/LAML] voicemail download ok bytes=${buf.length} ct=${contentType} → ${storagePath}`,
        );
        const { error: upErr } = await supabase.storage
          .from('voicemails')
          .upload(storagePath, buf, { contentType, upsert: true });
        if (upErr) {
          console.error('[Voice/LAML] voicemail upload failed:', upErr);
          reportError(upErr as unknown as Error, {
            type: 'voicemail_audio_error',
            metadata: { source: 'inboundLaml./laml/voicemail-callback', voicemailId: inserted.id, companyId, stage: 'upload' },
          });
        } else {
          await supabase
            .from('voicemail_messages')
            .update({ audio_storage_path: storagePath })
            .eq('id', inserted.id);
          // Audio landed → transcribe + notify (fire-and-forget).
          void processVoicemailPostCapture({
            voicemailId: inserted.id,
            companyId,
            locationId,
            fromNumber: fromNumber || null,
            durationSec,
            audio: { buf, contentType },
          });
        }
      } catch (dlErr) {
        const e = dlErr as { message?: string };
        // Not an alert: SignalWire often has not published the file yet, and the hourly
        // voicemail backfill retries every row without audio for 7 days. That job raises
        // the alert if a voicemail is STILL unplayable after 6 hours (a real loss).
        console.warn(`[Voice/LAML] voicemail download failed (backfill will retry) voicemail=${inserted.id} msg=${e?.message ?? dlErr}`);
      }
    } else {
      console.warn(`[Voice/LAML] voicemail-callback: no RecordingUrl, sid=${recordingSid}`);
    }

    if (callSid) {
      const { data: callRow } = await supabase
        .from('call_history')
        .select('id')
        .eq('provider_call_sid', callSid)
        .maybeSingle();
      if (callRow?.id) {
        await supabase
          .from('voicemail_messages')
          .update({ call_history_id: callRow.id })
          .eq('id', inserted.id);
      }
    }

  } catch (err) {
    console.error('[Voice/LAML] /laml/voicemail-callback unexpected:', err);
    reportError(err as Error, {
      type: 'voicemail_persist_error',
      metadata: { source: 'inboundLaml./laml/voicemail-callback', stage: 'unexpected' },
    });
  }
});

/**
 * POST /api/voice/laml/recording-callback
 *
 * Fires when SignalWire finalizes the bridged-call recording started by
 * <Dial record="record-from-answer">. We use a dedicated callback
 * rather than the project-level /status webhook because the latter is
 * not reliably triggered for LaML-controlled calls.
 *
 * Twilio-style body params: RecordingUrl, RecordingSid,
 * RecordingDuration, RecordingStatus, CallSid (the parent inbound
 * call). We match call_history by provider_call_sid = CallSid.
 *
 * Race tolerance: this callback can fire before flushRoomCallHistory
 * has written the row. We retry the lookup a few times so the recording
 * URL doesn't get dropped on the floor.
 */
lamlInboundRouter.post('/laml/recording-callback', async (req: Request, res: Response) => {
  // ACK fast - SignalWire retries on non-2xx and we never want that.
  res.json({ ok: true });
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const recordingUrl = String(body.RecordingUrl || '');
    const recordingSid = String(body.RecordingSid || '');
    const callSid = String(body.CallSid || '');
    const status = String(body.RecordingStatus || '');

    if (!callSid || !recordingUrl || status === 'failed') {
      console.warn(
        `[Voice/LAML] /laml/recording-callback skip - callSid=${callSid || '?'} ` +
        `url=${recordingUrl ? 'present' : 'missing'} status=${status || '?'}`,
      );
      return;
    }

    const supabase = getSupabaseClient();
    let row: { id: string; company_id: string } | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data } = await supabase
        .from('call_history')
        .select('id, company_id')
        .eq('provider_call_sid', callSid)
        .maybeSingle();
      if (data?.id && data?.company_id) {
        row = data as { id: string; company_id: string };
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (!row) {
      console.warn(
        `[Voice/LAML] /laml/recording-callback no call_history for sid=${callSid} ` +
        `after retries (recordingSid=${recordingSid})`,
      );
      return;
    }

    await supabase
      .from('call_history')
      .update({ recording_url: recordingUrl })
      .eq('id', row.id);

    void captureSignalwireRecording({
      callHistoryId: row.id,
      companyId: row.company_id,
      recordingUrl,
    });
    console.warn(
      `[Voice/LAML] /laml/recording-callback captured callHistory=${row.id} sid=${callSid}`,
    );
  } catch (err) {
    console.error('[Voice/LAML] /laml/recording-callback unexpected:', err);
    reportError(err as Error, {
      type: 'voice_recording_error',
      metadata: { source: 'inboundLaml./laml/recording-callback', stage: 'unexpected' },
    });
  }
});
