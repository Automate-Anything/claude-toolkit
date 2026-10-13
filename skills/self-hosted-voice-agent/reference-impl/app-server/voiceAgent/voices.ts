/**
 * Voice resolution for the self-hosted runtime.
 *
 * The operator's saved voice is a Retell-format id (`11labs-Cimo`, see
 * `AI_VOICES` in src/pages/locations/components/ai-settings/constants.ts and
 * `retell_voice_overrides`). Retell aliases ElevenLabs voices behind those ids
 * and never exposes the underlying ElevenLabs voice_id, so the self-hosted
 * engine needs its OWN mapping from the curated catalog to real provider
 * voices. This file is that mapping.
 *
 * Phase 1 (this file): a code catalog keyed by the Retell id, with a per-gender
 * fallback so an unknown id never dead-airs a call. The ElevenLabs ids here are
 * ElevenLabs' public premade voices (stable, present on every account).
 * Superadmin-curated bundles (DB + UI) are Phase 3 in the plan; the runtime
 * reads a RESOLVED VoiceRtVoiceConfig regardless of where it came from, so the
 * source can swap without touching voice-rt.
 *
 * VERIFY before cutover: listen to each mapped ElevenLabs voice against its
 * Retell counterpart via the superadmin Voice tab and adjust the ids here.
 */
import { config } from '../config/env.js';
import type { VoiceBundle } from '../retell/inboundCall/voiceBundle.js';
import type { VoiceEngine, VoiceRtVoiceConfig } from './types.js';
import { CARTESIA_MODEL, catalogVoiceFor, type CartesiaCatalogVoice } from './cartesiaVoices.js';

interface CatalogEntry {
  gender: 'female' | 'male';
  /** ElevenLabs voice_id (engine B). */
  elevenlabs_voice_id: string;
  /** OpenAI Realtime voice name (engine A). */
  openai_voice: string;
}

/** ElevenLabs premade voices (public library). */
const EL_SARAH = 'EXAVITQu4vr4xnSDxMaL';
const EL_RACHEL = '21m00Tcm4TlvDq8ikWAM';
const EL_MATILDA = 'XrExE9yKIg1WjnnlVkGX';
const EL_ALICE = 'Xb7hH8MSUJpSbSDYk0k2';
const EL_ADAM = 'pNInz6obpgDQGcFmaJgB';
const EL_BRIAN = 'nPczCjzI2devNBz1zQrb';
const EL_DANIEL = 'onwK4e9ZLuTAKqWW03F9';
const EL_CHRIS = 'iP95p4xoKVk53GoZ742B';

/**
 * Keyed by the Retell voice id the operator picker stores. The names mirror
 * `AI_VOICES` (Cimo/Grace/Hailey/Nico/Andrew/Brian/Ethan/Gilfoy/Joe/Kathrine)
 * plus the Phase-1.5 presets (Kate/Chloe/Hailey-multilingual).
 */
const CATALOG: Record<string, CatalogEntry> = {
  '11labs-Cimo': { gender: 'female', elevenlabs_voice_id: EL_SARAH, openai_voice: 'marin' },
  '11labs-Grace': { gender: 'female', elevenlabs_voice_id: EL_RACHEL, openai_voice: 'marin' },
  '11labs-Hailey': { gender: 'female', elevenlabs_voice_id: EL_MATILDA, openai_voice: 'marin' },
  '11labs-Kathrine': { gender: 'female', elevenlabs_voice_id: EL_ALICE, openai_voice: 'sage' },
  '11labs-Kate': { gender: 'female', elevenlabs_voice_id: EL_ALICE, openai_voice: 'sage' },
  '11labs-Chloe': { gender: 'female', elevenlabs_voice_id: EL_MATILDA, openai_voice: 'coral' },
  '11labs-Hailey-Latin-America-Spanish-localized': { gender: 'female', elevenlabs_voice_id: EL_MATILDA, openai_voice: 'marin' },
  '11labs-Nico': { gender: 'male', elevenlabs_voice_id: EL_ADAM, openai_voice: 'cedar' },
  '11labs-Andrew': { gender: 'male', elevenlabs_voice_id: EL_BRIAN, openai_voice: 'cedar' },
  '11labs-Brian': { gender: 'male', elevenlabs_voice_id: EL_BRIAN, openai_voice: 'cedar' },
  '11labs-Ethan': { gender: 'male', elevenlabs_voice_id: EL_DANIEL, openai_voice: 'ash' },
  '11labs-Gilfoy': { gender: 'male', elevenlabs_voice_id: EL_CHRIS, openai_voice: 'ash' },
  '11labs-Joe': { gender: 'male', elevenlabs_voice_id: EL_ADAM, openai_voice: 'cedar' },
};

const FEMALE_DEFAULT: CatalogEntry = { gender: 'female', elevenlabs_voice_id: EL_SARAH, openai_voice: 'marin' };
const MALE_DEFAULT: CatalogEntry = { gender: 'male', elevenlabs_voice_id: EL_ADAM, openai_voice: 'cedar' };

/**
 * Map a Retell `voice_model` (eleven_flash_v2_5 / eleven_turbo_v2_5 / eleven_v3 /
 * eleven_multilingual_v2, ...) to the ElevenLabs model id the runtime should
 * stream with. Retell's enum values ARE ElevenLabs model ids, so this is mostly
 * pass-through; anything unknown/non-ElevenLabs falls back to the low-latency
 * phone default.
 */
