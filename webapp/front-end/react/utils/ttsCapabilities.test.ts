import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearTtsCapabilityCache,
  discoverTtsCapabilities,
  TtsCapabilities,
} from "./ttsCapabilities";

const CAPABILITIES: TtsCapabilities = {
  api_version: 1,
  engine: "kokoro",
  status: "ready",
  streaming: true,
  audio_format: "wav_pcm_s16le",
  sample_rate: 24000,
  voices: ["af_heart", "bf_emma"],
  default_voice: "af_heart",
  supports_speed: true,
  supports_cloning: false,
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  clearTtsCapabilityCache();
});

describe("discoverTtsCapabilities", () => {
  it("loads, validates, and briefly caches a versioned capability response", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(CAPABILITIES));

    const first = await discoverTtsCapabilities("https://tts.example/", { fetcher });
    const second = await discoverTtsCapabilities("https://tts.example", { fetcher });

    expect(first).toEqual({
      readiness: "ready",
      capabilities: CAPABILITIES,
      voices: CAPABILITIES.voices,
      message: "kokoro · ready",
    });
    expect(second).toBe(first);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(
      "https://tts.example/capabilities",
      expect.objectContaining({ headers: { Accept: "application/json" } })
    );
  });

  it("supports an explicit refresh", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(CAPABILITIES));

    await discoverTtsCapabilities("https://tts.example", { fetcher });
    await discoverTtsCapabilities("https://tts.example", {
      fetcher,
      forceRefresh: true,
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("uses configured voices for an older server without the endpoint", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({}, 404));

    const result = await discoverTtsCapabilities("https://legacy.example", {
      fetcher,
      fallbackVoices: ["legacy.wav"],
    });

    expect(result.readiness).toBe("degraded");
    expect(result.capabilities).toBeNull();
    expect(result.voices).toEqual(["legacy.wav"]);
    expect(result.message).toContain("Legacy server");
  });

  it("degrades safely for an incompatible contract version", async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({ ...CAPABILITIES, api_version: 2 }));

    const result = await discoverTtsCapabilities("https://future.example", {
      fetcher,
      fallbackVoices: ["fallback"],
    });

    expect(result.readiness).toBe("degraded");
    expect(result.voices).toEqual(["fallback"]);
    expect(result.message).toContain("Unrecognized");
  });

  it("reports failed readiness while retaining compatibility voices", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("server unavailable"));

    const result = await discoverTtsCapabilities("https://offline.example", {
      fetcher,
      fallbackVoices: ["fallback"],
    });

    expect(result).toEqual({
      readiness: "failed",
      capabilities: null,
      voices: ["fallback"],
      message: "server unavailable",
    });
  });
});
