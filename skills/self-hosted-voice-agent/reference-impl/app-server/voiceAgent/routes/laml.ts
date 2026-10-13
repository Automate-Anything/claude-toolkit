/**
 * Public cXML endpoints SignalWire fetches during a self-hosted voice-agent
 * call. Mounted under /api/voice (the `/api/voice/laml` prefix is already on
 * the no-Origin allowlist).
 *
 *   POST /laml/voice-agent/transfer?session_id=  the transfer_call redirect
 *        target: <Dial> the caller to the human fallback number. Called via
 *        SignalWire's modify-call (lamlModifyCallUrl), which ends the media
 *        stream and runs this document on the caller's leg.
 */
import { Router, type Request, type Response } from 'express';
import { getSession } from '../sessionStore.js';
import { buildHangupTwiml, buildStreamTwiml, buildTransferTwiml } from '../laml.js';
import { reportError } from '../../utils/errorReporter.js';

export const voiceAgentLamlRouter: Router = Router();

function sendTwiml(res: Response, body: string): void {
  res.setHeader('Content-Type', 'text/xml; charset=utf-8');
  res.status(200).send(body);
}

voiceAgentLamlRouter.post('/laml/voice-agent/transfer', (req: Request, res: Response) => {
  const sessionId = String(req.query.session_id ?? '');
  const session = getSession(sessionId);
  if (!session || !session.transfer_to_number) {
    sendTwiml(res, buildHangupTwiml());
    return;
  }
  sendTwiml(res, buildTransferTwiml({ toE164: session.transfer_to_number, callerId: `+${session.from_number}` }));
});

/**
 * POST /laml/voice-agent/outbound-answer?session_id=
 *
 * SignalWire fetches this when an OUTBOUND agent call is answered (the `url`
 * on cxmlOriginate). Returns <Connect><Stream> to voice-rt for the same
 * session that startOutboundCall created. SignalWire also POSTs machine-answer
 * details, but AMD is not enabled here (a short greeting handles voicemail
 * gracefully); if the number is dead the stream simply never carries speech
 * and the call ends normally.
 */
voiceAgentLamlRouter.post('/laml/voice-agent/outbound-answer', (req: Request, res: Response) => {
  const sessionId = String(req.query.session_id ?? '');
  const session = getSession(sessionId);
  if (!session || session.ended_at !== null) {
    sendTwiml(res, buildHangupTwiml());
    return;
  }
  const twiml = buildStreamTwiml(sessionId);
  if (!twiml) {
    reportError(new Error('outbound-answer: voice-rt stream URL unavailable'), {
      type: 'voice_agent_runtime_unconfigured',
      metadata: { source: 'voiceAgent.routes.laml.outbound-answer', session_id: sessionId, company_id: session.company_id },
    });
    sendTwiml(res, buildHangupTwiml());
    return;
  }
  sendTwiml(res, twiml);
});
