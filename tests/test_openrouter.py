"""OpenRouter routing, credentials, streaming, and public model metadata."""

import json
from threading import Event
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import httpx
import pytest
from openai import OpenAI

from modules.chatbot import ChatBot


@pytest.mark.parametrize("model_id", ["provider/new-chat-model:free", "qwen/new-model"])
def test_openrouter_streams_arbitrary_model_ids(monkeypatch, model_id):
    """Exercise real SDK serialization/SSE parsing without a network request."""
    monkeypatch.setenv("OPENROUTER_API_KEY", "router-secret")
    captured = []

    def respond(request):
        captured.append(request)
        events = [
            {"choices": [{"index": 0, "delta": {"role": "assistant"}}]},
            {"choices": [{"index": 0, "delta": {"reasoning": "Thinking"}}]},
            {"choices": [{"index": 0, "delta": {"content": "Hello"}}]},
            {"choices": [{"index": 0, "delta": {"content": " world"}}]},
            {"choices": [], "usage": {"total_tokens": 10}},
        ]
        body = ": OPENROUTER PROCESSING\n\n"
        body += "".join(f"data: {json.dumps(event)}\n\n" for event in events)
        body += "data: [DONE]\n\n"
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, text=body)

    with (
        httpx.Client(transport=httpx.MockTransport(respond)) as http_client,
        patch.dict("modules.chatbot.model_info", {model_id: {"type": "api", "vendor": "openrouter"}}),
        patch("modules.chatbot.OpenAI", side_effect=lambda **kw: OpenAI(http_client=http_client, **kw)),
    ):
        bot = ChatBot(model_name=model_id)
        assert list(bot.send_message_to_model("Hi", stream=True)) == ["Hello", " world"]

    request, = captured
    assert str(request.url) == "https://openrouter.ai/api/v1/chat/completions"
    assert request.headers["authorization"] == "Bearer router-secret"
    assert json.loads(request.content) == {
        "model": model_id,
        "messages": [{"role": "user", "content": "Hi"}],
        "stream": True,
    }


@pytest.mark.parametrize(
    "model_key,env_key,setting_key,expected",
    [(None, None, "setting", "setting"), (None, "env", "setting", "env"),
     ("model", "env", "setting", "model")],
)
def test_openrouter_key_precedence(monkeypatch, model_key, env_key, setting_key, expected):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    if env_key:
        monkeypatch.setenv("OPENROUTER_API_KEY", env_key)
    with (
        patch.dict("modules.chatbot.model_info", {"router/model": {"vendor": "openrouter", "api_key": model_key}}),
        patch("modules.chatbot.settings.openrouter_api_key", setting_key, create=True),
        patch("modules.chatbot.OpenAI") as client,
    ):
        client.return_value.chat.completions.create.return_value = []
        assert ChatBot(model_name="router/model").send_message_to_model("Hi") == ""
        client.assert_called_once_with(api_key=expected, base_url="https://openrouter.ai/api/v1")


def test_openrouter_does_not_fall_back_to_openai_credentials(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    with (
        patch.dict("modules.chatbot.model_info", {"router/model": {"vendor": "openrouter"}}),
        patch("modules.chatbot.settings.openrouter_api_key", "", create=True),
        patch("modules.chatbot.settings.openai_api_key", "openai-secret"),
        patch("modules.chatbot.OpenAI") as client,
    ):
        with pytest.raises(ValueError, match="OPENROUTER_API_KEY"):
            ChatBot(model_name="router/model").send_message_to_model("Hi")
        client.assert_not_called()


@pytest.mark.parametrize("enabled", [False, True])
def test_openrouter_thinking_uses_api_without_changing_qwen_prompt(enabled):
    with patch.dict("modules.chatbot.model_info", {
        "qwen/model": {"vendor": "openrouter", "thinking": True},
    }):
        bot = ChatBot(model_name="qwen/model", enable_thinking=enabled)
        bot.send_message_to_model_openai = MagicMock(return_value=iter(()))
        args = {"extra_body": {"provider": {"allow_fallbacks": False}}}
        bot.send_message_to_model("Hi", args=args)

    assert bot.context.get()[-1]["content"] == "Hi"
    bot.send_message_to_model_openai.assert_called_once_with({
        "extra_body": {"provider": {"allow_fallbacks": False}, "reasoning": {"enabled": enabled}},
    })
    assert args == {"extra_body": {"provider": {"allow_fallbacks": False}}}


def test_model_picker_includes_openrouter_without_credentials(tmp_path):
    with (
        patch.dict("modules.chatbot.model_info", {
            "provider/model": {"name": "Router Model", "type": "api", "vendor": "openrouter", "api_key": "secret", "qwen_vision": True},
        }, clear=True),
        patch("modules.chatbot.settings.model_dir", str(tmp_path)),
    ):
        assert ChatBot.get_model_list() == [{
            "model": "provider/model", "name": "Router Model", "type": "api",
            "vendor": "openrouter", "qwen_vision": True,
        }]
        assert ChatBot.get_model_attribute("provider/model", "api_key") == "secret"


def test_stream_cancellation_closes_response():
    stop_event = Event()
    stop_event.set()
    response = MagicMock()
    response.__iter__.return_value = iter([SimpleNamespace(choices=[])])
    with patch("modules.chatbot.OpenAI") as client:
        client.return_value.chat.completions.create.return_value = response
        bot = ChatBot(model_name="test-model", stop_event=stop_event)
        assert list(bot.send_message_to_model_openai({})) == []
    response.close.assert_called_once_with()


def test_openrouter_vision_chat_route():
    """The browser's image input reaches OpenRouter in image_url format."""
    with patch("modules.model_manager.ModelManager.load"):
        from webapp.app import app

    image_url = "data:image/png;base64,aW1hZ2U="
    with (
        patch.dict("modules.chatbot.model_info", {"provider/vision": {"vendor": "openrouter"}}),
        patch("webapp.app.generate_stream", return_value=iter(["OK"])) as generate,
        app.test_client() as client,
    ):
        response = client.post("/chat", data={
            "model": "provider/vision",
            "message": json.dumps([{"role": "user", "content": "Describe this"}]),
            "image": image_url,
        })
        assert response.get_data(as_text=True) == "OK"

    assert generate.call_args.args[1][-1]["content"] == [
        {"type": "image_url", "image_url": {"url": image_url}},
        {"type": "text", "text": "Describe this"},
    ]
