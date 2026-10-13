/**
 * End-of-call pipeline for self-hosted voice-agent calls.
 *
 * Reproduces everything Retell's `call_analyzed` webhook gave us, from OUR
 * data: (1) a post-call analysis (summary, sentiment, the caller's name, was
 * the call successful) computed with the LLM, (2) the `call_history` row +
 * recording + contact-name backfill + summary email via the SAME
 * `processPostCallAnalysis` Retell uses, (3) a `usage` row so the existing
 * per-minute billing drains it, (4) our real component cost on the row.
 */
import OpenAI from 'openai';
import { config } from '../config/env.js';
import { supabaseAdmin } from '../config/supabase.js';
import { reportError } from '../utils/errorReporter.js';
import { callOpenAi, OpenAiCallError } from '../openaiTelemetry/openaiClient.js';
import { processPostCallAnalysis, type ExtractedCallData } from '../retell/postCallAnalysis.js';
import { lamlEndCall } from '../voice/conferenceOrchestrate.js';
import { markEnded } from './sessionStore.js';
import type { VoiceAgentSession, VoiceRtEndPayload, VoiceRtTranscriptEntry } from './types.js';

const ANALYSIS_MODEL = 'gpt-4.1-mini';

export interface PostCallAnalysis {
  summary: string;
  user_sentiment: 'Positive' | 'Neutral' | 'Negative' | 'Unknown';
  user_name: string;
  call_successful: boolean | null;
  in_voicemail: boolean;
}

export function transcriptToText(entries: VoiceRtTranscriptEntry[]): string {
  const lines: string[] = [];
  for (const e of entries) {
    if (e.role === 'user') lines.push(`User: ${e.content}`);
    else if (e.role === 'assistant') lines.push(`Agent: ${e.content}`);
    // Tool rows are kept in metadata.tool_calls, not in the readable transcript.
  }
  return lines.join('\n');
}

/**
 * One cheap LLM call. Never throws: on any failure the call is still recorded
 * with an empty summary (the transcript is the source of truth either way).
 */
