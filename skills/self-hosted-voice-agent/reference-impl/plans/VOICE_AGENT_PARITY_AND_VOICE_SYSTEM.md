# Voice Agent: Retell Parity + Cartesia Voice System (plan + ledger)

> Agent-facing SOT + live ledger. Sibling of `SELF_HOSTED_VOICE_AGENT_PLATFORM_PLAN.md`
> (that is the big map; THIS is the focused execution ledger for the work started
> 2026-10-05). Keep every row's status current: TODO / DOING / DONE / BLOCKED.
> Owner: the founder. Rule from owner 2026-10-05: "don't stop until every single thing is
> fully implemented." Verify by the live DB + live API, never from memory.

---

## 0. The goal, in the owner's words

1. **100% Retell parity, proven by a real test.** Every tool, every function, the
   same system prompts, the same infrastructure must work on the self-hosted
   (Pipecat) system exactly as on Retell. "Verified by reading code" is NOT done;
   a real call that exercises each piece is the bar.
2. **Cartesia voices** (sonic-3.6, the top-ranked most-human TTS as of 2026-09).
   The real picked voices, not the OpenAI TTS that sounded terrible. Default male +
   default female already chosen (Cory + Allie). A LIST of ~10 voices grouped by
   gender for the merchant to pick, including slight-accent options (Mexican) that
   read as more human.
3. **Name follows nothing new** - owner 2026-10-05: there are already TWO default
   names (one male, one female). DO NOT add gendered-name generation or change the
   naming logic. Leave the existing defaults exactly as they are.
4. **Multilingual = automatic, NO toggle** - owner 2026-10-05: sonic-3.6 is the same
   model + same quality across 44 languages, so a toggle that does nothing is
   pointless. If the caller speaks Spanish, the agent just answers in Spanish.
   Detect the caller's language and respond in it. No setting.
5. **Loudness normalization** - proven necessary: Cartesia returns different voices
   at very different loudness (Allie ~9.5 dB louder than Cory), which unbalances the
   ambience and makes a voice sound hot/less human. Normalize every voice to a target
   (~-16 LUFS) before it hits the wire, so the room sits identically under any voice.
6. **Ambience** - real CC0 recordings (office bed + keyboard typing), typing swells
   only while a tool runs. Already built as a mixer; swap synthesized -> real files.
7. **Create your own voice (cloning)** - Cartesia `/voices/clone`: the MERCHANT
   provides the sample (record per on-screen instructions, or upload a file), we
   clone via Cartesia, store the voice id against their company, it appears in their
   list. Instant, no training wait. Capture a consent record.
8. **Operator voice-picker UI** - merchant hears each voice (grouped by gender) and
   picks. Gated behind the same agent test-gate so merchants see it only at go-live.

