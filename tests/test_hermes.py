"""Tests for the Hermes Agent memory sidecar."""

from concurrent.futures import Future
from unittest.mock import MagicMock, patch

import pytest
import requests

from modules.hermes import HermesClient


def _response(content: str) -> MagicMock:
    response = MagicMock()
    response.json.return_value = {
        "choices": [{"message": {"content": content}}],
    }
    return response


@patch("modules.hermes.requests.post")
def test_recall_sends_memory_scope_and_returns_bounded_context(post: MagicMock) -> None:
    post.return_value = _response(
        '{"memories":["Uses uv", "Prefers pytest", 42, ""]}'
    )
    client = HermesClient(
        "http://127.0.0.1:8642/v1/",
        "secret",
        max_memory_characters=25,
    )

    result = client.recall(
        "How should I test this?",
        memory_key="bordercore:web:test-user",
    )

    assert result == "- Uses uv\n- Prefers pytes"
    request = post.call_args
    assert request.args[0] == "http://127.0.0.1:8642/v1/chat/completions"
    assert request.kwargs["headers"]["X-Hermes-Session-Key"] == (
        "bordercore:web:test-user"
    )
    assert request.kwargs["headers"]["Authorization"] == "Bearer secret"
    assert request.kwargs["json"]["stream"] is False
    assert "How should I test this?" in request.kwargs["json"]["messages"][0]["content"]
    post.return_value.raise_for_status.assert_called_once()


@patch("modules.hermes.requests.post")
def test_recall_accepts_json_code_fence(post: MagicMock) -> None:
    post.return_value = _response('```json\n{"memories":["Runs on deepvirtual"]}\n```')

    result = HermesClient("http://hermes/v1", "secret").recall(
        "Where does it run?",
        memory_key="browser-key",
    )

    assert result == "- Runs on deepvirtual"


@patch("modules.hermes.requests.post")
def test_store_sends_conversation_as_untrusted_data(post: MagicMock) -> None:
    post.return_value = _response('{"stored":true}')
    client = HermesClient("http://hermes/v1", "secret")

    client.store(
        "Remember that I prefer pytest",
        "I'll remember that.",
        memory_key="browser-key",
    )

    prompt = post.call_args.kwargs["json"]["messages"][0]["content"]
    assert "Remember that I prefer pytest" in prompt
    assert "I'll remember that." in prompt
    assert "Do not store" in prompt
    assert post.call_args.kwargs["headers"]["X-Hermes-Session-Key"] == "browser-key"


@pytest.mark.parametrize("base_url,api_key", [("", "key"), ("http://hermes", "")])
def test_client_requires_server_side_configuration(base_url: str, api_key: str) -> None:
    with pytest.raises(ValueError):
        HermesClient(base_url, api_key)


@patch("modules.hermes.requests.post")
def test_http_errors_are_exposed_to_the_bordercore_route(post: MagicMock) -> None:
    response = _response("")
    response.raise_for_status.side_effect = requests.HTTPError("unauthorized")
    post.return_value = response

    with pytest.raises(requests.HTTPError):
        HermesClient("http://hermes/v1", "bad-key").recall(
            "Hello",
            memory_key="browser-key",
        )


@patch("modules.hermes.requests.post")
def test_invalid_recall_response_is_rejected(post: MagicMock) -> None:
    post.return_value = _response("This is not JSON")

    with pytest.raises(ValueError, match="invalid JSON"):
        HermesClient("http://hermes/v1", "secret").recall(
            "Hello",
            memory_key="browser-key",
        )


@patch("modules.hermes._MEMORY_EXECUTOR.submit")
def test_hard_operation_deadline_is_enforced(submit: MagicMock) -> None:
    future: Future[MagicMock] = Future()
    submit.return_value = future

    with pytest.raises(requests.Timeout, match="exceeded"):
        HermesClient(
            "http://hermes/v1",
            "secret",
            operation_timeout=0.001,
        ).recall("Hello", memory_key="browser-key")

    assert future.cancelled()
