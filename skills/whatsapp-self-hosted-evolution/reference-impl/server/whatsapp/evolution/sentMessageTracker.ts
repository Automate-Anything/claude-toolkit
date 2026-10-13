/**
 * Short-lived record of message ids WE sent through the Evolution API
 * (evoSendText / evoSendMedia).
 *
 * Evolution echoes every outbound message back to the inbound webhook as a
 * `fromMe=true` event (a messages.upsert and/or a dedicated send.message event),
 * exactly like the WHAPI api-echo. We must DROP those echoes so we never
 * re-ingest a message we sent - but we must KEEP a `fromMe=true` message the
 * merchant typed on their OWN phone, because that has to land in the inbox and
 * trigger human-takeover (WHAPI parity: the `source==='api'` filter keeps
 * phone-typed `source==='mobile'` messages).
 *
 * Baileys/Evolution don't tag our API sends with a distinguishing `source`, so
 * the reliable discriminator is the message id: we record the id at send time and
 * drop only echoes whose id we recognize. Everything else `fromMe` is a genuine
 * reply-from-phone. This is the Evolution twin of WHAPI's `source==='api'` check.
 *
 * In-memory + short TTL is sufficient: the echo arrives within seconds of the
 * send, and if the process restarts the worst case is one echo slips through as a
 * (harmless, correctly-attributed) staff message.
 */

// The echo arrives within seconds; a generous TTL covers webhook lag/retries.
const TTL_MS = 5 * 60_000;
// Safety cap so a burst of sends can't grow the map unbounded.
const MAX_ENTRIES = 5000;

// id -> expiry epoch ms
const sentIds = new Map<string, number>();

export function recordSentEvolutionMessageId(id: string | null | undefined): void {
  if (!id) return;
  const now = Date.now();
  sentIds.set(id, now + TTL_MS);
  if (sentIds.size > MAX_ENTRIES) {
    // Drop expired first, then oldest-inserted until back under the cap.
    for (const [k, exp] of sentIds) {
      if (exp <= now) sentIds.delete(k);
    }
    while (sentIds.size > MAX_ENTRIES) {
      const oldest = sentIds.keys().next().value;
      if (oldest === undefined) break;
      sentIds.delete(oldest);
    }
  }
}

export function wasSentByEvolutionApi(id: string | null | undefined): boolean {
  if (!id) return false;
  const exp = sentIds.get(id);
  if (exp === undefined) return false;
  if (exp <= Date.now()) {
    sentIds.delete(id);
    return false;
  }
  return true;
}
