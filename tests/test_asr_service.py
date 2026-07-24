"""Tests for the lifecycle-managed speech recognition service."""

from concurrent.futures import ThreadPoolExecutor
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from modules.asr_service import SpeechTranscriptionService


@pytest.fixture()
def mocked_asr():
    runner = MagicMock(return_value={"text": " hello"})
    model = MagicMock()
    processor = MagicMock()
    processor.tokenizer = object()
    processor.feature_extractor = object()

    with (
        patch("modules.asr_service.torch.cuda.is_available", return_value=False),
        patch(
            "modules.asr_service.AutoModelForSpeechSeq2Seq.from_pretrained",
            return_value=model,
        ) as load_model,
        patch(
            "modules.asr_service.AutoProcessor.from_pretrained",
            return_value=processor,
        ) as load_processor,
        patch("modules.asr_service.pipeline", return_value=runner) as make_pipeline,
    ):
        yield runner, model, load_model, load_processor, make_pipeline


def test_pipeline_is_reused_across_transcriptions(mocked_asr):
    runner, _, load_model, load_processor, make_pipeline = mocked_asr
    service = SpeechTranscriptionService(device="cpu")
    waveform = np.zeros(1600, dtype=np.float32)

    assert service.transcribe(waveform) == " hello"
    assert service.transcribe(waveform) == " hello"

    load_model.assert_called_once()
    load_processor.assert_called_once()
    make_pipeline.assert_called_once()
    assert runner.call_count == 2
    assert service.status()["transcription_count"] == 2
    assert service.status()["state"] == "ready"


def test_concurrent_requests_share_load_and_serialize_inference(mocked_asr):
    runner, _, load_model, _, _ = mocked_asr
    active_calls = 0
    max_active_calls = 0

    def transcribe(_waveform, return_timestamps):
        nonlocal active_calls, max_active_calls
        assert return_timestamps is True
        active_calls += 1
        max_active_calls = max(max_active_calls, active_calls)
        active_calls -= 1
        return {"text": " serialized"}

    runner.side_effect = transcribe
    service = SpeechTranscriptionService(device="cpu")
    waveform = np.zeros(1600, dtype=np.float32)

    with ThreadPoolExecutor(max_workers=3) as executor:
        results = list(executor.map(service.transcribe, [waveform] * 3))

    assert results == [" serialized"] * 3
    assert load_model.call_count == 1
    assert max_active_calls == 1


def test_unload_releases_pipeline_and_next_request_reloads(mocked_asr):
    _, _, load_model, _, _ = mocked_asr
    service = SpeechTranscriptionService(device="cpu")
    waveform = np.zeros(1600, dtype=np.float32)

    service.transcribe(waveform)
    service.unload()
    assert service.status()["state"] == "unloaded"

    service.transcribe(waveform)
    assert load_model.call_count == 2


def test_idle_timeout_is_scheduled_and_can_be_disabled(mocked_asr):
    service = SpeechTranscriptionService(device="cpu", idle_timeout_minutes=15)

    with patch("modules.asr_service.threading.Timer") as timer_class:
        timer = timer_class.return_value
        service.load()

        timer_class.assert_called_once()
        assert timer_class.call_args.args[0] == 15 * 60
        assert timer.daemon is True
        timer.start.assert_called_once()

        service.set_idle_timeout(None)
        timer.cancel.assert_called_once()
        assert service.status()["idle_timeout_minutes"] is None
        assert service.status()["idle_seconds_remaining"] is None


def test_completed_transcription_restarts_idle_timeout(mocked_asr):
    service = SpeechTranscriptionService(device="cpu", idle_timeout_minutes=5)

    with patch("modules.asr_service.threading.Timer") as timer_class:
        first_timer = MagicMock()
        second_timer = MagicMock()
        timer_class.side_effect = [first_timer, second_timer]

        service.transcribe(np.zeros(1600, dtype=np.float32))

        assert timer_class.call_count == 2
        first_timer.cancel.assert_called_once()
        second_timer.start.assert_called_once()


def test_rejects_invalid_idle_timeout():
    with pytest.raises(ValueError, match="positive or None"):
        SpeechTranscriptionService(idle_timeout_minutes=0)


def test_load_failure_is_visible_in_status():
    service = SpeechTranscriptionService(device="cpu")
    with patch(
        "modules.asr_service.AutoModelForSpeechSeq2Seq.from_pretrained",
        side_effect=RuntimeError("model unavailable"),
    ):
        with pytest.raises(RuntimeError, match="model unavailable"):
            service.load()

    status = service.status()
    assert status["state"] == "failed"
    assert status["error"] == "model unavailable"


def test_rejects_unavailable_cuda_device():
    service = SpeechTranscriptionService(device="cuda")
    with patch("modules.asr_service.torch.cuda.is_available", return_value=False):
        with pytest.raises(RuntimeError, match="CUDA is unavailable"):
            service.load()

    assert service.status()["state"] == "failed"
