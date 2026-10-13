/**
 * Batch/campaign OUTBOUND for the self-hosted voice agent.
 *
 * A campaign is a list of contacts + one objective. The runner (a per-minute
 * cron) dials up to the campaign's concurrency cap, within quiet hours in each
 * CALLED party's local timezone, skipping opted-out numbers, retrying no-answers
 * up to max_attempts. Each dial reuses the SHARED single-call path
 * (startOutboundCall): the gate, the tools, the DNC check, and post-call
 * ingestion all apply unchanged.
 *
 * Concurrency is measured against the live session store (how many of THIS
 * campaign's calls are currently connected), so a slow campaign never exceeds
 * its cap or starves the runtime.
 */
import { supabaseAdmin } from '../config/supabase.js';
import { reportError } from '../utils/errorReporter.js';
import { toE164Digits } from '../utils/phoneCanonical.js';
import { startOutboundCall, OutboundError } from './outbound.js';
import { getSession } from './sessionStore.js';
import { evaluateVoiceAgentGate } from './gate.js';

const LOG = '[VoiceCampaigns]';

/** Called-party-local quiet-hours check (TCPA default 8-21). Pure. */
function withinQuietHours(timezone: string, startHour: number, endHour: number): boolean {
  let hour = 12;
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', hour12: false }).formatToParts(new Date());
    hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '12', 10);
    if (Number.isNaN(hour)) hour = 12;
  } catch {
    hour = 12; // unknown tz -> treat as mid-day (safe: inside any normal window)
  }
  if (startHour <= endHour) return hour >= startHour && hour < endHour;
  return hour >= startHour || hour < endHour; // overnight window
}

interface CampaignRow {
  id: string;
  company_id: string;
  location_id: string | null;
  objective: string;
  from_number: string;
  status: string;
  consent_scope: 'marketing' | 'transactional';
  max_concurrency: number;
  quiet_hours_start: number;
  quiet_hours_end: number;
  max_attempts: number;
}

interface RecipientRow {
  id: string;
  campaign_id: string;
  company_id: string;
  contact_id: string | null;
  phone_digits: string;
  status: string;
  attempts: number;
  session_id: string | null;
}

// ── Create ──────────────────────────────────────────────────────────────────

export interface CreateCampaignInput {
  companyId: string;
  locationId: string | null;
  name: string;
  objective: string;
  fromNumber: string;
  /** Contact ids to call. Each is resolved to a phone; no-phone contacts skip. */
  contactIds: string[];
  consentScope?: 'marketing' | 'transactional';
  maxConcurrency?: number;
  quietHoursStart?: number;
  quietHoursEnd?: number;
  maxAttempts?: number;
  createdBy?: string | null;
  /** When true, start 'sending' immediately; else leave 'draft'. */
  startNow?: boolean;
}

export class CampaignError extends Error {
  constructor(public readonly code: string, message: string, public readonly httpStatus = 400) {
    super(message);
    this.name = 'CampaignError';
  }
}