function elevenLabsModelFor(voiceModel: string | undefined): string {
  if (voiceModel && voiceModel.startsWith('eleven_')) return voiceModel;
  return 'eleven_flash_v2_5';
}

/** Clamp Retell's voice_speed range [0.5, 2] into ElevenLabs' [0.7, 1.2]. */
function clampSpeed(speed: number | undefined): number {
  if (typeof speed !== 'number' || !Number.isFinite(speed)) return 1.0;
  return Math.min(1.2, Math.max(0.7, speed));
}

function normalizeLanguage(language: string | string[] | undefined): string | string[] {
  if (!language) return 'en-US';
  if (Array.isArray(language)) return language.length === 1 ? language[0] : language;
  return language;
}

/** A Cartesia selection is either a catalog key/id, or a cloned voice passed as
 *  `cartesia:<voiceId>` (with an optional `:male`/`:female` gender suffix the
 *  cloned-voice reader appends). Returns the resolved cartesia block + gender, or
 *  null when the selection is not a Cartesia voice (then we fall back to the legacy
 *  ElevenLabs/OpenAI mapping). */
interface CartesiaBlock { voice_id: string; model: string; speed: number; emotion: string; volume: number; }

// Mellow, human defaults (owner feedback 2026-10-06: Cartesia was "wild", too
// energetic/screamy; Retell felt mellow, a little bored, which read as human).
// Slightly slow + neutral tone + normal volume. Tunable per call via the
// bundle's voice_speed / voice_temperature; a per-voice override comes later.
// Calm/mellow, not "powerful" (owner 2026-10-06). Slightly slow pace, a calm
// tone, and volume eased below default so it is not loud on a phone. Tunable by
// ear on a real call.
const DEFAULT_CARTESIA_SPEED = 0.88;
// 'neutral' is a documented, reliably-recognized tone (calm baseline, no
// excitement). Lowering speed + volume does the "calmer, less powerful" work;
// if you want warmer, 'content' is the by-ear next option.
const DEFAULT_CARTESIA_EMOTION = 'neutral';
const DEFAULT_CARTESIA_VOLUME = 0.9;

function cartesiaBlock(voiceId: string, bundle: VoiceBundle): CartesiaBlock {
  return {
    voice_id: voiceId,
    model: CARTESIA_MODEL,
    speed: clampCartesiaSpeed(bundle.voice_speed),
    emotion: DEFAULT_CARTESIA_EMOTION,
    volume: DEFAULT_CARTESIA_VOLUME,
  };
}

function resolveCartesia(bundle: VoiceBundle): { cartesia: CartesiaBlock; gender: 'male' | 'female' } | null {
  const sel = bundle.voice_id || '';
  if (sel.startsWith('cartesia:')) {
    const [, id, g] = sel.split(':');
    if (id) return { cartesia: cartesiaBlock(id, bundle), gender: g === 'male' ? 'male' : 'female' };
  }
  const cat: CartesiaCatalogVoice | null = catalogVoiceFor(sel);
  // catalogVoiceFor falls back to the default female for an empty/unknown selection.
  // Only treat it as Cartesia when the selection actually matched a catalog voice,
  // OR when nothing legacy matches (so a fresh install with no voice set gets the
  // new default voice rather than the old ElevenLabs default).
  const matchedCatalog = cat && (cat.key === sel || cat.cartesia_id === sel);
  if (matchedCatalog && cat) {
    return { cartesia: cartesiaBlock(cat.cartesia_id, bundle), gender: cat.gender };
  }
  return null;
}

/** Cartesia speed: default to a slightly-slow, unhurried pace; clamp to the
 *  model's 0.6-1.5 range. A merchant override (bundle.voice_speed) wins. */
function clampCartesiaSpeed(speed: number | undefined): number {
  if (typeof speed !== 'number' || !Number.isFinite(speed)) return DEFAULT_CARTESIA_SPEED;
  return Math.min(1.5, Math.max(0.6, speed));
}

export function resolveVoiceRtVoice(bundle: VoiceBundle, engine: VoiceEngine): VoiceRtVoiceConfig {
  const entry = CATALOG[bundle.voice_id] ?? (
    /(grace|hailey|cimo|kate|chloe|kathrine|monica|yumi|female)/i.test(bundle.voice_id)
      ? FEMALE_DEFAULT
      : /(nico|andrew|brian|ethan|gilfoy|joe|paul|louie|alejandro|male)/i.test(bundle.voice_id)
        ? MALE_DEFAULT
        : FEMALE_DEFAULT
  );
  const cart = resolveCartesia(bundle);
  return {
    engine,
    source_voice_id: bundle.voice_id,
    gender: cart ? cart.gender : entry.gender,
    ...(cart ? { cartesia: cart.cartesia } : {}),
    elevenlabs: {
      voice_id: entry.elevenlabs_voice_id,
      model: elevenLabsModelFor(bundle.voice_model),
      speed: clampSpeed(bundle.voice_speed),
      // Retell's voice_temperature is the closest analog to ElevenLabs stability
      // (lower temperature = more stable). Default 1 -> stability 0.5.
      stability: typeof bundle.voice_temperature === 'number'
        ? Math.min(1, Math.max(0, 1 - bundle.voice_temperature / 2))
        : 0.5,
      similarity_boost: 0.75,
    },
    openai_realtime: {
      voice: entry.openai_voice,
      model: config.voiceAgentRealtimeModel,
    },
    language: normalizeLanguage(bundle.language),
  };
}