export async function analyzeCall(session: VoiceAgentSession, transcriptText: string): Promise<PostCallAnalysis> {
  const empty: PostCallAnalysis = { summary: '', user_sentiment: 'Unknown', user_name: '', call_successful: null, in_voicemail: false };
  if (!transcriptText.trim() || !config.openaiVoiceAgentApiKey) return empty;
  const openai = new OpenAI({ apiKey: config.openaiVoiceAgentApiKey });
  const businessType = session.dynamic_variables?.business_type || 'service business';
  // The operator's exact Retell post-call extraction prompts (summary / success /
  // sentiment / name), ported verbatim so self-hosted calls are scored IDENTICALLY
  // to Retell. All four fields are extracted in one JSON call.
  const system =
    'You analyze a finished phone call between an AI receptionist ("Agent") and a caller ("User"). ' +
    'Return ONLY a JSON object with EXACTLY these keys: summary, call_successful, user_sentiment, user_name, in_voicemail.\n\n' +
    `### summary\nYou are generating an internal call summary for staff at a ${businessType}.\n` +
    "Write 1-3 sentences max. Be direct. Write it the way you'd explain the call to a coworker in one sentence.\n" +
    'Only include what actually changed or was resolved. Ignore greetings, hold time, confusion, repeated questions, apologies, or anything that did not affect the outcome.\n' +
    'Follow these rules:\n' +
    '- Booked: "The caller booked a [service] for [Day, Date] at [Time]."\n' +
    '- Canceled: "The caller canceled their [service] appointment on [Day, Date] at [Time]."\n' +
    '- Rescheduled: "The caller rescheduled their [service] from [original date/time] to [new date/time]."\n' +
    '- Info only: "The caller asked about [topic] and got the information they needed."\n' +
    '- Nothing completed: "The caller wanted [X] but it was not completed because [specific reason]."\n' +
    '- No response: "Agent picked up but no one was on the line."\n' +
    'Do not speculate, mention system behavior, or explain how the conversation went. Do not include service prices, payment details, or anything the caller did not explicitly act on.\n\n' +
    '### call_successful (boolean true/false)\n' +
    'SUCCESSFUL (true) if: the agent responded correctly to everything the user asked; no tool errors or system failures occurred; the user left voluntarily (said they would call back, hung up, said goodbye) even if the task was not completed; the user did not express frustration caused by the agent.\n' +
    'UNSUCCESSFUL (false) if: a tool failed or returned an error that blocked the flow; the agent gave incorrect information or got confused; the user got frustrated specifically because of the agent; the agent violated an instruction (made up info, booked a wrong time, skipped required steps).\n' +
    'An incomplete task is NOT a failure. If the user chose to end the call before completing their request, that is unsuccessful ONLY if they were visibly and clearly frustrated with the agent. If they left on their own terms without frustration, the call is successful regardless of completion.\n\n' +
    "### user_sentiment (one of Positive, Neutral, Negative)\nEvaluate the user's sentiment, mood and satisfaction level.\n\n" +
    "### user_name\nThe caller's name if it was spoken during the call (so it can be filled in even if it was not captured live), else an empty string. Never invent a name.\n\n" +
    '### in_voicemail (boolean)\ntrue ONLY if the agent reached a voicemail greeting instead of a person.';
  try {
    const wrapped = await callOpenAi({
      apiKey: config.openaiVoiceAgentApiKey,
      feature: 'voice_agent_post_call',
      companyId: session.company_id,
      locationId: session.location_id,
      metadata: { session_id: session.session_id },
      benignErrorClasses: ['bad_request'],
      run: async () => {
        const c = await openai.chat.completions.create({
          model: ANALYSIS_MODEL,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: `Business: ${session.location_name}. Receptionist name: ${session.receptionist_name}.\n\nTranscript:\n${transcriptText.slice(0, 60_000)}` },
          ],
          response_format: { type: 'json_object' },
          max_tokens: 600,
          temperature: 0.2,
        });
        const u = c.usage;
        return {
          value: c,
          model: c.model ?? ANALYSIS_MODEL,
          endpoint: 'chat.completions',
          inputTokens: u?.prompt_tokens ?? 0,
          outputTokens: u?.completion_tokens ?? 0,
          cachedTokens: u?.prompt_tokens_details?.cached_tokens ?? 0,
          requestId: (c as unknown as { _request_id?: string })._request_id ?? null,
        };
      },
    });
    const raw = wrapped.value.choices[0]?.message?.content ?? '';
    const parsed = JSON.parse(raw) as Partial<PostCallAnalysis>;
    const sentiment = parsed.user_sentiment;
    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
      user_sentiment: sentiment === 'Positive' || sentiment === 'Neutral' || sentiment === 'Negative' ? sentiment : 'Unknown',
      user_name: typeof parsed.user_name === 'string' ? parsed.user_name.trim() : '',
      call_successful: typeof parsed.call_successful === 'boolean' ? parsed.call_successful : null,
      in_voicemail: parsed.in_voicemail === true,
    };
  } catch (err) {
    if (!(err instanceof OpenAiCallError)) {
      reportError(err instanceof Error ? err : new Error(String(err)), {
        type: 'voice_agent_post_call_analysis_error',
        dedupe: 'silent',
        metadata: { source: 'voiceAgent.postCall.analyzeCall', session_id: session.session_id, company_id: session.company_id },
      });
    }
    return empty;
  }
}

/**
 * Our component cost for the call, in integer cents. Wholesale rates
 * (2026-09): Deepgram Nova ~$0.0077/min, ElevenLabs Flash ~$0.10/1k chars on
 * the business tier, GPT-4.1 $2/$8 per 1M tokens, OpenAI Realtime audio
 * $32/$64 per 1M tokens, SignalWire ~$0.0085/min. Kept here (not in the DB)
 * because they are OUR costs for the P&L, not customer prices; customer price
 * is the plan's retell_rate_per_min.
 */
export function estimateCostCents(end: VoiceRtEndPayload): number {
  const minutes = Math.max(0, end.duration_seconds) / 60;
  const u = end.usage;
  const stt = (u.stt_seconds / 60) * 0.0077;
  const tts = (u.tts_characters / 1000) * 0.10;
  const llm = (u.llm_input_tokens / 1_000_000) * 2 + (u.llm_output_tokens / 1_000_000) * 8;
  const s2s = (u.s2s_audio_input_tokens / 1_000_000) * 32 + (u.s2s_audio_output_tokens / 1_000_000) * 64;
  const telephony = minutes * 0.0085;
  const compute = minutes * 0.004;
  return Math.round((stt + tts + llm + s2s + telephony + compute) * 100);
}

