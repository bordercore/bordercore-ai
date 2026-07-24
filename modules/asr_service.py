"""Lifecycle-managed speech recognition service."""

from __future__ import annotations

import gc
import logging
import threading
import time
from typing import Any

import torch
from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor, pipeline

from modules.audio import Audio

logger = logging.getLogger(__name__)


class SpeechTranscriptionService:
    """Keep one ASR pipeline resident and serialize access to it."""

    def __init__(
        self,
        model_name: str = Audio.DEFAULT_MODEL,
        device: str = "auto",
        idle_timeout_minutes: float | None = 15,
    ) -> None:
        if idle_timeout_minutes is not None and idle_timeout_minutes <= 0:
            raise ValueError("ASR idle timeout must be positive or None")
        self.model_name = model_name
        self.configured_device = device
        self._idle_timeout_minutes = idle_timeout_minutes
        self._idle_timer: threading.Timer | None = None
        self._idle_deadline: float | None = None
        self._idle_generation = 0
        self._pipeline: Any | None = None
        self._state = "unloaded"
        self._device: str | None = None
        self._error: str | None = None
        self._load_seconds: float | None = None
        self._last_transcription_seconds: float | None = None
        self._transcription_count = 0
        self._lifecycle_lock = threading.RLock()
        self._inference_lock = threading.Lock()

    def _cancel_idle_timer_locked(self) -> None:
        self._idle_generation += 1
        if self._idle_timer is not None:
            self._idle_timer.cancel()
        self._idle_timer = None
        self._idle_deadline = None

    def _schedule_idle_unload_locked(self) -> None:
        self._cancel_idle_timer_locked()
        if self._pipeline is None or self._idle_timeout_minutes is None:
            return

        timeout_seconds = self._idle_timeout_minutes * 60
        generation = self._idle_generation
        timer = threading.Timer(timeout_seconds, self._idle_unload, args=(generation,))
        timer.daemon = True
        self._idle_timer = timer
        self._idle_deadline = time.monotonic() + timeout_seconds
        timer.start()

    def _idle_unload(self, generation: int) -> None:
        with self._lifecycle_lock:
            if generation != self._idle_generation or self._pipeline is None:
                return
        logger.info(
            "ASR idle timeout reached after %s minutes",
            self._idle_timeout_minutes,
        )
        self.unload()

    def _resolve_device(self) -> tuple[str, torch.dtype]:
        configured = self.configured_device.strip().lower()
        if configured == "auto":
            device = "cuda:0" if torch.cuda.is_available() else "cpu"
        elif configured == "cuda":
            device = "cuda:0"
        elif configured == "cpu" or configured.startswith("cuda:"):
            device = configured
        else:
            raise ValueError(
                f"Unsupported ASR device {self.configured_device!r}; "
                "use auto, cpu, cuda, or cuda:<index>"
            )

        if device.startswith("cuda") and not torch.cuda.is_available():
            raise RuntimeError(f"ASR device {device!r} was requested, but CUDA is unavailable")

        dtype = torch.float16 if device.startswith("cuda") else torch.float32
        return device, dtype

    def load(self) -> None:
        """Load the configured model once; concurrent callers share the result."""
        with self._lifecycle_lock:
            if self._pipeline is not None:
                return

            self._state = "loading"
            self._error = None
            started = time.perf_counter()

            try:
                device, dtype = self._resolve_device()
                model = AutoModelForSpeechSeq2Seq.from_pretrained(
                    self.model_name,
                    dtype=dtype,
                    low_cpu_mem_usage=True,
                    use_safetensors=True,
                    attn_implementation="eager",
                )
                model.to(device)
                processor = AutoProcessor.from_pretrained(self.model_name)
                runner = pipeline(
                    "automatic-speech-recognition",
                    model=model,
                    tokenizer=processor.tokenizer,
                    feature_extractor=processor.feature_extractor,
                    dtype=dtype,
                    device=device,
                    generate_kwargs={"max_new_tokens": 128},
                )
            except Exception as exc:
                self._state = "failed"
                self._error = str(exc)
                self._load_seconds = time.perf_counter() - started
                logger.exception("ASR model failed to load")
                raise

            self._pipeline = runner
            self._device = device
            self._load_seconds = time.perf_counter() - started
            self._state = "ready"
            self._schedule_idle_unload_locked()
            logger.info(
                "ASR model ready: model=%s device=%s load_seconds=%.3f",
                self.model_name,
                device,
                self._load_seconds,
            )

    def transcribe(self, audio_data: Any) -> str:
        """Transcribe a waveform, loading once and serializing GPU inference."""
        if audio_data is None:
            raise ValueError("audio_data is required")

        with self._inference_lock:
            self.load()
            runner = self._pipeline
            if runner is None:  # Defensive: load() either returns a runner or raises.
                raise RuntimeError("ASR pipeline is unavailable")

            started = time.perf_counter()
            result = runner(audio_data, return_timestamps=True)
            elapsed = time.perf_counter() - started

            with self._lifecycle_lock:
                self._last_transcription_seconds = elapsed
                self._transcription_count += 1
                self._schedule_idle_unload_locked()

            logger.info(
                "ASR transcription complete: seconds=%.3f count=%d",
                elapsed,
                self._transcription_count,
            )
            return str(result["text"])

    def unload(self) -> None:
        """Wait for active inference, then release the resident pipeline."""
        with self._inference_lock:
            with self._lifecycle_lock:
                runner = self._pipeline
                self._cancel_idle_timer_locked()
                self._pipeline = None
                self._state = "unloaded"
                self._device = None
                self._error = None

            if runner is not None:
                del runner
                gc.collect()
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
                logger.info("ASR model unloaded: model=%s", self.model_name)

    def set_idle_timeout(self, minutes: float | None) -> None:
        """Change the idle policy and restart its countdown if loaded."""
        if minutes is not None and minutes <= 0:
            raise ValueError("ASR idle timeout must be positive or None")
        with self._lifecycle_lock:
            self._idle_timeout_minutes = minutes
            self._schedule_idle_unload_locked()

    def status(self) -> dict[str, Any]:
        """Return state and timing data suitable for health/UI endpoints."""
        with self._lifecycle_lock:
            idle_seconds_remaining = (
                max(0.0, self._idle_deadline - time.monotonic())
                if self._idle_deadline is not None
                else None
            )
            return {
                "state": self._state,
                "model": self.model_name,
                "configured_device": self.configured_device,
                "device": self._device,
                "load_seconds": self._load_seconds,
                "last_transcription_seconds": self._last_transcription_seconds,
                "transcription_count": self._transcription_count,
                "idle_timeout_minutes": self._idle_timeout_minutes,
                "idle_seconds_remaining": idle_seconds_remaining,
                "error": self._error,
            }
