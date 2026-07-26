import { describe, expect, it } from "vitest";

import { validateSpeechTranscript } from "./speechTranscript";

describe("speech transcript validation", () => {
  it.each(["Yes", "No.", "Stop!", "Howdy", "What's up?", "Thank you"])(
    "accepts legitimate short speech: %s",
    text => {
      expect(validateSpeechTranscript(text)).toEqual({ accepted: true, text });
    }
  );

  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["...?!", "punctuation-only"],
    ["[silence]", "non-speech"],
    ["(music)", "non-speech"],
    ["Thank you for watching.", "boilerplate"],
    ["Please subscribe!", "boilerplate"],
    ["Subtitles by Example Studio", "boilerplate"],
  ] as const)("rejects %s as %s", (text, reason) => {
    expect(validateSpeechTranscript(text)).toEqual({ accepted: false, reason });
  });

  it("normalizes harmless surrounding and repeated whitespace", () => {
    expect(validateSpeechTranscript("  what   now  ")).toEqual({
      accepted: true,
      text: "what now",
    });
  });
});