### Decisions made without a round-trip (owner said don't stop)
- Voice catalog lives as code (static list) + a per-company table for CLONED voices.
- Cartesia is the chained-tier TTS. The Lifelike (s2s / OpenAI Realtime) tier keeps
  its own fused voice (can't use a Cartesia voice id); the Cartesia voice list is the
  STANDARD/chained path, which is now the real voice experience.
- Voice picker + cloning ship operator-facing but GATED behind the ONE gate below
  (reversible, consistent with "test first"). Noted here as the scope call.
- Default receptionist names: unchanged (owner rule 3).

### ⛔ THE GATE MODEL - owner 2026-10-05 (TWO PHASES)
The gate is a TEMPORARY, superadmin-controlled, PER-COMPANY testing switch whose end
state is to be REMOVED entirely.

**Phase 1 - NOW (testing), per-company switch in the SUPERADMIN PORTAL.**
- The owner turns the self-hosted system ON for ONE company at a time, from the
  superadmin portal, tests it live on that company's number while EVERY OTHER company
  stays on Retell. Fails SAFE to Retell for any company not switched on, and on any
  read error.
- This is essentially the ALREADY-BUILT per-company flag `self_hosted_voice_agent` in
  `retell_prompt_flags` (company_ids[]), flipped from the superadmin Retell page. The
  inbound resolve checks: is THIS company in the flag? -> self-hosted. Else -> Retell.
- Keep the `VOICE_AGENT_ENABLED` env master-kill as the top-level safety (already true
  on dev). The per-number ai_provider switch is NOT needed in this model: membership in
  the flag is what routes a company, so build the inbound path to route a flagged
  company to self-hosted regardless of ai_provider.

**Phase 2 - LATER (proven), remove the switch -> everyone.**
- When the owner says it is good, he tells the agent to "shut off the switch", meaning
  REMOVE the gate: the self-hosted system becomes the default for ALL companies and
  Retell is retired. No per-company flag, no env master, no toggle. Just the system.
- Build Phase 1 so this removal is a SMALL, clean change (one routing function returns
  "self-hosted" unconditionally), not a deep unwind. Keep the gate check in ONE place.

Implementation: ONE routing helper `shouldUseSelfHosted(companyId)` = (Phase 1) company
in the flag AND master env on; (Phase 2) `return true`. Everything (inbound answer,
voice picker visibility, cloning) keys off that ONE helper so Phase 2 is a one-line flip.
Build task in section 2f.

---

## 1. VERIFICATION CHECKLIST - Retell parity (prove each on a real call) [TODO]

This is the "100%" definition. Nothing is "done" until each row is ticked on a
LIVE test call (or proven impossible-to-break in code with a reason).

### 1a. Infrastructure (same system underneath)
- [ ] Inbound call reaches voice-rt via SignalWire cXML `<Connect><Stream>` (not SIP).
- [ ] session_id handshake: minted by app-server, echoed by SignalWire, claimed
      by voice-rt (Parameter primary + `?session_id=` query fallback).
- [ ] voice-rt <-> app-server auth (X-Voice-Agent-Secret) on every hop.
- [ ] Gate enforced (master switch + company flag + number provider=pipecat).

### 1b. Same system prompts (the multi-prompt STATE machine)
Live states (pulled 2026-10-05): starter, booking, cancel, update, confirmation,
questions, name + the waitlist_section fragment. The deliberate typo
`cnformation` is a tool name, not a slot.
- [ ] Starter prompt drives the opening (greeting / begin-message parity).
- [ ] State switch works: booking_agent_transfer / cancel_agent_transfer /
      update_agent_transfer / cnformation_agent_transfer / question_agent_transfer /
      name_agent_transfer each swap the system prompt and the agent behaves per the
      new state. (In-place prompt swap VERIFY flagged in build.py.)
- [ ] Dynamic variables substituted (contact, schedule, next appt, packages, etc.).

### 1c. Every tool / function (the 14 chat tools + 5 voice-only), each must dispatch
to its REAL handler and return a correct result on a live call:
- [ ] checkAvailability -> /api/calendar-functions check_availability
- [ ] checkAvailabilityRecurring (+ alias check_availability_recurring) -> check_availability_recurring
- [ ] CreateAppointment -> /api/agent/booking-chat (books a REAL test appt)
- [ ] CancelAppointment -> /api/calendar-functions cancel_appointment
- [ ] UpdateAppointment -> /api/agent/reschedule-chat
- [ ] findAppointments -> /api/ai/find-appointments
- [ ] ListAppointments -> /api/ai/appointments-by-date
- [ ] verifyDayMatchesDate -> in-process helper
- [ ] AddToWaitlist -> addToWaitlist
- [ ] SendPurchaseLink -> sendPurchaseLink (SMS link arrives)
- [ ] SendMembershipPurchaseLink -> sendMembershipPurchaseLink
- [ ] SendGiftCardLink -> sendGiftCardLink
- [ ] CheckPaymentStatus -> checkPaymentStatus
- [ ] UpsertNameInContacts -> /api/ai/contacts-upsert
- [ ] set_caller_identity -> resolveCallerIdentity (multi-contact disambiguation pins contact)
- [ ] transfer_call -> SignalWire modify-call -> human (warm/cold)
- [ ] end_call -> graceful hangup
- [ ] mark_do_not_call -> voice_call_opt_outs (customer number, direction-correct)

### 1d. Post-call capture (everything into the system, same as Retell)
- [ ] call_history row written (via shared processPostCallAnalysis)
- [ ] recording uploaded + plays in the existing UI
- [ ] summary present
- [ ] sentiment present
- [ ] caller-name backfill
- [ ] call_successful / in_voicemail / disconnect reason
- [ ] latency + token usage + tool_calls in metadata
- [ ] usage row (minutes) for billing
- [ ] summary email sent

### 1e. The failure/edge paths
- [ ] Gate closed -> human fallback (never dead air)
- [ ] Out-of-funds / AI-off / blocked number -> transfer or hangup like today
- [ ] Provider failure mid-call alerts (reportError wiring, built 2026-09-23)

---

## 2. CARTESIA VOICE SYSTEM - build [TODO]

### 2a. voice-rt: Cartesia as the chained-tier TTS [TODO]
- [ ] Add CartesiaTTSService to the chained pipeline (build.py `_build_chained`),
      swapping/﻿choosing it over ElevenLabs when the resolved voice is a Cartesia id.
- [ ] CARTESIA_API_KEY on voice-rt Render (+ in config.py, already declared).
- [ ] Loudness normalization on TTS output (~-16 LUFS) before transport.
- [ ] Cartesia-Version header + sonic-3.6 model pinned.

### 2b. Voice catalog (data) [TODO]
The 10 picked voices (all en / read-English), each: cartesia_id, display name,
gender (from Cartesia `gender` field), accent label. VERIFIED ids pulled live
2026-10-05:
- Allie (F, American) 2747b6cf-fa34-460c-97db-267566918881  [default F]
- Cory  (M, American) 41468051-3a85-4b68-92ad-64add250d369  [default M]
- Fernanda (F, Mexican accent) b4b8e2af-6139-466e-a93a-30c20d2e1fc5
- Mateo (M, Mexican accent) 2fc4f1ec-bfd0-46f1-8e6d-d4279eaaf838
- Daniela (F, Mexican accent) 5c5ad5e7-1020-476b-8b91-fdcbe9cc313c
- Archie (M, British) ef191366-f52f-447a-a398-ed8c0f2943a1
- Emma (F, American) f6ff7c0c-e396-40a9-a70b-f7607edb6937
- Harper/Southern (F, US Southern) d6c52d6f-6478-47a2-ad54-dbc8f3335a2b
- Jacqueline (F, American) 9626c31c-bec5-4cca-baa8-f8ba9e84c8bc
- Jameson (M, American) a5136bf9-224c-4d76-b823-52bd5efcffcc
- [ ] Encode as a shared catalog (code) + map a picked voice -> VoiceRtVoiceConfig.
- [ ] voices.ts (app-server) gains a Cartesia branch alongside ElevenLabs/OpenAI.

### 2c. Automatic multilingual (no toggle) [TODO]
- [ ] voice-rt passes the detected language to Cartesia per utterance (sonic-3.6
      is 44-lang, same model). STT (Deepgram) language detection -> TTS language.
- [ ] No setting, no flag. Caller speaks X, agent answers X.

### 2d. Operator voice-picker UI (gated) [TODO]
- [ ] A settings panel: voices grouped Male / Female, a play-sample button each,
      pick one. Stored per location (existing ai_voice_id field or a new column).
- [ ] Gated behind the agent test-gate (merchants see it only at go-live).

### 2e. Create your own voice (cloning) [TODO]
- [ ] UI button "Create your own voice" with on-screen record/upload instructions +
      a consent checkbox/record.
- [ ] app-server endpoint: accept the clip, POST Cartesia /voices/clone
      (multipart: clip, name, language), store returned voice id in a per-company
      cloned-voices table, add to their list.
- [ ] Consent record stored.

### 2f. The per-company gate (Phase 1) + the ONE routing helper [DOING]
- [x] Per-company flag `self_hosted_voice_agent` in retell_prompt_flags already exists
      + the superadmin Self-hosted tab already flips it (built 2026-09). REUSE.
- [ ] Add ONE helper `shouldUseSelfHosted(companyId)` = master env on AND company in the
      flag. Every routing/visibility decision keys off this one helper (so Phase 2 =
      change it to `return true`).
- [ ] Inbound routing: a company in the flag goes to self-hosted REGARDLESS of the
      number's ai_provider (membership in the flag is what routes, per owner's model).
      Verify voice/inboundLaml.ts + resolve path call the helper.