/**
 * Reconcile a call whose runtime DIED without sending an end report (voice-rt
 * process killed mid-call, network partition, etc.). Retell can't lose a call
 * this way (its webhook comes from its own infra); our runtime can, so the
 * sweeper calls this for a live session that has gone silent, synthesizing a
 * minimal end payload from what we captured so the call is NEVER missing from
 * call_history. Alerts, because a dropped runtime is engineer-actionable.
 */
export async function reconcileOrphanedSession(session: VoiceAgentSession): Promise<void> {
  if (session.finalized_at !== null) return;
  const startedIso = session.connected_at ? new Date(session.connected_at).toISOString() : new Date(session.created_at).toISOString();
  const lastEvent = session.live.last_event_at ?? session.connected_at ?? session.created_at;
  const endedIso = new Date(lastEvent).toISOString();
  const durationSeconds = Math.max(0, (lastEvent - (session.connected_at ?? session.created_at)) / 1000);

  reportError(new Error('self-hosted voice call orphaned (runtime sent no end report)'), {
    type: 'voice_agent_orphaned_call',
    metadata: {
      source: 'voiceAgent.postCall.reconcileOrphanedSession',
      session_id: session.session_id,
      company_id: session.company_id,
      call_sid: session.call_sid,
      approx_duration_seconds: durationSeconds,
      note: 'voice-rt did not POST /end; the call_history row is reconstructed from partial state. Check voice-rt health/deploys.',
    },
  });

  const synthetic: VoiceRtEndPayload = {
    ended_by: 'error',
    started_at: startedIso,
    ended_at: endedIso,
    duration_seconds: durationSeconds,
    transcript: [],
    tool_calls: [],
    final_state: session.live.state,
    engine: session.context.voice.engine,
    latency: { ttfb_p50_ms: null, ttfb_p95_ms: null, ttfb_max_ms: null, turns: session.live.turns },
    usage: {
      stt_seconds: 0, tts_characters: 0, llm_input_tokens: 0, llm_output_tokens: 0,
      s2s_audio_input_tokens: 0, s2s_audio_output_tokens: 0,
      models: { stt: null, llm: null, tts: null },
    },
    error: 'orphaned: no end report from runtime',
    recording_bucket_path: session.recording_bucket_path,
  };
  await finalizeVoiceAgentCall(session, synthetic);
}

/**
 * Called by routes/rt.ts after `POST /sessions/:id/end`. Runs async; the HTTP
 * ack was already sent. Idempotent on the session (second call is a no-op).
 */
