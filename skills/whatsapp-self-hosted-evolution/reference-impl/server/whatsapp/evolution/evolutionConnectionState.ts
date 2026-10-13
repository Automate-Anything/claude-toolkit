/**
 * Map Evolution/Baileys connection state to our canonical WhatsAppConnectionState
 * enum - the SAME enum WHAPI maps into (see whapi/connectionState.ts). Every
 * writer (the Evolution inbound webhook, the reconcile cron) routes through here
 * so the DB `connection_state` column has one vocabulary regardless of provider,
 * and the UI keeps reading that one column.
 *
 * Evolution reports Baileys' three states via CONNECTION_UPDATE and
 * GET /instance/connectionState:
 *   'open'        → session authenticated + operational        → connected
 *   'connecting'  → linking / re-syncing                       → reconnecting
 *   'close'       → dropped. Baileys attaches a DisconnectReason:
 *                     loggedOut / 401       → needs_qr (must re-scan)
 *                     restartRequired/515   → reconnecting (self-heals)
 *                     otherwise             → disconnected
 *
 * A WhatsApp BAN surfaces on Evolution as a 'close' with statusCode 403 /
 * DisconnectReason.forbidden (or 401 loggedOut that never re-pairs). We map a
 * 403/forbidden to 'banned' so the existing banned-state handling (auto-silence,
 * no reconnect) fires identically to the WHAPI path.
 */
import type { WhatsAppConnectionState } from '../../whapi/connectionState.js';

/**
 * Map an Evolution CONNECTION_UPDATE payload (or connectionState response) to our
 * canonical state. `state` is 'open' | 'connecting' | 'close'. `statusCode` is
 * the Baileys DisconnectReason numeric code when state='close' (from
 * lastDisconnect.error.output.statusCode), if available.
 */
export function connectionStateFromEvolution(
  state: string | null | undefined,
  statusCode?: number | null,
): WhatsAppConnectionState {
  const s = (state ?? '').trim().toLowerCase();
  if (s === 'open') return 'connected';
  if (s === 'connecting') return 'reconnecting';
  if (s === 'close') {
    // Baileys DisconnectReason codes:
    //   401 loggedOut, 403 forbidden (ban), 428 connectionClosed,
    //   440 connectionReplaced, 500 badSession, 515 restartRequired,
    //   408 timedOut, 411 multideviceMismatch.
    switch (statusCode) {
      case 403:
        return 'banned';
      case 401:
        return 'needs_qr'; // logged out - phone unlinked the device, must re-scan
      case 515:
      case 428:
      case 408:
        return 'reconnecting'; // transient - Baileys reconnects on its own
      default:
        return 'disconnected';
    }
  }
  return 'unknown';
}

/** True when Evolution's DisconnectReason indicates a WhatsApp ban. */
export function isEvolutionBan(statusCode?: number | null): boolean {
  return statusCode === 403;
}
