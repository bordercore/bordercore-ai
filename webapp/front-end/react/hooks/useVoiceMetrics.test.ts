import { describe, expect, it } from "vitest";

import {
  asrHeadStart,
  averageTtsRealTimeFactor,
  durationBetween,
  summarizeVoiceTurn,
  VoiceTurnMetric,
} from "./useVoiceMetrics";

const completedTurn: VoiceTurnMetric = {
  id: "voice-1",
  source: "vad",
  startedAt: 100,
  speechEndedAt: 500,
  vadConfirmedAt: 350,
  asrStartedAt: 510,
  transcriptionReadyAt: 800,
  llmRequestedAt: 820,
  firstTokenAt: 1000,
  firstSentenceAt: 1250,
  firstAudioAt: 1600,
  completedAt: 3000,
  outcome: "completed",
  maxQueueDepth: 3,
  maxBufferedAudioMs: 1200,
  vadFrameCount: 20,
  vadSpeechFrameCount: 15,
  vadAverageSpeechProbability: 0.68,
  vadPeakSpeechProbability: 0.97,
  vadEndpointDelayMs: 900,
  ttsSegments: [
    {
      id: 1,
      requestedAt: 1250,
      firstByteAt: 1350,
      completedAt: 1450,
      audioDurationMs: 1000,
    },
    {
      id: 2,
      requestedAt: 1500,
      firstByteAt: 1600,
      completedAt: 1800,
      audioDurationMs: 1000,
    },
  ],
};

describe("voice metrics", () => {
  it("calculates durations only when both boundaries exist", () => {
    expect(durationBetween(100, 350)).toBe(250);
    expect(durationBetween(undefined, 350)).toBeNull();
    expect(durationBetween(350, 100)).toBe(0);
  });

  it("calculates aggregate TTS real-time factor", () => {
    expect(averageTtsRealTimeFactor(completedTurn)).toBe(0.25);
  });

  it("reports only ASR work that began before the confirmed endpoint", () => {
    expect(asrHeadStart(completedTurn)).toBe(0);
    expect(asrHeadStart({ ...completedTurn, asrStartedAt: 200 })).toBe(300);
  });

  it("produces a structured turn summary", () => {
    expect(summarizeVoiceTurn(completedTurn)).toEqual({
      turnId: "voice-1",
      source: "vad",
      outcome: "completed",
      outcomeReason: null,
      asrLatencyMs: 300,
      asrHeadStartMs: 0,
      firstTokenLatencyMs: 180,
      firstSentenceLatencyMs: 250,
      firstAudioLatencyMs: 1100,
      totalDurationMs: 2900,
      ttsRealTimeFactor: 0.25,
      maxQueueDepth: 3,
      maxBufferedAudioMs: 1200,
      vadFrameCount: 20,
      vadSpeechFrameCount: 15,
      vadAverageSpeechProbability: 0.68,
      vadPeakSpeechProbability: 0.97,
      vadConfirmationLatencyMs: 250,
      vadEndpointDelayMs: 900,
      ttsSegmentCount: 2,
      ttsSegments: [
        {
          id: 1,
          requestToFirstByteMs: 100,
          synthesisDurationMs: 200,
          audioDurationMs: 1000,
          realTimeFactor: 0.2,
        },
        {
          id: 2,
          requestToFirstByteMs: 100,
          synthesisDurationMs: 300,
          audioDurationMs: 1000,
          realTimeFactor: 0.3,
        },
      ],
    });
  });
});
