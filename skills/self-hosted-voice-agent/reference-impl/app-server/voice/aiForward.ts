/**
 * SignalWire → Retell SIP forward helpers.
 *
 * When AI is enabled on a SignalWire-owned voice number, the inbound
 * handler swaps from the default IVR/voice script to a small SWML that
 * dials Retell's elastic SIP trunk for that number. Retell sees the call
 * inbound on its trunk, matches the number to the registered agent
 * (registered via retellClient.importPhoneNumber), and runs the
 * conversation.
 *
 * This module is M2 scaffolding - produces the SWML body string and the
 * termination URI Retell needs. M3 wires it into the SignalWire phone_route
 * swap and the per-number enable-role orchestration.
 */

/**
 * Default Retell elastic SIP trunk inbound endpoint. Retell runs their SIP
 * gateway on LiveKit Cloud - confirmed by Retell custom-telephony docs and
 * Cloudonix's integration writeup. The `5t4n6j0wnrl` prefix is Retell's
 * LiveKit project id (shared across all Retell BYO customers, not per-
 * tenant). Override via env if Retell migrates to a different gateway.
 *
 * Transport MUST be TCP - `<Sip>` defaults to UDP, but Retell's LiveKit
 * SIP gateway only listens on TCP at port 5060, so UDP INVITEs disappear
 * into a black hole (manifests as SIP 408 timeouts on SignalWire's side).
 */
const RETELL_SIP_DEFAULT_HOST = '5t4n6j0wnrl.sip.livekit.cloud:5060';
const RETELL_SIP_TRANSPORT = 'tcp';

function getRetellSipHost(): string {
  return process.env.RETELL_SIP_INBOUND_HOST || RETELL_SIP_DEFAULT_HOST;
}

function getRetellSipTransport(): string {
  return process.env.RETELL_SIP_INBOUND_TRANSPORT || RETELL_SIP_TRANSPORT;
}

/**
 * The SIP URI SignalWire dials to hand the call off to Retell for a
 * given E.164. Retell uses the userinfo part (the number) to match the
 * inbound number against the agent we registered for it via
 * /import-phone-number.
 */
export function getRetellInboundSipUri(e164: string): string {
  const cleaned = e164.startsWith('+') ? e164 : `+${e164}`;
  return `sip:${cleaned}@${getRetellSipHost()};transport=${getRetellSipTransport()}`;
}

/**
 * SWML that forwards an inbound SignalWire call to the Retell trunk.
 * The `from` parameter preserves the caller's number on the Retell side
 * so the agent can use it (caller-id matching, call recording metadata).
 *
 * Returns the full SWML document as a JSON string ready to POST to the
 * SignalWire Resources API as a `swml_script`.
 */
export function buildRetellForwardSwml(e164: string): string {
  const sipUri = getRetellInboundSipUri(e164);
  return JSON.stringify({
    version: '1.0.0',
    sections: {
      main: [
        {
          connect: {
            from: '%{call.from}',
            to: sipUri,
            // Forward call_id/headers Retell expects via SIP-Headers,
            // populated on the SignalWire side from the inbound call.
            timeout: 30,
          },
        },
      ],
    },
  });
}

/**
 * Termination URI we hand to Retell at /import-phone-number time. This is
 * what Retell dials when its agent makes an outbound call on our number
 * (transfer, callback, etc.). For SignalWire we point at the project's
 * SIP gateway so SignalWire bridges back out to the PSTN.
 *
 * Configured per environment via SIGNALWIRE_SIP_TERMINATION_URI. If
 * missing the helper throws - the toggle UI surfaces "AI cannot be
 * enabled until SignalWire SIP gateway is configured" so the operator
 * sets the env var instead of silently breaking outbound.
 */
export function getSignalwireSipTerminationUri(): string {
  const uri = process.env.SIGNALWIRE_SIP_TERMINATION_URI;
  if (!uri) {
    throw new Error(
      'SIGNALWIRE_SIP_TERMINATION_URI is required to enable AI on a number. ' +
        'Set it to the SignalWire project SIP gateway (e.g. <project>.sip.signalwire.com).',
    );
  }
  return uri;
}