export async function finalizeVoiceAgentCall(session: VoiceAgentSession, end: VoiceRtEndPayload): Promise<void> {
  if (session.finalized_at !== null) return;
  session.finalized_at = Date.now();
  session.end = end;
  markEnded(session.session_id);

  // 1. If the AGENT ended the call (goodbye + end_call) the PSTN leg may still
  // be up until SignalWire notices the closed stream. Guarantee it via REST.
  if (end.ended_by === 'agent' || end.ended_by === 'timeout' || end.ended_by === 'error') {
    try {
      await lamlEndCall(session.call_sid);
    } catch (err) {
      reportError(err instanceof Error ? err : new Error(String(err)), {
        type: 'voice_agent_hangup_error',
        dedupe: 'silent',
        metadata: { source: 'voiceAgent.postCall.finalize.hangup', session_id: session.session_id, call_sid: session.call_sid },
      });
    }
  }

  const transcriptText = transcriptToText(end.transcript);
  const analysis = await analyzeCall(session, transcriptText);
  const recordingPath = end.recording_bucket_path ?? session.recording_bucket_path;

  // "Every phone call fully recorded" is a hard requirement. A real conversation
  // that produced NO recording is a defect the team must see, not a silent gap.
  // (A call that never connected -- ended_by 'error'/'timeout' with ~no duration
  // -- legitimately has nothing to record and is exempt.)
  const isRealConversation = end.ended_by !== 'error' && end.ended_by !== 'timeout' && end.duration_seconds >= 3;
  if (isRealConversation && !recordingPath) {
    reportError(new Error('self-hosted voice call completed with NO recording'), {
      type: 'voice_agent_missing_recording',
      metadata: {
        source: 'voiceAgent.postCall.finalize',
        session_id: session.session_id,
        company_id: session.company_id,
        duration_seconds: end.duration_seconds,
        ended_by: end.ended_by,
        note: 'voice-rt did not upload a WAV for a real conversation; recording is lost for this call',
      },
    });
  }

  const data: ExtractedCallData = {
    companyId: session.company_id,
    // No external URL: the recording (when present) is already in our bucket.
    recordingUrl: '',
    recordingBucketPath: recordingPath,
    agentType: 'ai',
    provider: 'pipecat',
    voiceNumberId: session.voice_number_id,
    providerCallSid: session.call_sid,
    rawFromNumber: `+${session.from_number}`,
    rawToNumber: `+${session.to_number}`,
    fromNumberStripped: session.from_number,
    toNumberStripped: session.to_number,
    fromNumberWithPlus: `+${session.from_number}`,
    toNumberWithPlus: `+${session.to_number}`,
    callId: session.session_id,
    agentId: `pipecat:${end.engine}`,
    agentVersion: null,
    agentName: 'self-hosted',
    direction: session.direction,
    callStatus: end.ended_by === 'error' ? 'failed' : 'completed',
    durationSeconds: Math.round(end.duration_seconds),
    callStartedAt: end.started_at,
    callEndedAt: end.ended_at,
    transcript: transcriptText,
    summary: analysis.summary,
    userSentiment: analysis.user_sentiment === 'Unknown' ? null : analysis.user_sentiment,
    userName: analysis.user_name,
    inVoicemail: analysis.in_voicemail,
    callSuccessful: analysis.call_successful,
    disconnectionReason: end.ended_by,
    totalCostCents: estimateCostCents(end),
    productCosts: { engine: end.engine, usage: end.usage },
    llmTokenUsage: { input: end.usage.llm_input_tokens, output: end.usage.llm_output_tokens, s2s_audio_input: end.usage.s2s_audio_input_tokens, s2s_audio_output: end.usage.s2s_audio_output_tokens },
    latency: end.latency,
    toolCalls: end.tool_calls,
    transcriptWithToolCalls: end.transcript,
    recordingMultiChannelUrl: null,
    publicLogUrl: null,
    dataStorageSetting: null,
    twilioCallSid: session.call_sid,
    dynLocationId: session.location_id,
    dynLocationName: session.location_name,
  };

  try {
    await processPostCallAnalysis(data);
  } catch (err) {
    // processPostCallAnalysis already reported the insert failure.
    if (!(err as { __reported?: boolean }).__reported) {
      reportError(err instanceof Error ? err : new Error(String(err)), {
        type: 'voice_agent_post_call_error',
        metadata: { source: 'voiceAgent.postCall.finalize', session_id: session.session_id, company_id: session.company_id },
      });
    }
  }

  // 2. Meter the minutes. usage_type 'retell' is the legacy NAME of the AI
  // phone-minute bucket (plans carry included_retell_min / retell_rate_per_min
  // and the billing cron drains that type); reusing it means the customer's
  // plan, quota, price and billing page all keep working unchanged on day one.
  // A per-tier rename is Phase 2 of the plan.
  const minutes = Math.max(0, end.duration_seconds) / 60;
  if (minutes > 0) {
    // Tier marker for tiered pricing. usage_type stays 'retell' (so quota,
    // included-minutes, insufficient-funds, and every analytics reader keep
    // working); the tier rides on the description as a STABLE prefix that
    // billing.ts parses: '[tier:premium]' for Lifelike (S2S) minutes,
    // '[tier:standard]' for chained. See migration 20260922_120000.
    const tierTag = end.engine === 's2s_openai' ? '[tier:premium]' : '[tier:standard]';
    const { error } = await supabaseAdmin.from('usage').insert({
      company_id: session.company_id,
      external_id: session.session_id,
      usage_type: 'retell',
      quantity: minutes,
      unit: 'minutes',
      description: `${tierTag} AI Call (self-hosted, ${end.engine}) ${session.session_id}`,
      start_time: end.started_at,
      end_time: end.ended_at,
      billed: false,
    });
    if (error && error.code !== '23505') {
      reportError(new Error(`voice-agent usage insert failed: ${error.message}`), {
        type: 'voice_agent_usage_insert_error',
        metadata: { source: 'voiceAgent.postCall.finalize.usage', session_id: session.session_id, company_id: session.company_id, note: 'call minutes NOT billed' },
      });
    }
  }
}
