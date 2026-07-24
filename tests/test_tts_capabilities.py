"""Contract tests for the shared TTS capability response."""

import pytest

from tts.capabilities import TTS_CAPABILITY_API_VERSION, build_tts_capabilities


def test_capability_contract_is_stable_and_json_compatible():
    capabilities = build_tts_capabilities(
        engine="example",
        sample_rate=24000,
        voices=["voice-b", "voice-a", "voice-a"],
        default_voice="voice-c",
        supports_speed=True,
        supports_cloning=False,
    )

    assert capabilities == {
        "api_version": TTS_CAPABILITY_API_VERSION,
        "engine": "example",
        "status": "ready",
        "streaming": True,
        "audio_format": "wav_pcm_s16le",
        "sample_rate": 24000,
        "voices": ["voice-a", "voice-b", "voice-c"],
        "default_voice": "voice-c",
        "supports_speed": True,
        "supports_cloning": False,
    }


@pytest.mark.parametrize(
    ("engine", "sample_rate", "message"),
    [
        ("", 24000, "engine is required"),
        ("kokoro", 0, "sample_rate must be positive"),
    ],
)
def test_capability_contract_rejects_invalid_required_fields(
    engine: str,
    sample_rate: int,
    message: str,
):
    with pytest.raises(ValueError, match=message):
        build_tts_capabilities(
            engine=engine,
            sample_rate=sample_rate,
            voices=[],
            default_voice=None,
            supports_speed=False,
            supports_cloning=False,
        )
