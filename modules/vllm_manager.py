"""Safe invocation of the host-level managed inference-engine switcher."""

import re
import subprocess
from pathlib import Path
from typing import Any

import requests


MODEL_ENGINE_SWITCH_COMMAND = (
    Path(__file__).resolve().parent.parent / "deploy" / "linux" / "bin" / "model-engine"
)
# Retained for callers that imported the old constant.
VLLM_SWITCH_COMMAND = MODEL_ENGINE_SWITCH_COMMAND
VLLM_SWITCH_TIMEOUT_SECONDS = 900
MODEL_ENGINE_UNLOAD_TIMEOUT_SECONDS = 120
VLLM_PROFILE_PATTERN = re.compile(r"^[A-Za-z0-9._-]+$")
VLLM_STATUS_TIMEOUT_SECONDS = 2
MANAGED_ENGINES = {"vllm", "llama-cpp"}


def get_active_vllm_model(base_url: str) -> str | None:
    """Return the model ID currently advertised by a vLLM endpoint."""
    response = requests.get(
        f"{base_url.rstrip('/')}/models",
        timeout=VLLM_STATUS_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
        return None

    for item in payload["data"]:
        if isinstance(item, dict) and isinstance(item.get("id"), str):
            return item["id"]
    return None


def hide_managed_checkpoint_duplicates(models: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Hide local checkpoints represented by canonical managed API entries."""
    managed_profiles = {
        profile
        for model in models
        for profile in (model.get("vllm_profile"), model.get("llama_cpp_profile"))
        if isinstance(profile, str)
    }
    return [model for model in models if model.get("model") not in managed_profiles]


def switch_managed_model(engine: str, profile: str) -> str:
    """Switch to an allow-listed model on a managed host inference engine.

    The host command performs profile, checkpoint, engine lifecycle, health,
    identity, completion, and cross-engine rollback checks. This wrapper uses
    an argument list rather than a shell and validates both identifiers.

    Args:
        engine: Managed engine name (``vllm`` or ``llama-cpp``).
        profile: Allow-listed profile name for that engine.

    Returns:
        Informational output emitted by the switch command.

    Raises:
        RuntimeError: If the profile is invalid, the command cannot run, times
            out, or reports an unsuccessful switch.
    """
    if engine not in MANAGED_ENGINES:
        raise RuntimeError("Invalid managed inference engine")
    if not isinstance(profile, str) or not VLLM_PROFILE_PATTERN.fullmatch(profile):
        raise RuntimeError("Invalid managed model profile")

    try:
        result = subprocess.run(
            [str(MODEL_ENGINE_SWITCH_COMMAND), "switch", engine, profile],
            capture_output=True,
            check=False,
            text=True,
            timeout=VLLM_SWITCH_TIMEOUT_SECONDS,
        )
    except FileNotFoundError as exc:
        raise RuntimeError(
            f"Managed engine switch command not found: {MODEL_ENGINE_SWITCH_COMMAND}"
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"Timed out while switching {engine} to {profile}") from exc

    output = "\n".join(part.strip() for part in (result.stdout, result.stderr) if part.strip())
    if result.returncode != 0:
        detail = output or f"switch command exited with status {result.returncode}"
        raise RuntimeError(f"Unable to switch {engine} to {profile}: {detail}")

    return output


def switch_vllm_model(profile: str) -> str:
    """Switch to an allow-listed vLLM profile."""
    return switch_managed_model("vllm", profile)


def switch_llama_cpp_model(profile: str) -> str:
    """Switch to an allow-listed llama.cpp profile."""
    return switch_managed_model("llama-cpp", profile)


def unload_managed_models() -> str:
    """Stop every managed inference engine and release its GPU allocation."""
    try:
        result = subprocess.run(
            [str(MODEL_ENGINE_SWITCH_COMMAND), "unload"],
            capture_output=True,
            check=False,
            text=True,
            timeout=MODEL_ENGINE_UNLOAD_TIMEOUT_SECONDS,
        )
    except FileNotFoundError as exc:
        raise RuntimeError(
            f"Managed engine switch command not found: {MODEL_ENGINE_SWITCH_COMMAND}"
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("Timed out while unloading managed models") from exc

    output = "\n".join(
        part.strip() for part in (result.stdout, result.stderr) if part.strip()
    )
    if result.returncode != 0:
        detail = output or f"unload command exited with status {result.returncode}"
        raise RuntimeError(f"Unable to unload managed models: {detail}")

    return output
