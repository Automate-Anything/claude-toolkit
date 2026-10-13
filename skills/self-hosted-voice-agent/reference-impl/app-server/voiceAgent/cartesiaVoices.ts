/**
 * The Cartesia voice catalog: the merchant-pickable voice list for the self-hosted
 * phone agent. All Cartesia sonic-3.6 (the top-ranked, most-human TTS as of
 * 2026-09), voice ids pulled from the LIVE Cartesia voices API 2026-10-05 and
 * verified by generating English samples with each.
 *
 * The list is grouped by gender in the UI. gender comes from Cartesia's own
 * `gender` metadata. The Mexican-accent voices are Cartesia's Spanish voices read
 * in English, which gives the slight, natural, "more human" accent the owner asked
 * for. sonic-3.6 is multilingual (44 languages, same model), so any of these speaks
 * the caller's language automatically.
 *
 * CLONED voices (merchant "create your own voice") are NOT here; they live per
 * company in `voice_agent_cloned_voices` and are merged into the pickable list at
 * read time.
 */

export const CARTESIA_MODEL = 'sonic-3.6';

export interface CartesiaCatalogVoice {
  /** Stable key stored on the location (what the picker saves). */
  key: string;
  /** Cartesia voice id for the TTS request. */
  cartesia_id: string;
  /** Display name shown in the picker. */
  name: string;
  gender: 'male' | 'female';
  /** Short accent/flavor label for the UI. */
  accent: string;
  /** One-line character blurb for the picker. */
  description: string;
}

export const CARTESIA_VOICES: CartesiaCatalogVoice[] = [
  // Defaults first.
  { key: 'allie', cartesia_id: '2747b6cf-fa34-460c-97db-267566918881', name: 'Allie', gender: 'female', accent: 'American', description: 'Confident, approachable, natural. Default female.' },
  { key: 'cory', cartesia_id: '41468051-3a85-4b68-92ad-64add250d369', name: 'Cory', gender: 'male', accent: 'American', description: 'Casual, friendly, easygoing. Default male.' },
  // Female.
  { key: 'fernanda', cartesia_id: 'b4b8e2af-6139-466e-a93a-30c20d2e1fc5', name: 'Fernanda', gender: 'female', accent: 'Mexican accent', description: 'Warm Latina with a slight natural accent.' },
  { key: 'daniela', cartesia_id: '5c5ad5e7-1020-476b-8b91-fdcbe9cc313c', name: 'Daniela', gender: 'female', accent: 'Mexican accent', description: 'Soft Latina, gentle accent, very human.' },
  { key: 'emma', cartesia_id: 'f6ff7c0c-e396-40a9-a70b-f7607edb6937', name: 'Emma', gender: 'female', accent: 'American', description: 'Casual, everyday, relaxed.' },
  { key: 'harper', cartesia_id: 'd6c52d6f-6478-47a2-ad54-dbc8f3335a2b', name: 'Harper', gender: 'female', accent: 'US Southern', description: 'Soft, poised Southern warmth.' },
  { key: 'jacqueline', cartesia_id: '9626c31c-bec5-4cca-baa8-f8ba9e84c8bc', name: 'Jacqueline', gender: 'female', accent: 'American', description: 'Young, empathic, reassuring.' },
  // Male.
  { key: 'mateo', cartesia_id: '2fc4f1ec-bfd0-46f1-8e6d-d4279eaaf838', name: 'Mateo', gender: 'male', accent: 'Mexican accent', description: 'Warm Mexican male, genuine tone.' },
  { key: 'archie', cartesia_id: 'ef191366-f52f-447a-a398-ed8c0f2943a1', name: 'Archie', gender: 'male', accent: 'British', description: 'Warm, conversational British, polished.' },
  { key: 'jameson', cartesia_id: 'a5136bf9-224c-4d76-b823-52bd5efcffcc', name: 'Jameson', gender: 'male', accent: 'American', description: 'Laid-back, friendly, onboarding-style.' },
];

export const DEFAULT_FEMALE_KEY = 'allie';
export const DEFAULT_MALE_KEY = 'cory';

const BY_KEY: Record<string, CartesiaCatalogVoice> = Object.fromEntries(CARTESIA_VOICES.map((v) => [v.key, v]));
const BY_ID: Record<string, CartesiaCatalogVoice> = Object.fromEntries(CARTESIA_VOICES.map((v) => [v.cartesia_id, v]));

/** Resolve a stored voice selection (a catalog key, a raw Cartesia id, or null)
 *  to a catalog voice, falling back to the default female. A raw id not in the
 *  catalog (e.g. a cloned voice) returns null so the caller can look it up in the
 *  per-company cloned table. */
export function catalogVoiceFor(selection: string | null | undefined): CartesiaCatalogVoice | null {
  if (!selection) return BY_KEY[DEFAULT_FEMALE_KEY] ?? null;
  return BY_KEY[selection] ?? BY_ID[selection] ?? null;
}

export function defaultVoiceForGender(gender: 'male' | 'female'): CartesiaCatalogVoice {
  return BY_KEY[gender === 'male' ? DEFAULT_MALE_KEY : DEFAULT_FEMALE_KEY];
}
