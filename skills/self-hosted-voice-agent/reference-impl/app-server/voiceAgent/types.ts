/**
 * Shared types for the self-hosted voice agent (voice-rt, the Pipecat runtime
 * that replaces Retell's realtime loop).
 *
 * Two objects, deliberately separate:
 *   - VoiceAgentSession       = the server-side record (everything app-server
 *                               needs to dispatch tools, finalize the call and
 *                               bill it). Never leaves this process.
 *   - VoiceRtSessionContext   = the subset handed to voice-rt on WebSocket
 *                               connect: prompts, voice, tool schemas, settings.
 *                               No secrets, no service-role access, nothing the
 *                               runtime does not need to run the media loop.
 *
 * See docs/plans/SELF_HOSTED_VOICE_AGENT_PLATFORM_PLAN.md and the
 * `self-hosted-voice-agent` skill.
 */
import type { Part2HandoffPayload } from '../inbound/types.js';
import type { OpenAIToolDef } from '../ai/chat-agent/tools.js';

export type VoiceAgentProvider = 'retell' | 'pipecat';
export type VoiceEngine = 'chained' | 's2s_openai';

/** The Retell multi-prompt states, reproduced 1:1 by voice-rt. */
export type VoiceAgentState =
  | 'starter'
  | 'booking'
  | 'cancel'
  | 'update'
  | 'confirmation'
  | 'questions'
  | 'name';

export const VOICE_AGENT_STATES: VoiceAgentState[] = [
  'starter', 'booking', 'cancel', 'update', 'confirmation', 'questions', 'name',
];

/**
 * The internal state-switch tools the live prompts reference by name
 * ('booking_agent_transfer', ...). The names are load-bearing: the prompt
 * bodies in retell_prompts tell the model to call exactly these. The typo in
 * `cnformation_agent_transfer` is deliberate (it matches the prompts).
 */
export const STATE_SWITCH_TOOLS: Record<string, VoiceAgentState> = {
  booking_agent_transfer: 'booking',
  cancel_agent_transfer: 'cancel',
  update_agent_transfer: 'update',
  cnformation_agent_transfer: 'confirmation',
  question_agent_transfer: 'questions',
  name_agent_transfer: 'name',
};

/** How voice-rt must route a tool call. */
export type VoiceToolRouting =
  /** Handled inside voice-rt (prompt/tool swap), no HTTP. */
  | 'local_state_switch'
  /** Handled inside voice-rt: say goodbye, end the pipeline, then report `end`. */
  | 'local_end_call'
  /** Handled inside voice-rt: announce, then POST /tool-call so app-server redirects the leg. */
  | 'transfer_call'
  /** POST /tool-call to app-server; the result JSON is fed back to the model. */
  | 'server';

export interface VoiceRtVoiceConfig {
  engine: VoiceEngine;
  /** Retell-format id the operator picked (e.g. `11labs-Cimo`), for logs. */
  source_voice_id: string;
  gender: 'female' | 'male';
  /** Engine B (chained), PREFERRED: Cartesia sonic-3.6 voice id (the real voice
   *  list + cloned voices). When present, voice-rt uses Cartesia over ElevenLabs. */
  cartesia?: {
    voice_id: string;
    model: string;
    /** Cartesia generation_config: speed 0.6-1.5, emotion tone guide, volume 0.5-2.0.
     *  Mellow defaults (slightly slow, neutral tone) so it reads human, not "wild AI". */
    speed: number;
    emotion: string;
    volume: number;
  };
  /** Engine B (chained), fallback: ElevenLabs voice id + model + tuning. */
  elevenlabs: {
    voice_id: string;
    model: string;
    speed: number;
    stability: number;
    similarity_boost: number;
  };
  /** Engine A (S2S): OpenAI Realtime voice name. */
  openai_realtime: {
    voice: string;
    model: string;
  };
  /** BCP-47 locale(s); single value for most calls. */
  language: string | string[];
}

export interface VoiceRtSettings {
  /** 'fast' | 'balanced' | 'patient' (Silero stop_secs presets). */
  turn_taking_mode: 'fast' | 'balanced' | 'patient';
  /** Hard cap; Retell's default is 1h. */
  max_duration_seconds: number;
  /** STT / LLM model choices for engine B. */
  stt_model: string;
  llm_model: string;
  /** Speak this before the first LLM turn when set; otherwise the model opens. */
  greeting: string | null;
}

