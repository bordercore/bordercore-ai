"""
Unit tests for the `sanitize_string` method of the ChatBot class.
"""
from unittest.mock import MagicMock, patch

import pytest

from modules.chatbot import ChatBot


def test_sanitize_string():
    """Test that `sanitize_string` correctly strips trailing punctuation and whitespace."""
    chatbot = ChatBot()
    assert chatbot.sanitize_string("foobar.") == "foobar"
    assert chatbot.sanitize_string("foobar ") == "foobar"


def test_init_stt_if_enabled_enabled():
    """Returns WhisperMic instance when STT is enabled."""
    instance = ChatBot()
    instance.args = {"stt": True}
    with patch("modules.chatbot.WhisperMic") as mock_mic:
        mic = instance.init_stt_if_enabled()
        mock_mic.assert_called_once_with(model="small", energy=100)
        assert mic == mock_mic()


def test_init_stt_if_enabled_disabled():
    """Return ``None`` when STT is disabled."""
    instance = ChatBot()
    instance.args = {"stt": False}
    mic = instance.init_stt_if_enabled()
    assert mic is None


def test_get_user_input_stt_inactive_skips_on_wrong_wake_word():
    """Skips input when wake-word is incorrect and assistant mode is active."""
    instance = ChatBot()
    instance.args = {"stt": True, "assistant": True, "debug": False}
    instance.get_wake_word = MagicMock(return_value="hello")
    instance.sanitize_string = lambda s: s
    mic = MagicMock()
    mic.listen.return_value = "not hello"
    result = instance.get_user_input(mic, active=False)
    assert result is None


def test_get_user_input_keyboard_interrupt():
    """Exits the program when user sends a keyboard interrupt."""
    instance = ChatBot()
    instance.args = {"stt": False}
    with patch("builtins.input", side_effect=KeyboardInterrupt):
        with pytest.raises(SystemExit):
            mic = MagicMock()
            instance.get_user_input(mic, active=False)


def test_handle_response_inference_enabled():
    """Uses inference engine to process and print assistant response."""
    instance = ChatBot()
    instance.args = {"tts": False}
    inference = MagicMock()
    inference.context.get.return_value = ["context"]
    inference.generate.return_value = ["Hello", " world!"]
    instance.send_message_to_model = MagicMock()
    instance.speak = MagicMock()
    instance.handle_response("Hi", inference)
    inference.context.add.assert_called_once_with("Hi", True)


def test_handle_message_lights(chatbot):
    """Lights requests should run the tool, update message content, then call the model."""
    chatbot.get_request_type = MagicMock(return_value={"category": "lights"})
    with patch("modules.chatbot.control_lights", return_value="light-response") as mock_control:
        messages = [{"role": "user", "content": "turn on the lights"}]
        chatbot.send_message_to_model = MagicMock(return_value="llm-response")

        result = chatbot.dispatch_message(messages)

        # Tool called
        mock_control.assert_called_once()
        # Tool output fed back into the message
        assert messages[-1]["content"] == "light-response"
        # Model called with streaming path
        chatbot.send_message_to_model.assert_called_once()
        args, kwargs = chatbot.send_message_to_model.call_args
        assert args[0] is messages
        assert kwargs.get("stream") is True
        assert kwargs.get("replace_context") is True
        # Final result is the model's return value
        assert result == "llm-response"


def test_handle_message_music(chatbot):
    """Music requests should run the tool, update message content, then call the model."""
    chatbot.get_request_type = MagicMock(return_value={"category": "music"})
    with patch("modules.chatbot.play_music", return_value="music-response") as mock_play:
        messages = [{"role": "user", "content": "play music"}]
        chatbot.send_message_to_model = MagicMock(return_value="llm-response")

        result = chatbot.dispatch_message(messages)

        mock_play.assert_called_once()
        assert messages[-1]["content"] == "music-response"
        chatbot.send_message_to_model.assert_called_once()
        _, kwargs = chatbot.send_message_to_model.call_args
        assert kwargs.get("stream") is True
        assert kwargs.get("replace_context") is True
        assert result == "llm-response"


def test_handle_message_math_with_wolfram(chatbot):
    """When wolfram_alpha is enabled, math uses Wolfram and forwards result to the model."""
    chatbot.args["wolfram_alpha"] = True
    messages = [{"role": "user", "content": "what is 2+2"}]
    chatbot.send_message_to_model = MagicMock(return_value="wolfram-llm-response")

    with patch("modules.chatbot.WolframAlphaFunctionCall") as mock_class:
        mock_instance = mock_class.return_value
        mock_instance.run.return_value = "4"

        result = chatbot.dispatch_message(messages)

        mock_instance.run.assert_called_once_with("what is 2+2")
        # Tool output becomes the message content sent to the model
        assert messages[-1]["content"] == "4"
        chatbot.send_message_to_model.assert_called_once()
        _, kwargs = chatbot.send_message_to_model.call_args
        assert kwargs.get("stream") is True
        assert kwargs.get("replace_context") is True
        assert result == "wolfram-llm-response"


def test_handle_message_math_with_thinking_enabled(chatbot):
    """With enable_thinking True, math falls back to model (tool not used)."""
    chatbot.args["enable_thinking"] = True
    chatbot.get_request_type = MagicMock(return_value={"category": "math"})
    messages = [{"role": "user", "content": "what is 2+2"}]
    chatbot.send_message_to_model = MagicMock(return_value="llm-response")

    result = chatbot.dispatch_message(messages)

    chatbot.send_message_to_model.assert_called_once()
    _, kwargs = chatbot.send_message_to_model.call_args
    assert kwargs.get("stream") is True
    assert kwargs.get("replace_context") is True
    assert result == "llm-response"


def test_handle_message_default(chatbot):
    """Unknown categories go straight to the model."""
    chatbot.get_request_type = MagicMock(return_value={"category": "unknown"})
    messages = [{"role": "user", "content": "tell me a joke"}]
    chatbot.send_message_to_model = MagicMock(return_value="default-response")

    result = chatbot.dispatch_message(messages)

    chatbot.send_message_to_model.assert_called_once()
    _, kwargs = chatbot.send_message_to_model.call_args
    assert kwargs.get("stream") is True
    assert kwargs.get("replace_context") is True
    assert result == "default-response"


def test_handle_message_with_url(chatbot):
    """When args['url'] is set, fetched content is appended and then routed to the model."""
    chatbot.args["url"] = "http://example.com"
    with patch("modules.chatbot.get_webpage_contents", return_value="Example site") as mock_get:
        # get_request_type is ignored when url is set, but it's fine if present
        chatbot.get_request_type = MagicMock(return_value={"category": "other"})
        messages = [{"role": "user", "content": "summarize"}]
        chatbot.send_message_to_model = MagicMock(return_value="summarized")

        result = chatbot.dispatch_message(messages)

        mock_get.assert_called_once_with("http://example.com")
        assert "Example site" in messages[-1]["content"]
        chatbot.send_message_to_model.assert_called_once()
        _, kwargs = chatbot.send_message_to_model.call_args
        assert kwargs.get("stream") is True
        assert kwargs.get("replace_context") is True
        assert result == "summarized"
