export interface VadConfig {
  positiveSpeechThreshold: number;
  negativeSpeechThreshold: number;
  redemptionMs: number;
  preSpeechPadMs: number;
  minSpeechMs: number;
}

export const DEFAULT_VAD_CONFIG: VadConfig = {
  positiveSpeechThreshold: 0.3,
  negativeSpeechThreshold: 0.25,
  redemptionMs: 900,
  preSpeechPadMs: 800,
  minSpeechMs: 250,
};

const STORAGE_KEY = "vadConfig";

function bounded(value: unknown, minimum: number, maximum: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

export function normalizeVadConfig(value: Partial<VadConfig> | null | undefined): VadConfig {
  const positive = bounded(
    value?.positiveSpeechThreshold,
    0.1,
    0.9,
    DEFAULT_VAD_CONFIG.positiveSpeechThreshold
  );
  const negative = Math.min(
    Math.round((positive - 0.05) * 100) / 100,
    bounded(value?.negativeSpeechThreshold, 0.05, 0.85, DEFAULT_VAD_CONFIG.negativeSpeechThreshold)
  );
  return {
    positiveSpeechThreshold: positive,
    negativeSpeechThreshold: Math.max(0.05, negative),
    redemptionMs: bounded(value?.redemptionMs, 300, 3000, DEFAULT_VAD_CONFIG.redemptionMs),
    preSpeechPadMs: bounded(value?.preSpeechPadMs, 0, 1500, DEFAULT_VAD_CONFIG.preSpeechPadMs),
    minSpeechMs: bounded(value?.minSpeechMs, 100, 1000, DEFAULT_VAD_CONFIG.minSpeechMs),
  };
}

export function loadVadConfig(): VadConfig {
  if (typeof window === "undefined") return DEFAULT_VAD_CONFIG;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return normalizeVadConfig(saved ? JSON.parse(saved) : null);
  } catch {
    return DEFAULT_VAD_CONFIG;
  }
}

export function saveVadConfig(config: VadConfig): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeVadConfig(config)));
}
