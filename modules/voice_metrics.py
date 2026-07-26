"""Validation for privacy-safe voice latency summaries."""

from math import isfinite
from typing import Any


NUMBER_FIELDS = {
    "asrLatencyMs",
    "firstTokenLatencyMs",
    "firstSentenceLatencyMs",
    "firstAudioLatencyMs",
    "totalDurationMs",
    "ttsRealTimeFactor",
    "maxQueueDepth",
    "maxBufferedAudioMs",
    "ttsSegmentCount",
    "vadFrameCount",
    "vadSpeechFrameCount",
    "vadAverageSpeechProbability",
    "vadPeakSpeechProbability",
    "vadConfirmationLatencyMs",
    "vadEndpointDelayMs",
}
OUTCOMES = {"completed", "interrupted", "cancelled", "failed", "misfire"}
SOURCES = {"vad", "manual"}
SEGMENT_NUMBER_FIELDS = {
    "id",
    "requestToFirstByteMs",
    "synthesisDurationMs",
    "audioDurationMs",
    "realTimeFactor",
}
PROBABILITY_FIELDS = {
    "vadAverageSpeechProbability",
    "vadPeakSpeechProbability",
}


def _optional_nonnegative_number(value: Any, field: str) -> int | float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        numeric = float(value)
        if isfinite(numeric) and numeric >= 0:
            return value
    raise ValueError(f"Invalid {field}")


def normalize_voice_metrics(payload: Any) -> dict[str, Any]:
    """Return an allow-listed metrics record or raise ``ValueError``."""
    if not isinstance(payload, dict):
        raise ValueError("Voice metrics must be a JSON object")

    turn_id = payload.get("turnId")
    source = payload.get("source")
    outcome = payload.get("outcome")
    if not isinstance(turn_id, str) or not turn_id or len(turn_id) > 128:
        raise ValueError("Invalid voice turn ID")
    if source not in SOURCES:
        raise ValueError("Invalid voice turn source")
    if outcome not in OUTCOMES:
        raise ValueError("Invalid voice turn outcome")

    normalized: dict[str, Any] = {
        "turnId": turn_id,
        "source": source,
        "outcome": outcome,
    }
    for field in NUMBER_FIELDS:
        normalized[field] = _optional_nonnegative_number(payload.get(field), field)
        if field in PROBABILITY_FIELDS:
            value = normalized[field]
            if value is not None and value > 1:
                raise ValueError(f"Invalid {field}")

    segments = payload.get("ttsSegments")
    if not isinstance(segments, list) or len(segments) > 100:
        raise ValueError("Invalid ttsSegments")
    normalized["ttsSegments"] = [
        {
            field: _optional_nonnegative_number(segment.get(field), f"ttsSegments.{field}")
            for field in SEGMENT_NUMBER_FIELDS
        }
        for segment in segments
        if isinstance(segment, dict)
    ]
    if len(normalized["ttsSegments"]) != len(segments):
        raise ValueError("Invalid ttsSegments")
    return normalized