/** What voice-rt receives on WebSocket connect (GET /sessions/:id). */
export interface VoiceRtSessionContext {
  session_id: string;
  direction: 'inbound' | 'outbound';
  call_sid: string;
  from_number: string;
  to_number: string;
  company_id: string;
  location_id: string | null;
  timezone: string;
  /** Per-state system prompts, fully rendered (all `{{dynamic}}` substituted). */
  prompts: Record<VoiceAgentState, string>;
  /** Prepended to every state prompt when non-empty (multi-contact-per-phone). */
  disambiguation_instruction: string;
  initial_state: VoiceAgentState;
  voice: VoiceRtVoiceConfig;
  settings: VoiceRtSettings;
  /** The shared tool library as OpenAI function schemas. */
  tools: OpenAIToolDef[];
  /** name -> how to route it. */
  tool_routing: Record<string, VoiceToolRouting>;
  /** Whether a human transfer target exists (transfer_call is offered only when true). */
  can_transfer_to_human: boolean;
}

export interface VoiceAgentSession {
  session_id: string;
  created_at: number;
  /** Set when voice-rt claimed the session (WebSocket connected). */
  connected_at: number | null;
  ended_at: number | null;
  /** When post-call finalization finished (or failed). */
  finalized_at: number | null;
  direction: 'inbound' | 'outbound';
  call_sid: string;
  from_number: string;
  to_number: string;
  company_id: string;
  location_id: string | null;
  voice_number_id: string | null;
  timezone: string;
  receptionist_name: string;
  location_name: string;
  /** Bare digits or null. */
  transfer_to_number: string | null;
  contact: {
    id: string | null;
    first_name: string | null;
    last_name: string | null;
    disambiguated: boolean;
  };
  /** The dynamic-variable bundle (same shape Retell got). */
  dynamic_variables: Record<string, string>;
  context: VoiceRtSessionContext;
  /** The payload the chat-agent tool dispatcher needs. Rebuilt when
   *  set_caller_identity pins a different contact. */
  tool_payload: Part2HandoffPayload;
  /** Live telemetry voice-rt reports during the call. */
  live: {
    state: VoiceAgentState;
    turns: number;
    tool_calls: number;
    last_event_at: number | null;
  };
  /** Storage path of the recording once voice-rt uploaded it. */
  recording_bucket_path: string | null;
  /** Filled by the end payload. */
  end: VoiceRtEndPayload | null;
}

export interface VoiceRtTranscriptEntry {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  /** ms since call start. */
  t_ms: number;
  /** For role='tool'. */
  tool_name?: string;
  tool_ok?: boolean;
}

export interface VoiceRtToolCallLog {
  name: string;
  args: unknown;
  ok: boolean;
  latency_ms: number;
  /** ms since call start. */
  t_ms: number;
  error?: string | null;
}

export interface VoiceRtEndPayload {
  ended_by: 'caller' | 'agent' | 'transfer' | 'error' | 'timeout';
  /** ISO timestamps from the runtime clock. */
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  transcript: VoiceRtTranscriptEntry[];
  tool_calls: VoiceRtToolCallLog[];
  final_state: VoiceAgentState;
  engine: VoiceEngine;
  /** Per-turn latency stats (ms) measured in the runtime. */
  latency: {
    ttfb_p50_ms: number | null;
    ttfb_p95_ms: number | null;
    ttfb_max_ms: number | null;
    turns: number;
  };
  /** Component usage so app-server can price the call. */
  usage: {
    stt_seconds: number;
    tts_characters: number;
    llm_input_tokens: number;
    llm_output_tokens: number;
    /** S2S engine audio tokens (0 for chained). */
    s2s_audio_input_tokens: number;
    s2s_audio_output_tokens: number;
    models: { stt: string | null; llm: string | null; tts: string | null };
  };
  error: string | null;
  /** Set by the recording upload; voice-rt echoes it here. */
  recording_bucket_path: string | null;
}

/** Superadmin/admin-facing view of a session. */
export interface VoiceAgentSessionSummary {
  session_id: string;
  call_sid: string;
  from_number: string;
  to_number: string;
  company_id: string;
  location_id: string | null;
  created_at: string;
  connected_at: string | null;
  ended_at: string | null;
  engine: VoiceEngine;
  state: VoiceAgentState;
  turns: number;
  tool_calls: number;
  status: 'pending' | 'live' | 'ended';
}
