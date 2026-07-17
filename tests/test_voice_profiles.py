from pathlib import Path

import pytest

from tts.chatterbox_tts.voice_profiles import (
    list_profiles,
    resolve_profile,
    validate_profile_name,
)


@pytest.mark.parametrize("name", ["narrator", "voice-2", "Voice_3", "4thvoice"])
def test_validate_profile_name_accepts_safe_names(name: str) -> None:
    assert validate_profile_name(name) == name


@pytest.mark.parametrize("name", ["", "../voice", "two words", "voice.wav"])
def test_validate_profile_name_rejects_unsafe_names(name: str) -> None:
    with pytest.raises(ValueError):
        validate_profile_name(name)


def test_list_and_resolve_profiles(tmp_path: Path) -> None:
    voice = tmp_path / "narrator.wav"
    voice.write_bytes(b"audio")
    (tmp_path / "ignore.txt").write_text("not audio")

    assert list_profiles(tmp_path) == [{"name": "narrator", "filename": "narrator.wav", "size": 5}]
    assert resolve_profile(tmp_path, "narrator") == voice
    assert resolve_profile(tmp_path, "missing") is None
