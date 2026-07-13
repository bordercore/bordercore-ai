"""Safe invocation of the host-level vLLM model switcher."""

import re
import subprocess
from pathlib import Path


VLLM_SWITCH_COMMAND = (
    Path(__file__).resolve().parent.parent / "deploy" / "linux" / "bin" / "vllm-model"
)
VLLM_SWITCH_TIMEOUT_SECONDS = 900
VLLM_PROFILE_PATTERN = re.compile(r"^[A-Za-z0-9._-]+$")


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
