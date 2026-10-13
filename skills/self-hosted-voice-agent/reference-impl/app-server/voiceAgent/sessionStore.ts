/**
 * In-memory session store for self-hosted voice-agent calls.
 *
 * Why in-memory: app-server runs as a SINGLE Render instance (see
 * docs/plans/voice-relay-migration.md "Decisions"), there is no Redis in this
 * stack, and a session's pre-connect window is ~1 second (SignalWire fetches
 * the cXML, opens the media stream, voice-rt claims the session). A restart in
 * that window loses the call bootstrap, which is the same blast radius an
 * in-flight SignalWire SDK call already has today. The durable record is the
 * call_history row written at call end (postCall.ts); this store is transient
 * call-control state only.
 *
 * Lifecycle:
 *   create   -> pending   (cXML returned; waiting for the media WebSocket)
 *   claim    -> live      (voice-rt fetched the context)
 *   end      -> ended     (voice-rt posted the end payload; finalization runs)
 *   sweep    -> removed   (pending > PENDING_TTL, ended > ENDED_TTL, live > MAX_LIVE)
 */
import { randomUUID } from 'node:crypto';
import { reportError } from '../utils/errorReporter.js';
import type { VoiceAgentSession, VoiceAgentSessionSummary } from './types.js';

const PENDING_TTL_MS = 3 * 60 * 1000;
const ENDED_TTL_MS = 10 * 60 * 1000;
/** A live session older than this is a leak (max call is 1h + slack). */
const MAX_LIVE_MS = 3 * 60 * 60 * 1000;
/** A live session with NO events for this long = the runtime dropped it (it
 *  reports state/turn/heartbeat far more often than this). We reconcile it into
 *  call_history so the call is never lost, even if voice-rt crashed. */
const STALE_LIVE_MS = 5 * 60 * 1000;
const SWEEP_EVERY_MS = 60 * 1000;

const sessions = new Map<string, VoiceAgentSession>();
let sweeper: NodeJS.Timeout | null = null;

function ensureSweeper(): void {
  if (sweeper) return;
  sweeper = setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) {
      const pendingExpired = s.connected_at === null && now - s.created_at > PENDING_TTL_MS;
      const endedExpired = s.ended_at !== null && now - s.ended_at > ENDED_TTL_MS;
      const liveLeak = s.connected_at !== null && s.ended_at === null && now - s.connected_at > MAX_LIVE_MS;
      // Live but silent = the runtime dropped the call without an end report.
      const staleLive =
        s.connected_at !== null
        && s.ended_at === null
        && s.finalized_at === null
        && now - (s.live.last_event_at ?? s.connected_at) > STALE_LIVE_MS;
      if (staleLive) {
        // Reconcile into call_history so the call is never missing, then remove.
        // Dynamic import breaks the postCall <-> sessionStore cycle. Mark
        // finalized synchronously so a slow reconcile can't double-fire next tick.
        s.finalized_at = Date.now();
        void import('./postCall.js')
          .then((m) => m.reconcileOrphanedSession(s))
          .catch((err) => {
            reportError(err instanceof Error ? err : new Error(String(err)), {
              type: 'voice_agent_orphan_reconcile_failed',
              metadata: { source: 'voiceAgent.sessionStore.sweep', session_id: id, company_id: s.company_id },
            });
          });
        sessions.delete(id);
        continue;
      }
      if (pendingExpired) {
        // The stream never connected: SignalWire failed to reach voice-rt, or
        // the caller hung up during the cXML fetch. Visible, low severity.
        reportError(new Error('voice-agent session never connected'), {
          type: 'voice_agent_session_unclaimed',
          dedupe: 'silent',
          escalateAfter: 10,
          metadata: {
            source: 'voiceAgent.sessionStore.sweep',
            session_id: id,
            company_id: s.company_id,
            to_number: s.to_number,
            note: 'cXML <Connect><Stream> returned but voice-rt never fetched the session; check VOICE_RT_URL / runtime health',
          },
        });
      }
      if (liveLeak) {
        reportError(new Error('voice-agent session live for > 3h (leak)'), {
          type: 'voice_agent_session_leak',
          dedupe: 'silent',
          metadata: { source: 'voiceAgent.sessionStore.sweep', session_id: id, company_id: s.company_id },
        });
      }
      if (pendingExpired || endedExpired || liveLeak) sessions.delete(id);
    }
  }, SWEEP_EVERY_MS);
  // Never keep the process alive just for the sweeper.
  sweeper.unref();
}

export function newSessionId(): string {
  return `vrt_${randomUUID().replace(/-/g, '')}`;
}

export function createSession(session: VoiceAgentSession): VoiceAgentSession {
  ensureSweeper();
  sessions.set(session.session_id, session);
  return session;
}

export function getSession(sessionId: string): VoiceAgentSession | null {
  return sessions.get(sessionId) ?? null;
}

/**
 * voice-rt claims the session on WebSocket connect. Single-use: a second claim
 * (a replayed session id) is refused so a leaked id cannot re-drive a call.
 */
export function claimSession(sessionId: string): { ok: true; session: VoiceAgentSession } | { ok: false; reason: 'not_found' | 'already_claimed' | 'ended' } {
  const s = sessions.get(sessionId);
  if (!s) return { ok: false, reason: 'not_found' };
  if (s.ended_at !== null) return { ok: false, reason: 'ended' };
  if (s.connected_at !== null) return { ok: false, reason: 'already_claimed' };
  s.connected_at = Date.now();
  s.live.last_event_at = s.connected_at;
  return { ok: true, session: s };
}

export function markEnded(sessionId: string): VoiceAgentSession | null {
  const s = sessions.get(sessionId);
  if (!s) return null;
  if (s.ended_at === null) s.ended_at = Date.now();
  return s;
}

export function listSessions(): VoiceAgentSessionSummary[] {
  const out: VoiceAgentSessionSummary[] = [];
  for (const s of sessions.values()) {
    out.push({
      session_id: s.session_id,
      call_sid: s.call_sid,
      from_number: s.from_number,
      to_number: s.to_number,
      company_id: s.company_id,
      location_id: s.location_id,
      created_at: new Date(s.created_at).toISOString(),
      connected_at: s.connected_at ? new Date(s.connected_at).toISOString() : null,
      ended_at: s.ended_at ? new Date(s.ended_at).toISOString() : null,
      engine: s.context.voice.engine,
      state: s.live.state,
      turns: s.live.turns,
      tool_calls: s.live.tool_calls,
      status: s.ended_at ? 'ended' : s.connected_at ? 'live' : 'pending',
    });
  }
  return out.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

/** Count of sessions currently on a live media stream. */
export function liveSessionCount(): number {
  let n = 0;
  for (const s of sessions.values()) if (s.connected_at !== null && s.ended_at === null) n++;
  return n;
}
