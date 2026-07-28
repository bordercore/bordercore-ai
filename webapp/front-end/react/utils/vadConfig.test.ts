import { describe, expect, it } from "vitest";

import {
  DEFAULT_VAD_CONFIG,
  identifyVadPreset,
  normalizeVadConfig,
  VAD_PRESETS,
} from "./vadConfig";

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
      speculativeAsr: true,
      speculationMs: 200,
    });
  });

  it("keeps speculation inside the endpoint silence window", () => {
    expect(
      normalizeVadConfig({
        ...DEFAULT_VAD_CONFIG,
        redemptionMs: 600,
        speculationMs: 900,
        speculativeAsr: false,
      })
    ).toMatchObject({
      speculativeAsr: false,
      speculationMs: 500,
    });
  });

  it("identifies each preset and treats manual changes as custom", () => {
    for (const [name, preset] of Object.entries(VAD_PRESETS)) {
      expect(identifyVadPreset(preset.config)).toBe(name);
    }
    expect(identifyVadPreset({ ...DEFAULT_VAD_CONFIG, redemptionMs: 1100 })).toBe("custom");
  });

  it("provides usage guidance for every preset", () => {
    for (const preset of Object.values(VAD_PRESETS)) {
      expect(preset.bestFor.length).toBeGreaterThan(20);
      expect(preset.tradeoff.length).toBeGreaterThan(20);
    }
  });
});
