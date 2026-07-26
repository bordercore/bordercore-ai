export type SpeechTranscriptRejection = "empty" | "punctuation-only" | "non-speech" | "boilerplate";

export type SpeechTranscriptValidation =
  | { accepted: true; text: string }
  | { accepted: false; reason: SpeechTranscriptRejection };

const NON_SPEECH_LABEL = /^[[(]\s*(?:blank audio|inaudible|music|noise|silence)\s*[\])]$/iu;
const WHISPER_BOILERPLATE = [
  /^(?:thank you|thanks) for watching[.!]?$/iu,
  /^please (?:like and )?subscribe[.!]?$/iu,
  /^subtitles? (?:by|made by|provided by) .+$/iu,
  /^amara\.org(?: community)?[.!]?$/iu,
];

export function validateSpeechTranscript(value: unknown): SpeechTranscriptValidation {
  if (typeof value !== "string") return { accepted: false, reason: "empty" };
  const text = value.trim().replace(/\s+/gu, " ");
  if (!text) return { accepted: false, reason: "empty" };
  if (!/[\p{L}\p{N}]/u.test(text)) {
    return { accepted: false, reason: "punctuation-only" };
  }
  if (NON_SPEECH_LABEL.test(text)) {
    return { accepted: false, reason: "non-speech" };
  }
  if (WHISPER_BOILERPLATE.some(pattern => pattern.test(text))) {
    return { accepted: false, reason: "boilerplate" };
  }
  return { accepted: true, text };
}