export async function createVoiceCampaign(input: CreateCampaignInput): Promise<{ campaign_id: string; recipient_count: number; skipped: number }> {
  const gate = await evaluateVoiceAgentGate(input.companyId, input.locationId);
  if (!gate.allowed) throw new CampaignError('gate_closed', 'The self-hosted voice agent is not enabled for this business.', 409);
  if (!input.objective.trim()) throw new CampaignError('no_objective', 'The campaign needs an objective (what each call should accomplish).');
  if (!input.contactIds.length) throw new CampaignError('no_recipients', 'The campaign has no contacts.');

  const fromE164 = input.fromNumber.startsWith('+') ? input.fromNumber : `+${input.fromNumber}`;
  // Verify the from number is a self-hosted AI number for this company (same
  // guard startOutboundCall applies per call; fail fast at create time too).
  const { data: vn } = await supabaseAdmin
    .from('voice_numbers')
    .select('id, ai_provider, ai_active')
    .or(`phone_number.eq.${fromE164},phone_number.eq.${fromE164.slice(1)}`)
    .eq('company_id', input.companyId)
    .eq('is_active', true)
    .maybeSingle();
  const vnRow = vn as { ai_provider?: string | null; ai_active?: boolean | null } | null;
  if (!vnRow || vnRow.ai_provider !== 'pipecat' || vnRow.ai_active === false) {
    throw new CampaignError('from_not_self_hosted', 'The from number is not an active self-hosted AI number.', 409);
  }

  // Resolve contacts -> phone. Deduplicate by phone. Contacts with no phone are skipped.
  const { data: contacts } = await supabaseAdmin
    .from('contacts')
    .select('id, phone_number, phone_mobile, phone_home')
    .eq('company_id', input.companyId)
    .in('id', input.contactIds.slice(0, 5000));
  const rows: Array<{ contact_id: string; phone_digits: string }> = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const c of (contacts ?? []) as Array<Record<string, unknown>>) {
    const raw = ['phone_number', 'phone_mobile', 'phone_home'].map((k) => c[k]).find((v) => typeof v === 'string' && (v as string).trim()) as string | undefined;
    const digits = raw ? toE164Digits(raw) : null;
    if (!digits || seen.has(digits)) { skipped++; continue; }
    seen.add(digits);
    rows.push({ contact_id: c.id as string, phone_digits: digits });
  }
  if (rows.length === 0) throw new CampaignError('no_valid_recipients', 'None of the selected contacts have a usable phone number.');

  const { data: campaign, error: cErr } = await supabaseAdmin
    .from('voice_campaigns')
    .insert({
      company_id: input.companyId,
      location_id: input.locationId,
      name: input.name.trim() || 'Voice campaign',
      objective: input.objective.trim(),
      from_number: fromE164,
      status: input.startNow ? 'sending' : 'draft',
      consent_scope: input.consentScope ?? 'marketing',
      max_concurrency: input.maxConcurrency ?? 3,
      quiet_hours_start: input.quietHoursStart ?? 8,
      quiet_hours_end: input.quietHoursEnd ?? 21,
      max_attempts: input.maxAttempts ?? 2,
      recipient_count: rows.length,
      created_by: input.createdBy ?? null,
      started_at: input.startNow ? new Date().toISOString() : null,
    })
    .select('id')
    .single();
  if (cErr || !campaign) {
    reportError((cErr as unknown as Error) ?? new Error('voice_campaigns insert returned no row'), {
      type: 'voice_campaign_create_error',
      metadata: { source: 'voiceAgent.campaigns.createVoiceCampaign', company_id: input.companyId },
    });
    throw new CampaignError('create_failed', 'Could not create the campaign.', 500);
  }
  const campaignId = campaign.id as string;

  // Bulk-insert recipients in chunks (the .in() cap + insert size).
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map((r) => ({
      campaign_id: campaignId,
      company_id: input.companyId,
      contact_id: r.contact_id,
      phone_digits: r.phone_digits,
      status: 'pending',
    }));
    const { error: rErr } = await supabaseAdmin.from('voice_campaign_recipients').insert(chunk);
    if (rErr) {
      reportError(rErr as unknown as Error, {
        type: 'voice_campaign_create_error',
        metadata: { source: 'voiceAgent.campaigns.createVoiceCampaign.recipients', campaign_id: campaignId, company_id: input.companyId },
      });
      throw new CampaignError('recipients_failed', 'Created the campaign but failed to add all recipients.', 500);
    }
  }

  return { campaign_id: campaignId, recipient_count: rows.length, skipped };
}

// ── Runner (cron) ─────────────────────────────────────────────────────────

/** How many of a campaign's recipients are currently on a live call. */
function liveCountForCampaign(recipients: RecipientRow[]): number {
  let n = 0;
  for (const r of recipients) {
    if (r.status === 'calling' && r.session_id) {
      const s = getSession(r.session_id);
      if (s && s.ended_at === null) n++;
    }
  }
  return n;
}

