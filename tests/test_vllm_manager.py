"""Tests for the host-level vLLM model switch wrapper."""

import subprocess
from unittest.mock import Mock, patch

import pytest

from modules.vllm_manager import (
    VLLM_SWITCH_COMMAND,
    get_active_vllm_model,
    hide_managed_checkpoint_duplicates,
    switch_vllm_model,
)


def test_get_active_vllm_model_returns_advertised_id() -> None:
    """The running server's model ID is read from its OpenAI models endpoint."""
    response = Mock()
    response.json.return_value = {"data": [{"id": "Qwen3-8B-AWQ-vLLM"}]}

    with patch("modules.vllm_manager.requests.get", return_value=response) as get:
        model = get_active_vllm_model("http://127.0.0.1:8001/v1")

    assert model == "Qwen3-8B-AWQ-vLLM"
    get.assert_called_once_with("http://127.0.0.1:8001/v1/models", timeout=2)
    response.raise_for_status.assert_called_once_with()


def test_hide_managed_checkpoint_duplicates() -> None:
    """Managed API entries replace their same-named local checkpoints."""
    models = [
        {"model": "Qwen3-8B-AWQ-vLLM", "vllm_profile": "Qwen3-8B-AWQ"},
        {"model": "Qwen3-8B-AWQ"},
        {"model": "unmanaged-local-model"},
    ]

    assert hide_managed_checkpoint_duplicates(models) == [models[0], models[2]]


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
