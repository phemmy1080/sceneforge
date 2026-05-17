/**
 * Edge TTS voice catalogue
 * Full English voice list — free plan gets first 6, paid plans get all.
 */

export interface VoiceOption {
  id: string          // Edge TTS voice ID
  name: string        // Display name
  gender: 'Male' | 'Female'
  locale: string      // e.g. en-US, en-GB
  accent: string      // e.g. American, British, Australian
  style: string       // e.g. Friendly, Professional, Casual
  free: boolean       // true = available on free plan
}

export const VOICES: VoiceOption[] = [
  // ── FREE TIER (first 6) ──────────────────────────────────────────────────
  { id: 'en-US-GuyNeural',         name: 'Marcus',   gender: 'Male',   locale: 'en-US', accent: 'American',   style: 'Deep, authoritative',    free: true },
  { id: 'en-US-JennyNeural',       name: 'Sophie',   gender: 'Female', locale: 'en-US', accent: 'American',   style: 'Warm, friendly',         free: true },
  { id: 'en-US-ChristopherNeural', name: 'Alex',     gender: 'Male',   locale: 'en-US', accent: 'American',   style: 'Energetic, young',       free: true },
  { id: 'en-GB-RyanNeural',        name: 'Jordan',   gender: 'Male',   locale: 'en-GB', accent: 'British',    style: 'Professional, clear',    free: true },
  { id: 'en-US-AriaNeural',        name: 'Luna',     gender: 'Female', locale: 'en-US', accent: 'American',   style: 'Calm, storytelling',     free: true },
  { id: 'en-AU-WilliamNeural',     name: 'Kai',      gender: 'Male',   locale: 'en-AU', accent: 'Australian', style: 'Casual, conversational', free: true },

  // ── PAID TIER ────────────────────────────────────────────────────────────
  { id: 'en-US-AndrewNeural',      name: 'Andrew',   gender: 'Male',   locale: 'en-US', accent: 'American',   style: 'Warm, conversational',   free: false },
  { id: 'en-US-BrianNeural',       name: 'Brian',    gender: 'Male',   locale: 'en-US', accent: 'American',   style: 'Casual, friendly',       free: false },
  { id: 'en-US-EmmaNeural',        name: 'Emma',     gender: 'Female', locale: 'en-US', accent: 'American',   style: 'Cheerful, engaging',     free: false },
  { id: 'en-US-AvaNeural',         name: 'Ava',      gender: 'Female', locale: 'en-US', accent: 'American',   style: 'Bright, expressive',     free: false },
  { id: 'en-US-SteffanNeural',     name: 'Steffan',  gender: 'Male',   locale: 'en-US', accent: 'American',   style: 'News, authoritative',    free: false },
  { id: 'en-US-MichelleNeural',    name: 'Michelle', gender: 'Female', locale: 'en-US', accent: 'American',   style: 'Friendly, pleasant',     free: false },
  { id: 'en-GB-LibbyNeural',       name: 'Libby',    gender: 'Female', locale: 'en-GB', accent: 'British',    style: 'Warm, clear',            free: false },
  { id: 'en-GB-MaisieNeural',      name: 'Maisie',   gender: 'Female', locale: 'en-GB', accent: 'British',    style: 'Young, friendly',        free: false },
  { id: 'en-GB-SoniaNeural',       name: 'Sonia',    gender: 'Female', locale: 'en-GB', accent: 'British',    style: 'Confident, professional', free: false },
  { id: 'en-AU-NatashaNeural',     name: 'Natasha',  gender: 'Female', locale: 'en-AU', accent: 'Australian', style: 'Natural, friendly',      free: false },
  { id: 'en-CA-ClaraNeural',       name: 'Clara',    gender: 'Female', locale: 'en-CA', accent: 'Canadian',   style: 'Warm, clear',            free: false },
  { id: 'en-CA-LiamNeural',        name: 'Liam',     gender: 'Male',   locale: 'en-CA', accent: 'Canadian',   style: 'Calm, professional',     free: false },
  { id: 'en-IE-ConnorNeural',      name: 'Connor',   gender: 'Male',   locale: 'en-IE', accent: 'Irish',      style: 'Friendly, natural',      free: false },
  { id: 'en-IE-EmilyNeural',       name: 'Emily',    gender: 'Female', locale: 'en-IE', accent: 'Irish',      style: 'Warm, expressive',       free: false },
  { id: 'en-IN-NeerjaNeural',      name: 'Neerja',   gender: 'Female', locale: 'en-IN', accent: 'Indian',     style: 'Friendly, clear',        free: false },
  { id: 'en-IN-PrabhatNeural',     name: 'Prabhat',  gender: 'Male',   locale: 'en-IN', accent: 'Indian',     style: 'Calm, professional',     free: false },
  { id: 'en-NZ-MitchellNeural',    name: 'Mitchell', gender: 'Male',   locale: 'en-NZ', accent: 'New Zealand','style': 'Friendly, casual',     free: false },
  { id: 'en-ZA-LeahNeural',        name: 'Leah',     gender: 'Female', locale: 'en-ZA', accent: 'South African', style: 'Warm, expressive',   free: false },
]

export const FREE_VOICE_IDS = VOICES.filter(v => v.free).map(v => v.id)

export function getAvailableVoices(plan: string): VoiceOption[] {
  const isPaid = ['starter', 'pro', 'studio', 'agency'].includes(plan?.toLowerCase())
  return isPaid ? VOICES : VOICES.filter(v => v.free)
}

export function getVoiceById(id: string): VoiceOption | undefined {
  return VOICES.find(v => v.id === id)
}

export function getVoiceByName(name: string): VoiceOption | undefined {
  return VOICES.find(v => v.name === name)
}