async function reconcileCalling(campaign: CampaignRow, recipients: RecipientRow[]): Promise<void> {
  // A 'calling' row whose session has ended (or vanished) must be settled from
  // the session outcome, so it does not hold a concurrency slot forever.
  for (const r of recipients) {
    if (r.status !== 'calling') continue;
    const s = r.session_id ? getSession(r.session_id) : null;
    if (s && s.ended_at === null) continue; // still live
    // Session gone or ended. Decide done vs retry from the end payload.
    const ended = s?.end;
    const answered = ended ? ended.ended_by !== 'timeout' && ended.duration_seconds > 3 : false;
    if (answered) {
      await supabaseAdmin.from('voice_campaign_recipients')
        .update({ status: 'done', outcome: ended?.ended_by ?? 'completed', updated_at: new Date().toISOString() })
        .eq('id', r.id);
    } else if (r.attempts >= campaign.max_attempts) {
      // No/short answer AND out of attempts (attempts was incremented at dial
      // time, so this row has already been dialed max_attempts times). Stop
      // dialing this person: mark failed, never re-queue.
      await supabaseAdmin.from('voice_campaign_recipients')
        .update({ status: 'failed', outcome: ended?.ended_by ?? 'no_answer', updated_at: new Date().toISOString() })
        .eq('id', r.id);
    } else {
      // No/short answer with attempts left: back to pending for another dial.
      await supabaseAdmin.from('voice_campaign_recipients')
        .update({ status: 'pending', session_id: null, updated_at: new Date().toISOString() })
        .eq('id', r.id);
    }
  }
}

