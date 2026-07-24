"""Shared versioned capability contract for maintained TTS services."""

from __future__ import annotations

from typing import Literal, TypedDict

TTS_CAPABILITY_API_VERSION = 1
TtsStatus = Literal["loading", "ready", "degraded", "failed"]


class TtsCapabilities(TypedDict):
    api_version: int
    engine: str
    status: TtsStatus
    streaming: bool
    audio_format: str
    sample_rate: int
    voices: list[str]
    default_voice: str | None
    supports_speed: bool
    supports_cloning: bool


def build_tts_capabilities(
    *,
    engine: str,
    sample_rate: int,
    voices: list[str],
    default_voice: str | None,
    supports_speed: bool,
    supports_cloning: bool,
    status: TtsStatus = "ready",
) -> TtsCapabilities:
    """Build a stable JSON-compatible response shared by every TTS engine."""
    if not engine.strip():
        raise ValueError("engine is required")
    if sample_rate <= 0:
        raise ValueError("sample_rate must be positive")

    normalized_voices = sorted({voice.strip() for voice in voices if voice.strip()})
    if default_voice and default_voice not in normalized_voices:
        normalized_voices.append(default_voice)
        normalized_voices.sort()

    return {
        "api_version": TTS_CAPABILITY_API_VERSION,
        "engine": engine,
        "status": status,
        "streaming": True,
        "audio_format": "wav_pcm_s16le",
        "sample_rate": sample_rate,
        "voices": normalized_voices,
        "default_voice": default_voice,
        "supports_speed": supports_speed,
        "supports_cloning": supports_cloning,
    }
