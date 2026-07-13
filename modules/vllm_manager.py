"""Safe invocation of the host-level vLLM model switcher."""

import re
import subprocess
from pathlib import Path
from typing import Any

import requests


VLLM_SWITCH_COMMAND = (
    Path(__file__).resolve().parent.parent / "deploy" / "linux" / "bin" / "vllm-model"
)
VLLM_SWITCH_TIMEOUT_SECONDS = 900
VLLM_PROFILE_PATTERN = re.compile(r"^[A-Za-z0-9._-]+$")
VLLM_STATUS_TIMEOUT_SECONDS = 2


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
    """Hide local checkpoints represented by canonical managed vLLM entries."""
    managed_profiles = {
        model["vllm_profile"]
        for model in models
        if isinstance(model.get("vllm_profile"), str)
    }
    return [model for model in models if model.get("model") not in managed_profiles]


def switch_vllm_model(profile: str) -> str:
    """Switch the host vLLM service to an allow-listed model profile.

    The host command performs its own profile, checkpoint, health, identity,
    completion, and rollback checks. This wrapper deliberately uses an argument
    list rather than a shell and validates the profile before invoking it.

    Args:
        profile: Profile name from ``deploy/linux/systemd/vllm-profiles``.

    Returns:
        Informational output emitted by the switch command.

    Raises:
        RuntimeError: If the profile is invalid, the command cannot run, times
            out, or reports an unsuccessful switch.
    """
    if not isinstance(profile, str) or not VLLM_PROFILE_PATTERN.fullmatch(profile):
        raise RuntimeError("Invalid vLLM model profile")

    try:
        result = subprocess.run(
            [str(VLLM_SWITCH_COMMAND), "switch", profile],
            capture_output=True,
            check=False,
            text=True,
            timeout=VLLM_SWITCH_TIMEOUT_SECONDS,
        )
    except FileNotFoundError as exc:
        raise RuntimeError(f"vLLM switch command not found: {VLLM_SWITCH_COMMAND}") from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"Timed out while switching vLLM to {profile}") from exc

    output = "\n".join(part.strip() for part in (result.stdout, result.stderr) if part.strip())
    if result.returncode != 0:
        detail = output or f"switch command exited with status {result.returncode}"
        raise RuntimeError(f"Unable to switch vLLM to {profile}: {detail}")

    return output