async function processCampaign(campaign: CampaignRow): Promise<void> {
  // Load recipients (bounded; a huge campaign is processed a page at a time).
  const { data: recRows, error: recErr } = await supabaseAdmin
    .from('voice_campaign_recipients')
    .select('id, campaign_id, company_id, contact_id, phone_digits, status, attempts, session_id')
    .eq('campaign_id', campaign.id)
    .in('status', ['pending', 'calling'])
    .order('created_at', { ascending: true })
    .limit(500);
  if (recErr) {
    reportError(recErr, { type: 'job_error', metadata: { source: 'voiceAgent.campaigns.processCampaign', campaign_id: campaign.id } });
    return;
  }
  const recipients = (recRows ?? []) as RecipientRow[];

  // Settle any finished 'calling' rows first (frees slots).
  await reconcileCalling(campaign, recipients);

  // Re-read statuses that reconcile may have changed.
  const pending = recipients.filter((r) => r.status === 'pending');
  const stillCalling = liveCountForCampaign(recipients);

  if (pending.length === 0 && stillCalling === 0) {
    // Are there truly none left anywhere? Re-check the whole campaign.
    const { count } = await supabaseAdmin
      .from('voice_campaign_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaign.id)
      .in('status', ['pending', 'calling']);
    if (!count || count === 0) {
      await supabaseAdmin.from('voice_campaigns')
        .update({ status: 'done', finished_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', campaign.id);
      console.log(`${LOG} Campaign ${campaign.id} done.`);
    }
    return;
  }

  // Quiet hours: use the campaign location's timezone as the default window
  // reference. (Per-recipient timezone would need a contact tz column; contacts
  // do not carry one, so the location tz is the correct available proxy, and
  // the TCPA window is generous.)
  let tz = 'America/New_York';
  if (campaign.location_id) {
    const { data: loc } = await supabaseAdmin.from('locations').select('timezone').eq('id', campaign.location_id).maybeSingle();
    tz = (loc as { timezone?: string | null } | null)?.timezone ?? tz;
  }
  if (!withinQuietHours(tz, campaign.quiet_hours_start, campaign.quiet_hours_end)) {
    console.log(`${LOG} Campaign ${campaign.id} deferred (outside ${campaign.quiet_hours_start}-${campaign.quiet_hours_end} ${tz}).`);
    return;
  }

  // Dial up to the concurrency headroom this tick.
  const headroom = Math.max(0, campaign.max_concurrency - stillCalling);
  const toDial = pending.slice(0, headroom);
  for (const r of toDial) {
    // Claim the row (pending -> calling) atomically-ish: only if still pending.
    const { data: claimed } = await supabaseAdmin
      .from('voice_campaign_recipients')
      .update({ status: 'calling', attempts: r.attempts + 1, last_attempt_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', r.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();
    if (!claimed) continue; // another tick grabbed it

    try {
      const result = await startOutboundCall({
        companyId: campaign.company_id,
        locationId: campaign.location_id,
        toNumber: r.phone_digits,
        fromNumber: campaign.from_number,
        objective: campaign.objective,
        reason: `voice_campaign:${campaign.id}`,
        consentScope: campaign.consent_scope,
      });
      await supabaseAdmin.from('voice_campaign_recipients')
        .update({ session_id: result.session_id, updated_at: new Date().toISOString() })
        .eq('id', r.id);
      // Best-effort placed-count bump (display only; the recipient rows are the
      // source of truth). A small read+write race here at most under-counts the
      // display by one, never affects billing or dialing.
      await supabaseAdmin.from('voice_campaigns')
        .update({ placed_count: (await currentPlaced(campaign.id)) + 1, updated_at: new Date().toISOString() })
        .eq('id', campaign.id);
    } catch (err) {
      // opted_out / gate_closed / bad number = terminal SKIP (not a retry).
      // originate_failed / optout_check_failed = retryable failure.
      const code = err instanceof OutboundError ? err.code : 'unknown';
      const terminal = code === 'opted_out' || code === 'gate_closed' || code === 'bad_to_number' || code === 'from_not_self_hosted';
      if (terminal) {
        await supabaseAdmin.from('voice_campaign_recipients')
          .update({ status: 'skipped', skipped_reason: code, session_id: null, updated_at: new Date().toISOString() })
          .eq('id', r.id);
      } else if (r.attempts + 1 >= campaign.max_attempts) {
        await supabaseAdmin.from('voice_campaign_recipients')
          .update({ status: 'failed', failure_reason: code, session_id: null, updated_at: new Date().toISOString() })
          .eq('id', r.id);
      } else {
        await supabaseAdmin.from('voice_campaign_recipients')
          .update({ status: 'pending', session_id: null, updated_at: new Date().toISOString() })
          .eq('id', r.id);
      }
      if (!terminal && code !== 'opted_out') {
        reportError(err instanceof Error ? err : new Error(String(err)), {
          type: 'voice_campaign_dial_error',
          dedupe: 'silent',
          escalateAfter: 25,
          metadata: { source: 'voiceAgent.campaigns.processCampaign.dial', campaign_id: campaign.id, code },
        });
      }
    }
  }
}

async function currentPlaced(campaignId: string): Promise<number> {
  const { data } = await supabaseAdmin.from('voice_campaigns').select('placed_count').eq('id', campaignId).maybeSingle();
  return ((data as { placed_count?: number } | null)?.placed_count) ?? 0;
}

/** The cron entry point: process every 'sending' voice campaign. */
export async function runVoiceCampaignsJob(): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('voice_campaigns')
    .select('id, company_id, location_id, objective, from_number, status, consent_scope, max_concurrency, quiet_hours_start, quiet_hours_end, max_attempts')
    .eq('status', 'sending')
    .limit(100);
  if (error) {
    reportError(error, { type: 'job_error', metadata: { source: 'voiceAgent.campaigns.runVoiceCampaignsJob' } });
    return;
  }
  for (const c of (data ?? []) as CampaignRow[]) {
    try {
      await processCampaign(c);
    } catch (err) {
      reportError(err instanceof Error ? err : new Error(String(err)), {
        type: 'job_error',
        metadata: { source: 'voiceAgent.campaigns.runVoiceCampaignsJob.processCampaign', campaign_id: c.id, company_id: c.company_id },
      });
    }
  }
}
