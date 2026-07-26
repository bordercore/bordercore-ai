import { describe, expect, it } from "vitest";

import { VoiceTurnMetric } from "../hooks/useVoiceMetrics";
import { describeVoiceStatus } from "./VoiceLatencyPanel";

function turn(values: Partial<VoiceTurnMetric> = {}): VoiceTurnMetric {
  return {
    id: "voice-test",
    source: "vad",
    startedAt: 100,
    outcome: "active",
    maxQueueDepth: 0,
    maxBufferedAudioMs: 0,
    vadFrameCount: 0,
    vadSpeechFrameCount: 0,
    vadAverageSpeechProbability: null,
    vadPeakSpeechProbability: null,
    vadEndpointDelayMs: null,
    ttsSegments: [],
    ...values,
  };
}

describe("voice diagnostic status", () => {
  it("describes VAD availability before a turn", () => {
    expect(describeVoiceStatus(undefined, false)).toBe("Off");
    expect(describeVoiceStatus(undefined, true)).toBe("Ready");
  });

  it("describes the active voice pipeline stage", () => {
    expect(describeVoiceStatus(turn(), true)).toBe("Speech detected");
    expect(describeVoiceStatus(turn({ vadConfirmedAt: 200 }), true)).toBe("Listening");
    expect(describeVoiceStatus(turn({ asrStartedAt: 300 }), true)).toBe("Transcribing");
    expect(describeVoiceStatus(turn({ llmRequestedAt: 400 }), true)).toBe("Thinking");
    expect(describeVoiceStatus(turn({ firstAudioAt: 500 }), true)).toBe("Responding");
  });

  it("makes discard outcomes explicit", () => {
    expect(describeVoiceStatus(turn({ outcome: "misfire" }), true)).toBe("Misfire discarded");
    expect(describeVoiceStatus(turn({ outcome: "discarded" }), true)).toBe("Transcript discarded");
  });
});
