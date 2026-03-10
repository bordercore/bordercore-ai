"""
This module defines the `ChatBot` class, which provides an interactive interface for
communicating with language models via local or remote APIs (e.g., OpenAI, Anthropic).
It supports multiple capabilities including:

- Message routing based on intent classification
- Integration with tools like music playback, smart lighting, calendar, and weather
- Support for voice interaction (STT and TTS)
- Streaming output from model completions
- Model management (listing, loading, metadata retrieval)

The chatbot can operate in different modes including interactive CLI or as a backend
for services like Discord bots.

Configuration is handled via command-line arguments and the `api.settings` module.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import random
import re
import string
import subprocess
import sys
import tempfile
import time
import urllib.parse
import warnings
from pathlib import Path
from threading import Event
from typing import (Any, Dict, Generator, Iterator, List, Literal, Mapping,
                    Union, cast, overload)

import anthropic
import openai
import pysbd
import requests
import sounddevice  # Adding this eliminates an annoying warning
from http_constants.status import HttpStatus
from openai import OpenAI
from openai.types.chat import ChatCompletionMessageParam
from requests.exceptions import ConnectionError

import settings
from modules.context import Context
from modules.google_calendar import get_schedule
from modules.govee import control_lights
from modules.music import play_music
from modules.tool_registry import ToolRegistry
from modules.util import (clean_model_response, get_model_info,
                          get_webpage_contents, sort_models, strip_code_fences)
from modules.weather import get_weather_info
from modules.wolfram_alpha import WolframAlphaFunctionCall

warnings.filterwarnings("ignore", message=".*The 'nopython' keyword.*")

try:
    from whisper_mic.whisper_mic import WhisperMic
except ImportError:
    # WhisperMic will complain if imported without X. This is fine, since
    #  sometimes I want to run this code as a daemon using supervisor
    pass


COLOR_GREEN = "\033[32m"
COLOR_BLUE = "\033[34m"
COLOR_RESET = "\033[0m"

CONTROL_VALUE = "9574724975"

seg = pysbd.Segmenter(language="en", clean=False)

logger = logging.getLogger("whisper_mic")
# Set the logger level to a higher level than any log messages you want to silence
logger.setLevel(logging.WARNING)
# Create a NullHandler to suppress the log messages
null_handler = logging.NullHandler()
logger.addHandler(null_handler)

# Logger for chatbot module
chatbot_logger = logging.getLogger(__name__)

model_info = get_model_info()


class ChatBot():
    """
    ChatBot provides an interactive command-line interface to Luna, supporting
    local LLMs, OpenAI, and Anthropic APIs, as well as TTS, STT, and various tools.
    """

    ASSISTANT_NAME = "Luna"
    temperature = 0.7

    def __init__(self,
                 model_name: str | None = None,
                 model: Any = None,
                 stop_event: Event | None = None,
                 **args: Any) -> None:
        """
        Initialize a ChatBot instance.

        Args:
            model_name: Name of the model to use (API or local).
            **args: Arbitrary keyword arguments to configure behavior (e.g., temperature, stt, tts).
        """
        self.context = Context()
        self.model_name = model_name
        self.model = model
        self.args = args
        self.stop_event = stop_event
        # Create a shared tool registry for this ChatBot instance
        self.tool_registry: ToolRegistry | None = None
        self.mcp_server_url = self.args.get("mcp_server_url") or getattr(settings, "mcp_server_url", "")
        self.mcp_server_name = self.args.get("mcp_server_name") or getattr(settings, "mcp_server_name", "django_mcp")
        self.mcp_token = self.args.get("mcp_token") or getattr(settings, "mcp_token", "")
        self.mcp_endpoint = self.args.get("mcp_endpoint") or getattr(settings, "mcp_endpoint", "mcp")
        # Track auto-started MCP server processes for cleanup
        self._auto_started_processes: List[subprocess.Popen[bytes]] = []

        if "temperature" in self.args:
            self.temperature = self.args["temperature"]

    def _is_qwen_model(self) -> bool:
        """
        Check if the current model is a Qwen model.

        Returns:
            True if the model name contains 'qwen' (case-insensitive), False otherwise.
        """
        if not self.model_name:
            return False
        return "qwen" in self.model_name.lower()

    # Remove punctuation and whitespace from the end of the string.
    def sanitize_string(self, input_string: str) -> str:
        """
        Remove trailing punctuation and whitespace from a string.

        Args:
            input_string: The raw string to sanitize.
        Returns:
            A trimmed string without trailing punctuation.
        """
        while input_string and input_string[-1] in string.punctuation:
            input_string = input_string[:-1]
        return input_string.strip()

    def get_wake_word(self) -> str:
        """
        Get the lowercase wake word for activating voice mode.

        Returns:
            The wake word string.
        """
        return f"{self.ASSISTANT_NAME}".lower()

    def speak(self, text: str) -> None:
        """
        Perform text-to-speech for the given text and play audio.

        Args:
            text: The text string to vocalize.
        """
        text = urllib.parse.quote(text)
        host = settings.tts_host
        voice = settings.tts_voice
        output_file = "stream_output.wav"
        url = f"http://{host}/api/tts-generate-streaming?text={text}&voice={voice}&language=en&output_file={output_file}"
        response = requests.get(url, stream=True, timeout=20)

        if response.status_code == HttpStatus.OK:
            with tempfile.NamedTemporaryFile(suffix=".wav") as temp_file:
                with open(temp_file.name, "wb") as f:
                    f.write(response.raw.read())
                # Set playsounds' logger level to ERROR to suppress this warning:
                #  "playsound is relying on another python subprocess..."
                logging.getLogger("playsound").setLevel(logging.ERROR)
                from playsound import playsound
                playsound(temp_file.name)
        else:
            print(f"Failed to get audio: status_code = {response.status_code}")

    def interactive(self, inference: Any | None = None) -> None:
        """
        Enter an interactive loop reading user input and printing AI responses.
        """
        mic = self.init_stt_if_enabled()
        active = False

        while True:
            user_input = self.get_user_input(mic, active)
            if user_input is None:
                continue
            if self.args["stt"] and not active:
                active = True
                self.speak("I'm listening")
                continue
            if user_input.lower() == "goodbye":
                self.speak("Be seeing you")
                sys.exit(0)

            self.handle_response(user_input, inference)

    def init_stt_if_enabled(self) -> WhisperMic | None:
        """Initialise the WhisperMic when STT is turned on.

        Returns:
            WhisperMic instance when ``self.args["stt"]`` is truthy; otherwise
            ``None``.
        """
        if self.args["stt"]:
            print("Loading STT package...")
            return WhisperMic(model="small", energy=100)
        return None

    def get_user_input(
        self,
            mic: WhisperMic | None,
        active: bool,
    ) -> str | None:
        """Retrieve a single line of user input (voice or keyboard).

        Args:
            mic: Active ``WhisperMic`` instance if STT is enabled, else ``None``.
            active: ``True`` once the wake-word has been detected; determines
                whether normal utterances are processed or ignored.

        Returns:
            A sanitised input string, or ``None`` when:
            * the wake-word has not yet been spoken, or
            * no actionable input was captured.
        """
        if mic is None:
            raise RuntimeError("WhisperMic Model must be loaded before calling listen().")

        if self.args["stt"]:
            print("Listening...")
            user_input = self.sanitize_string(mic.listen())
            if self.args["debug"]:
                print(user_input)
            if self.args["assistant"] and not active and user_input.lower() != self.get_wake_word():
                return None
            print(f"\b\b\b\b\b\b\b\b\b\b\b\b{user_input}")
            return user_input
        try:
            return input(f"\n{COLOR_GREEN}You:{COLOR_RESET} ")
        except KeyboardInterrupt:
            sys.exit(0)

    def get_temperature(self, payload: Mapping[str, Any]) -> float:
        """
        Extract the temperature value from the payload or fallback to settings.

        Args:
            payload: The incoming request JSON payload.

        Returns:
            A float > 0 representing the model sampling temperature.
        """
        temp = payload["temperature"] if "temperature" in payload else settings.temperature
        # the temperature must be a strictly positive float
        if temp == 0:
            temp = 0.1
        return temp

    def handle_response(self, user_input: str, inference: Any | None) -> None:
        """Generate the assistant’s reply and (optionally) speak it aloud.

        Args:
            user_input: The final, cleaned user utterance.
            inference: External inference engine providing ``context`` and
                ``generate``; if ``None``, calls
                :py:meth:`self.send_message_to_model` directly.
        """
        try:
            if inference:
                inference.context.add(user_input, True)
                response = inference.generate(inference.context.get())
            else:
                response = self.send_message_to_model(user_input)

            print(f"\n{COLOR_BLUE}AI{COLOR_RESET} ", end="")
            content = ""
            for x in response:
                content += x
                print(x, end="", flush=True)
            print()
            if self.args["tts"]:
                self.speak(content)
        except ConnectionError:
            print("Error: API refusing connections.")

    def get_message_handler(self, category: str, content: str) -> str | None:
        """Invoke a tool handler for the given category, if appropriate.

        Args:
            category: The route category (e.g. "lights", "math").
            content: The user request text.

        Returns:
            The string output from the tool, or None if no tool ran.
        """
        chatbot_logger.info(f"Handling message with category: {category}, content length: {len(content)}")

        try:
            if category == "lights":
                chatbot_logger.debug("Invoking lights handler")
                return control_lights(self, content)

            if category == "music":
                chatbot_logger.info(f"Invoking music handler for command: {content[:100]}")
                try:
                    result = play_music(self, content)
                    chatbot_logger.info(f"Music handler returned result (length: {len(result)} chars, starts with CONTROL_VALUE: {result.startswith(CONTROL_VALUE)})")
                    return result
                except Exception as e:
                    chatbot_logger.error(f"Error in music handler: {e}", exc_info=True)
                    raise

            if category == "weather":
                chatbot_logger.debug("Invoking weather handler")
                return get_weather_info(content)

            if category == "calendar":
                chatbot_logger.debug("Invoking calendar handler")
                return get_schedule(content)

            if category == "agenda":
                chatbot_logger.debug("Invoking agenda handler")
                return self.get_agenda()

            if category == "math":
                # If enable_thinking is True, we intentionally *don't* use Wolfram.
                if not self.args.get("enable_thinking", False):
                    chatbot_logger.info(f"Invoking Wolfram Alpha handler for query: {content[:200]}")
                    try:
                        # Initialize tool registry if not already done
                        if self.tool_registry is None:
                            self._initialize_tool_registry()
                        result = WolframAlphaFunctionCall(self, tool_registry=self.tool_registry).run(content)
                        chatbot_logger.info(f"Wolfram Alpha handler returned result (length: {len(result)} chars): {result[:200]}")
                        return result
                    except Exception as e:
                        chatbot_logger.warning(f"Function calling failed, attempting direct calculate() call: {e}")
                        # Fallback: call calculate() directly if function calling fails
                        try:
                            from modules.wolfram_alpha import calculate
                            direct_result = calculate(content)
                            chatbot_logger.info(f"Direct calculate() call successful, result: {direct_result[:200]}")
                            # Include the original question in the response so the model has context
                            return f"For the question '{content}', the answer is {direct_result}"
                        except Exception as fallback_error:
                            chatbot_logger.error(f"Both function calling and direct calculate() failed: {fallback_error}", exc_info=True)
                            raise
                # else: let the model solve it itself.
                chatbot_logger.debug("Math category but enable_thinking is True, skipping Wolfram")
                return None

            # default / unknown category: let the model handle directly
            chatbot_logger.debug(f"Unknown category '{category}', passing to model")
            return None
        except Exception as e:
            chatbot_logger.error(f"Unexpected error in get_message_handler for category '{category}': {e}", exc_info=True)
            raise

    def _maybe_handle_direct_mcp_command(self, content: Any) -> str | None:
        """
        Allow direct MCP tool invocation with a simple command pattern.

        Expected formats:
            mcp:tool_name {"arg": "value"}
            /mcp tool_name {"arg": "value"}
        """
        if not isinstance(content, str):
            return None

        match = re.match(r"^(?:/)?mcp\s*:?\s*([^\s]+)(?:\s+(.*))?$", content.strip(), re.IGNORECASE)
        if not match:
            return None

        tool_name = match.group(1)
        args_text = match.group(2) or ""
        arguments: Dict[str, Any] = {}

        if args_text:
            try:
                arguments = json.loads(args_text)
            except Exception:
                chatbot_logger.warning(
                    f"Could not parse MCP arguments as JSON, passing raw text under 'input': {args_text}"
                )
                arguments = {"input": args_text}

        if self.tool_registry is None:
            self._initialize_tool_registry()

        if self.tool_registry is None:
            return "MCP tool registry is not available."

        if "::" not in tool_name:
            available_servers = list(self.tool_registry.mcp_clients.keys())
            if len(available_servers) == 1:
                tool_name = f"{available_servers[0]}::{tool_name}"

        try:
            result = self.tool_registry.call_tool(tool_name, arguments)
            if isinstance(result, str):
                return result
            try:
                return json.dumps(result)
            except TypeError:
                return str(result)
        except Exception as e:
            chatbot_logger.error(f"Error calling MCP tool '{tool_name}': {e}", exc_info=True)
            return f"Error calling MCP tool '{tool_name}': {e}"

    def list_mcp_tools(self) -> List[str]:
        """
        Return a list of available MCP tool names.
        """
        if self.tool_registry is None:
            self._initialize_tool_registry()
        if self.tool_registry is None:
            return []

        return [
            tool["name"]
            for tool in self.tool_registry.list_tools()
            if tool.get("type") == "mcp"
        ]

    def dispatch_message(self, messages: List[Dict[str, Any]]) -> Any:
        """
        Route the message to the appropriate tool or model.

        Args:
            messages: List of message dicts with keys 'role' and 'content'.
        Returns:
            The result from the selected tool or model streaming output.
        """
        last_message = messages[-1]
        chatbot_logger.info(f"Dispatching message (role: {last_message.get('role')}, content type: {type(last_message.get('content'))})")

        try:
            direct_mcp_result = self._maybe_handle_direct_mcp_command(last_message.get("content"))
            if direct_mcp_result is not None:
                chatbot_logger.info("Direct MCP command detected, returning tool output")
                print(f"[ChatBot] Direct MCP command output: {direct_mcp_result}")

                def yield_direct_mcp() -> Iterator[str]:
                    yield direct_mcp_result

                return yield_direct_mcp()

            if self.args.get("wolfram_alpha", False):
                request_type = {"category": "math"}
                chatbot_logger.debug("Using 'math' category due to wolfram_alpha flag")
            elif self.args.get("url", None):
                request_type = {"category": "other"}
                chatbot_logger.debug("Using 'other' category due to URL flag")
                contents = get_webpage_contents(self.args["url"])
                last_message["content"] += f": {contents}"
            elif type(last_message["content"]) == list:
                # image payload for vision model
                request_type = {"category": "other"}
                chatbot_logger.debug("Using 'other' category due to image payload")
            else:
                chatbot_logger.debug(f"Determining request type from content: {str(last_message['content'])[:200]}")
                try:
                    request_type = self.get_request_type(messages[-1]["content"])
                    chatbot_logger.info(f"Request type determined: {request_type}")
                except Exception as e:
                    chatbot_logger.error(f"Error determining request type: {e}", exc_info=True)
                    # Fall back to "other" category
                    request_type = {"category": "other"}
                    chatbot_logger.warning("Falling back to 'other' category due to error")

            category = request_type["category"]
            content = last_message["content"]
            chatbot_logger.info(f"Routing to category: {category}")

            # Extract text from list content if needed for message handlers
            content_for_handler = content
            if isinstance(content, list):
                # Extract text parts from list content for handlers that expect strings
                text_parts = [
                    item.get("text", "")
                    for item in content
                    if isinstance(item, dict) and item.get("type") == "text"
                ]
                content_for_handler = " ".join(text_parts) if text_parts else ""

            tool_output = self.get_message_handler(category, content_for_handler)

            if tool_output is not None:
                chatbot_logger.debug(f"Tool output received (length: {len(tool_output)} chars), updating message content")

                # Check if tool output starts with CONTROL_VALUE - if so, return directly without AI model processing
                if tool_output.startswith(CONTROL_VALUE):
                    chatbot_logger.info(f"Tool output starts with CONTROL_VALUE, bypassing AI model and returning directly")
                    def direct_yield() -> Iterator[str]:
                        yield tool_output
                    return direct_yield()

                # Preserve context: ensure the model sees both the original question and the tool result
                # This prevents confusion when the model receives just the answer without the question
                original_question = content

                # Check if this is a Wolfram Alpha response that needs context preservation
                if category == "math" and ("Using Wolfram Alpha" in tool_output or "For the question" in tool_output):
                    # Extract the answer from the tool output
                    if "the answer is" in tool_output.lower():
                        # Extract just the answer part
                        if "For the question" in tool_output:
                            answer = tool_output.split("the answer is", 1)[-1].strip()
                        else:
                            answer = tool_output.split("answer is", 1)[-1].strip() if "answer is" in tool_output.lower() else tool_output
                        # Format as a clear message to the model
                        last_message["content"] = f"The user asked: \"{original_question}\"\n\nI calculated the answer using Wolfram Alpha: {answer}\n\nPlease respond naturally to the user with the answer."
                    else:
                        last_message["content"] = f"The user asked: \"{original_question}\"\n\nI got this result: {tool_output}\n\nPlease respond naturally to the user."
                else:
                    # For other tools, use tool output as-is
                    last_message["content"] = tool_output
            else:
                chatbot_logger.debug("No tool output, passing message directly to model")

            chatbot_logger.debug("Sending message to model with streaming enabled")
            response = self.send_message_to_model(messages, stream=True, replace_context=True)

            # Stream chunks as they arrive while buffering for tool call detection
            if hasattr(response, "__iter__") and not isinstance(response, str):
                buffer = []
                for chunk in response:
                    buffer.append(chunk)
                    yield chunk  # Yield immediately for streaming

                # After streaming completes, check for tool calls
                full_response = "".join(buffer)
                chatbot_logger.debug(f"Checking for tool calls in response (length: {len(full_response)}): {full_response[:500]}")
                tool_call_result = self._handle_tool_calls_in_response(messages, full_response)
                if tool_call_result:
                    chatbot_logger.info("Tool call detected and executed, returning final response")
                    # Tool was called - yield the tool result
                    for chunk in tool_call_result:
                        yield chunk
            else:
                # Non-streaming response
                full_response = response if isinstance(response, str) else "".join(response)
                tool_call_result = self._handle_tool_calls_in_response(messages, full_response)
                if tool_call_result:
                    return tool_call_result
                return response
        except Exception as e:
            chatbot_logger.error(f"Error in dispatch_message: {e}", exc_info=True)
            raise

    # These overloads allow mypy to correctly infer the return type depending on the `stream` argument.
    @overload
    def send_message_to_model(self,
                              messages: Union[str, List[Dict[str, Any]]],
                              args: Dict[str, Any] | None = None,
                              prune: bool = True,
                              *,
                              stream: Literal[True],
                              replace_context: bool = False,
                              tool_name: str | None = None,
                              tool_list: str | None = None) -> Iterator[str]: ...
    @overload
    def send_message_to_model(self,
                              messages: Union[str, List[Dict[str, Any]]],
                              args: Dict[str, Any] | None = None,
                              prune: bool = True,
                              *,
                              replace_context: bool = False,
                              tool_name: str | None = None,
                              tool_list: str | None = None) -> str: ...

    def send_message_to_model(self,
                              messages: Union[str, List[Dict[str, Any]]],
                              args: Dict[str, Any] | None = None,
                              prune: bool = True,
                              *,
                              stream: bool = False,
                              replace_context: bool = False,
                              tool_name: str | None = None,
                              tool_list: str | None = None) -> Iterator[str] | str:
        """
        Send messages to the configured model or tool, updating the conversation context.

        Args:
            messages: A string or a list of message dicts (each with 'role' and 'content').
            args: Optional dict of additional parameters for the model call.
            stream: Whether to stream the response back
            prune: Whether to prune old messages from context before adding new ones.
            replace_context: Whether to replace the entire context with these messages.
            tool_name: Name of a specific tool to invoke for a local LLM, if applicable.
            tool_list: Optional list of tools available for local LLM invocation.

        Returns:
            An iterator yielding streamed response chunks from the selected model or tool.
        """
        args = args or {}
        if not isinstance(messages, list):
            messages = [{"role": "user", "content": messages}]

        # Handle Qwen thinking mode control
        if self._is_qwen_model():
            enable_thinking = self.args.get("enable_thinking", False)
            # Find the last user message and append /no_think if thinking is disabled
            # (thinking is enabled by default in Qwen models)
            for msg in reversed(messages):
                if msg.get("role") == "user":
                    content = msg.get("content")
                    if not enable_thinking:
                        # Append /no_think token to disable thinking
                        if isinstance(content, str):
                            # String content: append to the string
                            msg["content"] = content.rstrip() + " /no_think"
                        elif isinstance(content, list):
                            # List content (vision models): find last text item and append
                            text_item = None
                            for item in reversed(content):
                                if isinstance(item, dict) and item.get("type") == "text":
                                    text_item = item
                                    break
                            if text_item:
                                text_content = text_item.get("text", "")
                                text_item["text"] = text_content.rstrip() + " /no_think"
                            else:
                                # No text item found, append a new text item
                                content.append({"type": "text", "text": " /no_think"})
                    # Only modify the first (last in reversed order) user message
                    break

        self.context.add(messages, prune, "user", replace_context)

        model_vendor = ChatBot.get_model_attribute(self.model_name, "vendor")
        if model_vendor == "openai":
            response = self.send_message_to_model_openai(args)
        elif model_vendor == "anthropic":
            response = self.send_message_to_model_anthropic(args)
        else:
            response = self.send_message_to_model_local_llm(args, tool_name, tool_list)

        if stream:
            return response
        return "".join(response)

    def send_message_to_model_openai(self, args: Dict[str, Any]) -> Iterator[str]:
        """
        Send the current conversation context to OpenAI's ChatCompletion API and stream the response.

        Args:
            args: Additional keyword arguments for openai.ChatCompletion.create (e.g., temperature).
        Yields:
            Streamed content chunks from the OpenAI API response.
        """
        if self.model_name is None:
            raise ValueError("model_name must be set before calling send_message_to_model_openai")
        model: str = self.model_name

        openai.api_key = settings.openai_api_key
        client = OpenAI()

        messages = cast(
            list[ChatCompletionMessageParam],
            [{"role": m["role"], "content": m["content"]} for m in self.context.get()],
        )

        response = client.chat.completions.create(
            model=model,
            messages=messages,
            stream=True,
            **args
        )

        for chunk in response:
            if self.stop_event and self.stop_event.is_set():
                close_stream = getattr(response, "close", None)
                if callable(close_stream):
                    close_stream()
                break
            if chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content

    def send_message_to_model_anthropic(self, args: Dict[str, Any]) -> Generator[str, None, None]:
        """
        Sends a message to an Anthropic language model and yields streamed response chunks.

        This method prepares a message list according to Anthropic's API requirements,
        removing unsupported attributes and separating out the system prompt. It then
        sends the request with streaming enabled and yields the text content of each
        streamed chunk as it arrives.

        Args:
            args: Additional keyword arguments to be passed to the Anthropic `messages.create()` method.

        Yields:
            The text content of each streamed response chunk from the Anthropic model.
        """
        messages = self.context.get()

        # Anthropic will reject messages with extraneous attributes
        for x in messages:
            x.pop("id", None)

        # Anthropic requires any system messages to be provided
        #  as a separate parameter and not be present in the
        #  list of user messages.

        system: str = ""
        if messages[0]["role"] == "system":
            system = messages[0]["content"]
            messages.pop(0)

        client = anthropic.Anthropic(
            api_key=settings.anthropic_api_key
        )
        response = client.messages.create(
            model=self.model_name,
            max_tokens=1024,
            messages=messages,
            system=system,
            stream=True,
            **args
        )
        for chunk in response:
            if self.stop_event and self.stop_event.is_set():
                close_stream = getattr(response, "close", None)
                if callable(close_stream):
                    close_stream()
                break
            if chunk.type == "content_block_delta":
                yield chunk.delta.text

    def send_message_to_model_local_llm(
        self,
        args: Dict[str, Any],
        tool_name: str | None,
        tool_list: str | None
    ) -> Generator[str, None, None]:
        """
        Sends a request to a locally hosted LLM API endpoint and yields streamed response chunks.

        Constructs a request payload using the current context and additional parameters,
        sends it to the local model's `/chat` endpoint, and streams the response back.
        The full decoded content is also appended to the conversation context.

        Args:
            args: Additional arguments to be merged into the request JSON.
            tool_name: The name of the tool to include in the payload.
            tool_list: The tool's function list or identifier string.

        Returns:
            The text content of each streamed response chunk as UTF-8 decoded strings.
        """
        payload = {
            "mode": "instruct",
            "messages": self.context.get(),
            "tool_name": tool_name,
            "tool_list": tool_list,
            "temperature": self.temperature,
            "enable_thinking": self.args.get("enable_thinking", False),
            **args
        }

        # Initialize tool registry if not already done
        if self.tool_registry is None:
            self._initialize_tool_registry()

        from modules.inference import Inference

        model_path = f"{settings.model_dir}/{settings.model_name}"
        inference = Inference(
            model_path=model_path,
            temperature=self.get_temperature(payload),
            tool_name=payload.get("tool_name", None),
            tool_list=payload.get("tool_list", None),
            enable_thinking=payload.get("enable_thinking", False),
            debug=True,
            stop_event=self.stop_event,
            tool_registry=self.tool_registry
        )

        inference.model = self.model
        return inference.generate(payload["messages"])

    def get_agenda(self) -> str:
        """
        Retrieves a combined daily agenda consisting of weather and calendar information.

        This method sends queries to obtain the current weather and the day's calendar schedule
        using the model associated with this instance. It processes the responses using
        ChatBot's streaming message handler and combines them into a single formatted string.

        Returns:
            A string containing the weather information followed by the calendar schedule,
            separated by two newlines.
        """
        if self.model_name is None:
            raise RuntimeError("Model must be specified before LLM is called.")

        weather_content = get_weather_info("What's the weather today?")
        calendar_content = get_schedule("What's on my calendar today?")

        return f"{weather_content}\n\n{calendar_content}"

    def get_request_type(self, message: str) -> Dict[str, Any]:
        """
        Classifies a user instruction into a predefined request type category.

        This method constructs a prompt to classify the given instruction into one of several
        categories such as "music", "lights", "weather", "calendar", "agenda", "math", or "other".
        It sends the prompt to a chatbot and expects a single-line JSON response with a "category" field.

        Args:
            message: The user's instruction to classify.

        Returns:
            A dictionary with a single key "category" indicating the classified request type.
        """
        prompt = """
        I want you to put this instruction into one of multiple categories. If the instruction is to play some music, the category is "music". If the instruction is to control lights, the category is "lights". If the instruction is asking about the weather or the moon's phase, the category is "weather". If the instruction is asking about today's calendar, or is something like 'What's happening today' or 'What is my schedule', the category is "calendar". If the instruction is asking about today's agenda, or something like 'What's my update?', the category is "agenda". If the instruction is asking for mathematical calculation, the category is "math". For everything else, the category is "other". Give me the category in JSON format with the field name "category". Do not format the JSON by including newlines. Give only the JSON and no additional characters, text, or comments. Here is the instruction:
        """
        prompt += message
        content = self.send_message_to_model(prompt)

        if settings.debug:
            print(f"{content=}")

        response_json = None
        try:
            cleaned_content = clean_model_response(content)
            chatbot_logger.debug(f"Parsing request type JSON (cleaned, first 200 chars): {cleaned_content[:200]}")
            response_json = json.loads(cleaned_content)
            chatbot_logger.debug(f"Successfully parsed request type: {response_json}")
        except ValueError as e:
            chatbot_logger.error(f"Content generating invalid JSON: {content[:500]}, Error: {e}", exc_info=True)
            print(f"Content generating invalid JSON: {content}")
            raise ValueError("Request type response is not proper JSON.") from e

        return response_json

    def _handle_tool_calls_in_response(self, messages: List[Dict[str, Any]], response: str) -> Iterator[str] | None:
        """
        Check if the model response contains tool calls and execute them.

        Args:
            messages: The current conversation messages.
            response: The model's response text.

        Returns:
            An iterator yielding the final response after tool execution, or None if no tool calls found.
        """
        # Look for <tool_call> tags or bare JSON that looks like a tool call
        # First try to find <tool_call> tags
        tool_call_start = response.find("<tool_call>")
        json_start = -1

        if tool_call_start != -1:
            # Find the start of JSON (first { after <tool_call>)
            json_start = response.find("{", tool_call_start)
        else:
            # No tags, look for JSON that looks like a tool call
            # Try to find JSON objects - start from the beginning
            json_start = response.find("{")
            if json_start == -1:
                return None

        if json_start == -1:
            return None

        # Find the matching closing brace by counting braces
        brace_count = 0
        json_end = -1
        for i in range(json_start, len(response)):
            if response[i] == "{":
                brace_count += 1
            elif response[i] == "}":
                brace_count -= 1
                if brace_count == 0:
                    json_end = i + 1
                    break

        if json_end == -1:
            chatbot_logger.warning("Could not find matching closing brace for tool call JSON")
            return None

        json_str = response[json_start:json_end].strip()
        chatbot_logger.info(f"Found potential tool call in model response, extracted JSON: {json_str}")
        print(f"[ChatBot] Found potential tool call JSON: {json_str}")  # Fallback for visibility

        try:
            tool_call = json.loads(json_str)
            tool_name = tool_call.get("name")
            arguments = tool_call.get("arguments", {})

            # Validate this is actually a tool call (has name and arguments)
            if not tool_name:
                chatbot_logger.debug("JSON found but missing 'name' field, not a tool call")
                return None

            if "arguments" not in tool_call:
                chatbot_logger.debug("JSON found but missing 'arguments' field, not a tool call")
                return None

            # Initialize tool registry if needed (before checking if tool exists)
            if self.tool_registry is None:
                self._initialize_tool_registry()

            if self.tool_registry is None:
                chatbot_logger.error("Tool registry not available")
                return None

            # Initialize tool registry if needed (before checking if tool exists)
            if self.tool_registry is None:
                self._initialize_tool_registry()

            if self.tool_registry is None:
                chatbot_logger.error("Tool registry not available")
                return None

            # Check if tool exists in registry
            if not self.tool_registry.get_tool(tool_name):
                chatbot_logger.debug(f"Tool '{tool_name}' not found in registry, not executing")
                return None

            chatbot_logger.info(f"Executing tool call: {tool_name} with arguments: {arguments}")
            print(f"[ChatBot] Executing tool call: {tool_name} with arguments: {arguments}")  # Fallback for visibility

            # Execute the tool
            try:
                tool_result = self.tool_registry.call_tool(tool_name, arguments)
                chatbot_logger.info(f"Tool {tool_name} returned result (length: {len(str(tool_result))} chars): {str(tool_result)[:500]}")
                print(f"[ChatBot] Tool {tool_name} returned result (length: {len(str(tool_result))} chars): {str(tool_result)[:500]}")
            except Exception as e:
                chatbot_logger.error(f"Error executing tool {tool_name}: {e}", exc_info=True)
                print(f"[ChatBot] ERROR executing tool {tool_name}: {e}")  # Fallback for visibility
                import traceback
                print(f"[ChatBot] Traceback: {traceback.format_exc()}")  # Full traceback
                # Return error message
                error_msg = f"Error executing tool {tool_name}: {str(e)}"
                def yield_error() -> Iterator[str]:
                    yield error_msg
                return yield_error()

            # Add tool call and result to messages
            # Format must match what the chat template expects
            tool_call_id = "".join(random.choices(string.ascii_letters + string.digits, k=6))
            chatbot_logger.info(f"Adding tool call to messages with ID: {tool_call_id}")
            print(f"[ChatBot] Adding tool call to messages with ID: {tool_call_id}")
            messages.append({
                "role": "assistant",
                "content": "",  # Use empty string instead of None to avoid template errors
                "tool_calls": [{
                    "id": tool_call_id,
                    "type": "function",
                    "function": {
                        "name": tool_name,
                        "arguments": json.dumps(arguments) if isinstance(arguments, dict) else str(arguments)
                    }
                }]
            })
            messages.append({
                "role": "tool",
                "tool_call_id": tool_call_id,
                "name": tool_name,
                "content": str(tool_result)
            })
            chatbot_logger.info(f"Messages after adding tool call/result: {len(messages)} messages")
            print(f"[ChatBot] Messages after adding tool call/result: {len(messages)} messages")

            # Send back to model for final response
            chatbot_logger.info("Sending tool result back to model for final response")
            print(f"[ChatBot] Sending tool result back to model for final response")
            try:
                final_response = self.send_message_to_model(messages, stream=True, replace_context=True)
                chatbot_logger.info(f"Got final response from model (type: {type(final_response)})")
                print(f"[ChatBot] Got final response from model (type: {type(final_response)})")
            except Exception as e:
                chatbot_logger.error(f"Error sending tool result back to model: {e}", exc_info=True)
                print(f"[ChatBot] ERROR sending tool result back to model: {e}")
                import traceback
                print(f"[ChatBot] Traceback: {traceback.format_exc()}")
                raise

            chatbot_logger.info(f"Processing final response (hasattr __iter__: {hasattr(final_response, '__iter__')}, is str: {isinstance(final_response, str)})")
            print(f"[ChatBot] Processing final response (hasattr __iter__: {hasattr(final_response, '__iter__')}, is str: {isinstance(final_response, str)})")
            if hasattr(final_response, "__iter__") and not isinstance(final_response, str):
                # Clean streaming response
                chatbot_logger.info("Final response is iterable, collecting chunks")
                print(f"[ChatBot] Final response is iterable, collecting chunks")
                def yield_cleaned_response() -> Iterator[str]:
                    chunks = []
                    chunk_count = 0
                    for chunk in final_response:
                        chunks.append(chunk)
                        chunk_count += 1
                    chatbot_logger.info(f"Collected {chunk_count} chunks, total length: {len(''.join(chunks))}")
                    print(f"[ChatBot] Collected {chunk_count} chunks, total length: {len(''.join(chunks))}")
                    cleaned = clean_model_response("".join(chunks))
                    chatbot_logger.info(f"Cleaned response length: {len(cleaned)}")
                    print(f"[ChatBot] Cleaned response length: {len(cleaned)}")
                    yield cleaned
                return yield_cleaned_response()
            else:
                chatbot_logger.info("Final response is not iterable or is string")
                print(f"[ChatBot] Final response is not iterable or is string")
                def yield_response() -> Iterator[str]:
                    if isinstance(final_response, str):
                        yield clean_model_response(final_response)
                    else:
                        chunks = []
                        for chunk in final_response:
                            chunks.append(chunk)
                        cleaned = clean_model_response("".join(chunks))
                        yield cleaned
                return yield_response()

        except json.JSONDecodeError as e:
            chatbot_logger.error(f"Failed to parse tool call JSON: {e}, JSON: {json_str}")
            return None

    def _build_mcp_server_configs(self) -> Dict[str, Dict[str, Any]]:
        """
        Merge static MCP server config with optional CLI-provided HTTP server details.
        """
        configured_servers = dict(getattr(settings, "MCP_SERVERS", {}))
        url = self.mcp_server_url

        if url:
            name = self.mcp_server_name or "django_mcp"
            token = self.mcp_token or ""
            endpoint = self.mcp_endpoint or "mcp"
            configured_servers[name] = {
                "url": url.rstrip("/"),
                "transport": "http",
                "token": token,
                "endpoint": endpoint,
            }

        return configured_servers

    def _start_postgres_mcp_server(self) -> subprocess.Popen[bytes] | None:
        """
        Start the postgres MCP server as a background subprocess.

        Returns:
            The subprocess.Popen object if successful, None otherwise.
        """
        try:
            # Find the run_pg_mcp_server.py script
            root_dir = Path(__file__).resolve().parent.parent
            server_script = root_dir / "run_pg_mcp_server.py"

            if not server_script.exists():
                chatbot_logger.error(f"Postgres MCP server script not found at {server_script}")
                return None

            # Start the server as a background process
            chatbot_logger.info(f"Starting postgres MCP server: {server_script}")
            process = subprocess.Popen(
                [sys.executable, str(server_script)],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=os.environ.copy(),
            )

            # Give it a moment to start
            time.sleep(0.5)

            # Check if process is still running (hasn't crashed immediately)
            if process.poll() is not None:
                # Process exited, try to read error
                stderr_output = process.stderr.read(1024) if process.stderr else b""
                chatbot_logger.error(
                    f"Postgres MCP server exited immediately. Error: {stderr_output.decode('utf-8', errors='ignore')}"
                )
                return None

            chatbot_logger.info(f"Postgres MCP server started with PID {process.pid}")
            return process
        except Exception as e:
            chatbot_logger.error(f"Failed to start postgres MCP server: {e}", exc_info=True)
            return None

    def _initialize_tool_registry(self) -> None:
        """
        Initialize the tool registry with MCP servers from settings.

        This method creates a ToolRegistry and connects to configured MCP servers.
        """
        from modules.mcp_client import MCPClient
        from modules.mcp_exceptions import MCPConnectionError, MCPServerError

        self.tool_registry = ToolRegistry()

        # Load MCP tools from configured servers
        mcp_servers = self._build_mcp_server_configs()
        for server_name, server_config in mcp_servers.items():
            try:
                transport = server_config.get("transport", "stdio")
                chatbot_logger.info(f"[MCP Setup] Server '{server_name}': transport='{transport}', config={server_config}")
                if transport == "stdio":
                    command = server_config.get("command")
                    args = server_config.get("args", [])
                    env = server_config.get("env", {})
                    if not command:
                        chatbot_logger.warning(f"MCP server '{server_name}' missing 'command' for stdio transport")
                        continue

                    client = MCPClient(
                        server_name=server_name,
                        command=command if isinstance(command, list) else [command],
                        args=args,
                        env=env,
                        transport="stdio",
                    )
                elif transport == "http":
                    url = server_config.get("url")
                    if not url:
                        chatbot_logger.warning(f"MCP server '{server_name}' missing 'url' for http transport")
                        continue
                    token = server_config.get("token")
                    endpoint = server_config.get("endpoint", "mcp")
                    headers = server_config.get("headers", {})

                    # Check if server is running, auto-start if needed
                    if not MCPClient.check_server_health(url, endpoint):
                        chatbot_logger.info(f"[MCP {server_name}] Server not running, attempting to auto-start...")
                        if server_name == "postgres":
                            # Auto-start postgres MCP server
                            server_process = self._start_postgres_mcp_server()
                            if server_process:
                                self._auto_started_processes.append(server_process)
                                # Wait for server to be ready with exponential backoff
                                max_wait = 10  # seconds
                                wait_time = 0.5
                                elapsed = 0.0
                                while elapsed < max_wait:
                                    if MCPClient.check_server_health(url, endpoint):
                                        chatbot_logger.info(f"[MCP {server_name}] Server is now ready after {elapsed:.1f}s")
                                        break
                                    time.sleep(wait_time)
                                    elapsed += wait_time
                                    wait_time = min(wait_time * 1.5, 2.0)  # Exponential backoff, max 2s
                                else:
                                    chatbot_logger.warning(
                                        f"[MCP {server_name}] Server did not become ready after {max_wait}s. "
                                        f"Please start it manually: python run_pg_mcp_server.py"
                                    )
                                    continue
                            else:
                                chatbot_logger.warning(
                                    f"[MCP {server_name}] Failed to auto-start server. "
                                    f"Please start it manually: python run_pg_mcp_server.py"
                                )
                                continue
                        else:
                            chatbot_logger.warning(
                                f"[MCP {server_name}] Server not running and auto-start not supported. "
                                f"Please start the server manually."
                            )
                            continue

                    client = MCPClient(
                        server_name=server_name,
                        url=url,
                        transport="http",
                        auth_token=token,
                        endpoint_path=endpoint,
                        headers=headers,
                    )
                else:
                    chatbot_logger.warning(f"MCP server '{server_name}' has unsupported transport '{transport}'")
                    continue

                # Connect and register MCP client
                client.connect()
                # Extract allowed path from args for filesystem servers
                allowed_path = None
                if server_name == "filesystem":
                    server_config = mcp_servers[server_name]
                    args = server_config.get("args", [])
                    if args:
                        # The last argument is typically the allowed directory
                        allowed_path = args[-1]
                self.tool_registry.register_mcp_client(server_name, client, allowed_path=allowed_path)
                chatbot_logger.info(f"Successfully connected to MCP server: {server_name}")
            except (MCPConnectionError, MCPServerError) as e:
                chatbot_logger.warning(f"Failed to connect to MCP server '{server_name}': {e}")
            except Exception as e:
                chatbot_logger.warning(f"Error setting up MCP server '{server_name}': {e}")

    def cleanup(self) -> None:
        """
        Clean up resources, including disconnecting MCP servers.

        This method should be called when the ChatBot instance is no longer needed.
        """
        if self.tool_registry:
            try:
                self.tool_registry.disconnect_all_mcp_servers()
            except Exception as e:
                chatbot_logger.warning(f"Error cleaning up MCP servers: {e}")

        # Terminate auto-started server processes
        for process in self._auto_started_processes:
            try:
                if process.poll() is None:  # Process is still running
                    chatbot_logger.info(f"Terminating auto-started MCP server process (PID {process.pid})")
                    process.terminate()
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        chatbot_logger.warning(f"Process {process.pid} did not terminate, killing it")
                        process.kill()
                        process.wait()
            except Exception as e:
                chatbot_logger.warning(f"Error terminating auto-started process: {e}")
        self._auto_started_processes.clear()

    @staticmethod
    def get_model_attribute(model_name: str | None, attribute: str) -> Any | None:
        """
        Retrieves a specific attribute for a given model from the model_info dictionary.

        Args:
            model_name: The name of the model to look up.
            attribute: The attribute key to retrieve for the given model.

        Returns:
            The value of the attribute if it exists, otherwise None.
        """
        if model_name and \
           model_name in model_info and \
           attribute in model_info[model_name]:
            return model_info[model_name][attribute]
        return None

    @staticmethod
    def get_model_list() -> List[Dict[str, Any]]:
        """
        Retrieves and returns a sorted list of available models, including both local and API-based ones.

        Fetches the model list from the server endpoint, appends additional models defined via API config,
        transforms them into a standardized list of dictionaries, and returns the sorted result.

        Recursively searches subdirectories for .gguf files and uses relative paths as model identifiers
        to support models stored in nested directories (e.g., "Qwen3-8B-GGUF/Qwen3-8B-Q6_K.gguf").

        Returns:
            A sorted list of dictionaries, where each dictionary contains metadata about a model,
            such as "model", "name", "type", and optional "qwen_vision".
        """
        directory = settings.model_dir
        if not os.path.isdir(directory):
            raise ValueError(f"{directory} is not a valid directory.")

        model_names = []
        # Recursively search for .gguf files in subdirectories
        for root, dirs, files in os.walk(directory):
            # Calculate relative path from model_dir
            rel_root = os.path.relpath(root, directory)

            # Look for .gguf files in current directory
            for file in files:
                if file.endswith(".gguf"):
                    # If file is in root (model_dir), use just filename
                    # Otherwise use relative path (e.g., "Qwen3-8B-GGUF/Qwen3-8B-Q6_K.gguf")
                    if rel_root == ".":
                        model_names.append(file)
                    else:
                        model_names.append(os.path.join(rel_root, file))

            # For backward compatibility: include directories that don't contain .gguf files
            # but only at the top level (not recursively, to avoid duplicates)
            if rel_root == ".":
                for item in dirs:
                    item_path = os.path.join(root, item)
                    # Check if this directory contains any .gguf files
                    try:
                        has_gguf = any(
                            f.endswith(".gguf") and os.path.isfile(os.path.join(item_path, f))
                            for f in os.listdir(item_path)
                        )
                        # Only add directory if it doesn't contain .gguf files (legacy behavior)
                        if not has_gguf:
                            model_names.append(item)
                    except (OSError, PermissionError):
                        # Skip directories we can't read
                        continue

        # Add API-based models
        model_names.extend(
            [
                k
                for k, v
                in model_info.items()
                if "type" in v and v["type"] == "api"]
        )

        model_list = ChatBot.get_personal_model_names(model_names)

        return sort_models(
            model_list,
            [v.get("name", None) for _, v in model_info.items()]
        )

    @staticmethod
    def get_personal_model_names(model_list: List[str]) -> List[Dict[str, Any]]:
        """
        Maps a list of model names to detailed model metadata dictionaries.

        For each model in the input list, looks up details in the `model_info` dictionary
        and constructs a standardized representation. Includes all attributes from models.yaml.

        Args:
            model_list: A list of model identifier strings.

        Returns:
            A list of dictionaries, each containing keys:
                - "model": the model identifier
                - "name": the display name
                - All other attributes from models.yaml (e.g., "type", "qwen_vision", "thinking", "vendor", etc.)
        """
        models = []
        for x in model_list:
            model_data = model_info.get(x, {})
            # Start with the model identifier
            model_dict = {"model": x}
            # Add the name, defaulting to the model identifier if not specified
            # For nested paths, use just the filename (basename) as the default display name
            if "name" in model_data:
                model_dict["name"] = model_data["name"]
            else:
                # If identifier contains a path separator, use basename; otherwise use identifier
                if os.sep in x or "/" in x:
                    model_dict["name"] = os.path.basename(x)
                else:
                    model_dict["name"] = x
            # Include all other attributes from models.yaml
            for key, value in model_data.items():
                if key != "name":  # name is already set above
                    model_dict[key] = value
            models.append(model_dict)
        return models


def main() -> None:
    """
    Command-line entry point for launching a chatbot in various modes (interactive, local LLM, or ChatGPT-based).

    This module provides a command-line interface to run a voice-enabled chatbot either
    in interactive terminal mode or connected to Discord using either a local language
    model or OpenAI's ChatGPT.

    Supported options:
        -a, --assistant     : Enable assistant-specific behavior (passed to ChatBot).
        -d, --debug         : Enable debug mode.
        -m, --mode          : Choose between 'interactive' (default), 'localllm', or 'chatgpt'.
        --tts               : Enable Text-to-Speech output.
        --stt               : Enable Speech-to-Text input.

    Usage:
        python run.py --mode chatgpt
        python run.py --tts --stt
        python run.py -m localllm -a -d

    Depending on the mode, the script either launches:
        - an interactive console-based chatbot
        - a Discord bot powered by a local LLM
        - a Discord bot using OpenAI's ChatGPT
    """
    parser = argparse.ArgumentParser(description="")
    parser.add_argument(
        "-a",
        "--assistant",
        help="Assistant mode",
        action="store_true"
    )
    parser.add_argument(
        "-d",
        "--debug",
        help="Debug mode",
        action="store_true"
    )
    parser.add_argument(
        "-m",
        "--mode",
        choices=["chatgpt", "localllm", "interactive"],
        default="interactive",
        help="The mode: interactive, localllm on discord, chatgpt on discord"
    )
    parser.add_argument(
        "--tts",
        help="TTS (Text to Speech)",
        action="store_true"
    )
    parser.add_argument(
        "--stt",
        help="STT (Speech to Text)",
        action="store_true"
    )
    parser.add_argument(
        "--mcp-server-url",
        help="HTTP base URL for an MCP server (without trailing /mcp).",
        default=None
    )
    parser.add_argument(
        "--mcp-server-name",
        help="Name to register the MCP server under (default: django_mcp).",
        default=None
    )
    parser.add_argument(
        "--mcp-token",
        help="Bearer token for the MCP server (if required).",
        default=None
    )
    parser.add_argument(
        "--mcp-endpoint",
        help="Endpoint path for MCP requests (default: mcp).",
        default=None
    )
    args = parser.parse_args()

    if args.mode == "interactive":
        chatbot = ChatBot(
            assistant=args.assistant,
            debug=args.debug,
            stt=args.stt,
            tts=args.tts,
            mcp_server_url=args.mcp_server_url,
            mcp_server_name=args.mcp_server_name,
            mcp_token=args.mcp_token,
            mcp_endpoint=args.mcp_endpoint,
        )
        chatbot.interactive()
    elif args.mode == "chatgpt":
        from modules.discord_bot import DiscordBot
        bot = DiscordBot(model_name="gpt-4o-mini")
        bot.run_bot()
    elif args.mode == "localllm":
        from modules.discord_bot import DiscordBot
        bot = DiscordBot()
        bot.run_bot()


if __name__ == "__main__":
    main()
