import { describe, expect, it } from "vitest";

import { DEFAULT_VAD_CONFIG, normalizeVadConfig } from "./vadConfig";

describe("VAD configuration", () => {
  it("uses the conversational defaults when no configuration is saved", () => {
    expect(normalizeVadConfig(null)).toEqual(DEFAULT_VAD_CONFIG);
  });

  it("bounds values and keeps the negative threshold below the positive threshold", () => {
    expect(
      normalizeVadConfig({
        positiveSpeechThreshold: 0.2,
        negativeSpeechThreshold: 0.8,
        redemptionMs: 100,
        preSpeechPadMs: 5000,
        minSpeechMs: 20,
      })
    ).toEqual({
      positiveSpeechThreshold: 0.2,
      negativeSpeechThreshold: 0.15,
      redemptionMs: 300,
      preSpeechPadMs: 1500,
      minSpeechMs: 100,
    });
  });
});
