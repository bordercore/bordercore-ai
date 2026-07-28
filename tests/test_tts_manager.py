from unittest.mock import Mock

import pytest

from modules.tts_manager import switch_tts_engine


def test_switch_tts_engine_starts_allowlisted_service_and_checks_identity() -> None:
    runner = Mock(return_value=Mock(returncode=0, stdout="", stderr=""))
    response = Mock()
    response.json.return_value = {
        "engine": "qwen3-tts-ggml-q8_0",
        "status": "ready",
    }
    response.raise_for_status.return_value = None
    capability_get = Mock(return_value=response)

    result = switch_tts_engine(
        "qwen3",
        runner=runner,
        capability_get=capability_get,
    )

    assert result["engine"] == "qwen3-tts-ggml-q8_0"
    runner.assert_called_once_with(
        ["systemctl", "--user", "start", "qwen3-tts.service"],
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    capability_get.assert_called_once()


def test_switch_tts_engine_rejects_unmanaged_service() -> None:
    with pytest.raises(ValueError, match="Unsupported managed TTS engine"):
        switch_tts_engine("anything.service")


def test_switch_tts_engine_reports_systemd_failure() -> None:
    runner = Mock(return_value=Mock(returncode=1, stdout="", stderr="unit failed"))

    with pytest.raises(RuntimeError, match="unit failed"):
        switch_tts_engine("chatterbox", runner=runner)
