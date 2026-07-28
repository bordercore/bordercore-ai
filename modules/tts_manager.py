"""Switch locally managed text-to-speech services safely."""

from __future__ import annotations

import subprocess
import time
from collections.abc import Callable
from typing import Any

import requests

MANAGED_TTS_ENGINES = {
    "chatterbox": ("chatterbox-tts.service", "chatterbox"),
    "qwen3": ("qwen3-tts.service", "qwen3-tts"),
}
LOCAL_TTS_CAPABILITIES_URL = "https://127.0.0.1:5001/capabilities"


def _capability_engine_matches(expected: str, actual: Any) -> bool:
    value = str(actual or "").strip().lower()
    return value == expected or value.startswith(f"{expected}-")


def switch_tts_engine(
    engine: str,
    *,
    timeout_seconds: float = 120,
    runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
    capability_get: Callable[..., requests.Response] = requests.get,
) -> dict[str, Any]:
    """Start an allow-listed user service and wait for its identity endpoint."""
    normalized = engine.strip().lower()
    try:
        service, expected_identity = MANAGED_TTS_ENGINES[normalized]
    except KeyError as exc:
        raise ValueError(f"Unsupported managed TTS engine: {engine}") from exc
    if timeout_seconds <= 0:
        raise ValueError("TTS switch timeout must be positive")

    result = runner(
        ["systemctl", "--user", "start", service],
        capture_output=True,
        text=True,
        timeout=timeout_seconds,
        check=False,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "systemctl start failed").strip()
        raise RuntimeError(detail)

    deadline = time.monotonic() + timeout_seconds
    last_error = "capability endpoint did not become ready"
    while time.monotonic() < deadline:
        try:
            response = capability_get(
                LOCAL_TTS_CAPABILITIES_URL,
                timeout=2,
                verify=False,
            )
            response.raise_for_status()
            payload = response.json()
            if (
                payload.get("status") == "ready"
                and _capability_engine_matches(expected_identity, payload.get("engine"))
            ):
                return payload
            last_error = (
                f"expected {expected_identity}, received "
                f"{payload.get('engine')} ({payload.get('status')})"
            )
        except (requests.RequestException, ValueError) as exc:
            last_error = str(exc)
        time.sleep(0.5)

    raise TimeoutError(f"{engine} did not become ready: {last_error}")
