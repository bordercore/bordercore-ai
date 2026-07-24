export type TtsReadiness = "loading" | "ready" | "degraded" | "failed";

export interface TtsCapabilities {
  api_version: 1;
  engine: string;
  status: "loading" | "ready" | "degraded" | "failed";
  streaming: boolean;
  audio_format: string;
  sample_rate: number;
  voices: string[];
  default_voice: string | null;
  supports_speed: boolean;
  supports_cloning: boolean;
}

export interface TtsCapabilityState {
  readiness: TtsReadiness;
  capabilities: TtsCapabilities | null;
  voices: string[];
  message: string;
}

interface CacheEntry {
  expiresAt: number;
  value: TtsCapabilityState;
}

const CACHE_TTL_MS = 30_000;
const capabilityCache = new Map<string, CacheEntry>();

function normalizedHost(host: string): string {
  return host.trim().replace(/\/+$/, "");
}

function legacyState(fallbackVoices: string[], message: string): TtsCapabilityState {
  return {
    readiness: "degraded",
    capabilities: null,
    voices: fallbackVoices,
    message,
  };
}

function isCapabilities(value: unknown): value is TtsCapabilities {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TtsCapabilities>;
  return (
    candidate.api_version === 1 &&
    typeof candidate.engine === "string" &&
    ["loading", "ready", "degraded", "failed"].includes(candidate.status ?? "") &&
    typeof candidate.streaming === "boolean" &&
    typeof candidate.audio_format === "string" &&
    typeof candidate.sample_rate === "number" &&
    Array.isArray(candidate.voices) &&
    candidate.voices.every(voice => typeof voice === "string") &&
    (candidate.default_voice === null || typeof candidate.default_voice === "string") &&
    typeof candidate.supports_speed === "boolean" &&
    typeof candidate.supports_cloning === "boolean"
  );
}

export interface DiscoverTtsCapabilitiesOptions {
  fallbackVoices?: string[];
  forceRefresh?: boolean;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
}

export async function discoverTtsCapabilities(
  host: string,
  options: DiscoverTtsCapabilitiesOptions = {}
): Promise<TtsCapabilityState> {
  const baseUrl = normalizedHost(host);
  const fallbackVoices = options.fallbackVoices ?? [];
  if (!baseUrl) {
    return {
      readiness: "failed",
      capabilities: null,
      voices: fallbackVoices,
      message: "No TTS host configured",
    };
  }

  const cached = capabilityCache.get(baseUrl);
  if (!options.forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const fetcher = options.fetcher ?? fetch;
  try {
    const response = await fetcher(`${baseUrl}/capabilities`, {
      signal: options.signal,
      headers: { Accept: "application/json" },
    });
    if (response.status === 404 || response.status === 405) {
      const value = legacyState(
        fallbackVoices,
        "Legacy server; capability discovery is unavailable"
      );
      capabilityCache.set(baseUrl, { value, expiresAt: Date.now() + CACHE_TTL_MS });
      return value;
    }
    if (!response.ok) {
      throw new Error(`Capability request returned HTTP ${response.status}`);
    }

    const payload: unknown = await response.json();
    if (!isCapabilities(payload)) {
      const value = legacyState(
        fallbackVoices,
        "Unrecognized capability response; using configured voices"
      );
      capabilityCache.set(baseUrl, { value, expiresAt: Date.now() + CACHE_TTL_MS });
      return value;
    }

    const value: TtsCapabilityState = {
      readiness: payload.status,
      capabilities: payload,
      voices: payload.voices,
      message: `${payload.engine} · ${payload.status}`,
    };
    capabilityCache.set(baseUrl, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    return {
      readiness: "failed",
      capabilities: null,
      voices: fallbackVoices,
      message: error instanceof Error ? error.message : "TTS capability request failed",
    };
  }
}

export function clearTtsCapabilityCache(): void {
  capabilityCache.clear();
}
