"""Tests for the host-level vLLM model switch wrapper."""

import subprocess
from unittest.mock import Mock, patch

import pytest

from modules.vllm_manager import VLLM_SWITCH_COMMAND, switch_vllm_model


def test_switch_vllm_model_invokes_allowlisted_profile() -> None:
    """A successful switch returns command output and never invokes a shell."""
    completed = subprocess.CompletedProcess([], 0, stdout="14B is healthy\n", stderr="")

    with patch("modules.vllm_manager.subprocess.run", return_value=completed) as run:
        output = switch_vllm_model("Qwen3-14B-AWQ")

    assert output == "14B is healthy"
    run.assert_called_once_with(
        [str(VLLM_SWITCH_COMMAND), "switch", "Qwen3-14B-AWQ"],
        capture_output=True,
        check=False,
        text=True,
        timeout=900,
    )


def test_switch_vllm_model_rejects_invalid_profile() -> None:
    """Profile metadata cannot inject shell syntax or arbitrary arguments."""
    with patch("modules.vllm_manager.subprocess.run") as run:
        with pytest.raises(RuntimeError, match="Invalid vLLM model profile"):
            switch_vllm_model("Qwen3-14B-AWQ; reboot")

    run.assert_not_called()


def test_switch_vllm_model_reports_command_failure() -> None:
    """Switcher failures are returned to the UI with their rollback detail."""
    completed = subprocess.CompletedProcess([], 1, stdout="", stderr="Rollback to 8B succeeded")

    with patch("modules.vllm_manager.subprocess.run", return_value=completed):
        with pytest.raises(RuntimeError, match="Rollback to 8B succeeded"):
            switch_vllm_model("Qwen3-14B-AWQ")


def test_switch_vllm_model_reports_timeout() -> None:
    """A stuck host switch produces a bounded, readable error."""
    timeout = subprocess.TimeoutExpired(["vllm-model"], 900)

    with patch("modules.vllm_manager.subprocess.run", side_effect=timeout):
        with pytest.raises(RuntimeError, match="Timed out"):
            switch_vllm_model("Qwen3-14B-AWQ")