- [ ] Superadmin UI: make the per-company on/off obvious on the Retell page (the flag
      tab exists; ensure it clearly reads "test self-hosted for this company").
- [ ] Phase 2 (owner says go): flip the helper to unconditional, retire Retell per the
      DROP rules with owner sign-off. Tracked, NOT done now.

---

## IMPLEMENTATION STATUS (2026-10-05, this build session)
DONE + typecheck/compile-clean (app-server tsc exit 0, voice-rt py-compile ok):
- [x] Cartesia TTS in voice-rt (`_build_tts`, Cartesia preferred, ElevenLabs fallback).
- [x] Voice catalog `cartesiaVoices.ts` (10 voices, gender-grouped, real ids).
- [x] `resolveVoiceRtVoice` emits the `cartesia` block + cloned-voice `cartesia:<id>` path.
- [x] Automatic multilingual: Deepgram `multi` + MULTILINGUAL_DIRECTIVE on every prompt.
- [x] Real CC0 ambience bundled (office+typing, 8k+24k) + mixer loads them, crossfade loop.
- [x] ONE gate helper `shouldUseSelfHosted(companyId,locationId)` (Phase 2 = return true).
- [x] Inbound routing rewired (inboundLaml.ts): a flagged company -> self-hosted on ALL
      AI paths regardless of ai_provider, fails safe to Retell. Two decision sites updated.
