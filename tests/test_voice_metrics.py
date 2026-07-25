import pytest

from modules.voice_metrics import normalize_voice_metrics


def complete_payload():
    return {
        "turnId": "voice-1",
        "source": "vad",
        "outcome": "completed",
        "asrLatencyMs": 300,
        "firstTokenLatencyMs": 180,
        "firstSentenceLatencyMs": 250,
        "firstAudioLatencyMs": 1100,
        "totalDurationMs": 2900,
        "ttsRealTimeFactor": 0.25,
        "maxQueueDepth": 3,
        "maxBufferedAudioMs": 1200,
        "ttsSegmentCount": 2,
        "ttsSegments": [
            {
                "id": 1,
                "requestToFirstByteMs": 100,
                "synthesisDurationMs": 200,
                "audioDurationMs": 1000,
                "realTimeFactor": 0.2,
            }
        ],
    }


def test_normalize_voice_metrics_allows_only_expected_fields():
    payload = complete_payload()
    payload["transcript"] = "private text"

    normalized = normalize_voice_metrics(payload)

    assert normalized == complete_payload()
    assert "transcript" not in normalized


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("source", "unknown"),
        ("outcome", "active"),
        ("totalDurationMs", -1),
        ("ttsRealTimeFactor", float("inf")),
    ],
)
def test_normalize_voice_metrics_rejects_invalid_values(field, value):
    payload = complete_payload()
    payload[field] = value

    with pytest.raises(ValueError):
        normalize_voice_metrics(payload)