- [x] Cloned-voices migration WRITTEN (20261005_120000_voice_agent_cloned_voices.sql) NOT APPLIED.
- [x] Operator backend routes: GET /api/voice-agent/voices (list, gated), PUT /select,
      POST /clone (Cartesia /voices/clone, base64 upload, consent required). Mounted.
- [x] config.cartesiaApiKey added; CARTESIA_API_KEY set on voice-rt Render.

- [x] APPLIED the cloned-voices migration 2026-10-05 (owner-approved; verified table
      absent + deps present first; 11 cols, 4 policies, RLS on, 7 grants). gen-types done.
- [x] Operator voice-picker + "create your own voice" UI: SelfHostedVoicePicker.tsx
      (voices grouped by gender, play/select, clone dialog with record-or-upload +
      consent), GATED (renders nothing unless server says company switched on). Wired
      into PhoneAgentSettingsTab. Backend routes: GET / , PUT /select, POST /sample,
      POST /clone. ALL GREEN: billing tsc 0, frontend tsc 0, voice-rt py-compile ok,
      i18n audit 0 missing.

OUTSTANDING (deploy + the owner's test):
- [ ] Deploy: push working tree to dev (voice-rt builds from dev; app-server dev
      + voice-rt redeploy). Nothing is live until this.
- [ ] The live PARITY TEST (section 1) on a flagged test company - the real proof,
      owner-run (flip one company on in superadmin, place a call, tick every row).

## TUNING PASS (2026-10-06, owner feedback from a live test call)
All compile/typecheck-clean; deploy pending.
- [x] BEGIN MESSAGE (static first line, Retell parity): `renderBeginMessage` sets
      session.greeting = "{location_name}, this is {receptionist_name} speaking, how
      can I help you?". voice-rt kick_off speaks it verbatim BEFORE the LLM (was
      improvising, e.g. "Example Barber Shop"). Location name = business name.
- [x] BACKGROUND NOISE too loud on a phone -> ROOM_TONE_VOLUME 0.12 -> 0.035,
      TYPING 0.55 -> 0.22 (ambient.py). Faint "live line" presence only.
- [x] VOICE calmer/less powerful: Cartesia generation_config defaults speed 0.88,
      emotion 'neutral', volume 0.9 (voices.ts). Tunable; 'content' is the warmer
      by-ear option. generation_config wired in build.py (guarded import).
- [x] MAX CALL DURATION 60m -> 10m (owner: Retell 7m, bump to 10m).
- [x] POST-CALL EXTRACTION = the owner's EXACT Retell prompts (postCall.ts): summary
      rules keyed to business_type, call_successful criteria (voluntary-exit=success,
      incomplete!=failure, frustration-only), sentiment, user_name fill-in.
- [x] BACKCHANNELING via community BSD-2 `pipecat-backchannel>=0.3.3` (compatible
      pipecat 1.x). Wired into _build_chained (guarded, toggle via settings.backchannel
      =false). INFREQUENT per owner: fire_probability 0.3, cooldown 12s, eligible after
      2.5s of caller speech. Clips synth'd in the bot's own Cartesia voice, prewarmed
      in background. NOT built from scratch (owner: grab a public repo).
- [ ] STILL TO TUNE BY EAR (need owner's exact Retell values): interruption
      sensitivity (Retell 0.9) -> VAD/turn stop_secs; endpointing (Retell 0.16s);
      denoising ("remove noise + background speech") -> a Pipecat input filter to add;
      end-on-silence (37s) / ring (30s). Owner offered to share exact Retell values.
- [ ] Deploy the batch (app-server dev builds the session/voice config; voice-rt
      needs the new deps [pipecat-backchannel] + code -> redeploy with cache clear).
- [ ] AGENT-TO-AGENT HANDOFF: align the state-switch instruction to Retell's
      "you are a new assistant joining an ongoing conversation, don't repeat greetings,
      address the last request immediately" (owner shared the exact Retell handoff text).

## 3. STATUS LOG
- 2026-10-05: Doc created. Cartesia key in .env.local (<key prefix>), verified live
  (Cory/Allie/candidates generated). 10 voice ids pulled from the live Cartesia API
  (1026 voices, 432 en). Ambience built as a mixer (synthesized; real CC0 files
  downloaded + converted, swap pending). Loudness imbalance diagnosed + normalization
  validated. Voice picker + candidate samples auditioned via artifacts. Cloning API
  confirmed (POST /voices/clone, instant). STARTING implementation per owner.
