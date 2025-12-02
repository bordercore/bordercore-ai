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
import argparse
import json
import logging
import os
import string
import sys
import tempfile
import urllib.parse
import warnings
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
from modules.inference import Inference
from modules.music import play_music
from modules.util import (get_model_info, get_webpage_contents, sort_models,
                          strip_code_fences)
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

        if "temperature" in self.args:
            self.temperature = self.args["temperature"]

    @staticmethod
    def get_api_endpoints() -> dict[str, str]:
        """
        Return the endpoints for local LLM HTTP API interactions.

        Returns:
            Mapping of endpoint keys to full URL strings.
        """
        host = settings.api_host
        return {
            "CHAT": f"{host}/v1/chat/completions",
            "MODEL_INFO": f"{host}/v1/internal/model/info",
            "MODEL_LIST": f"{host}/v1/internal/model/list",
            "MODEL_LOAD": f"{host}/v1/internal/model/load",
        }

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
                        result = WolframAlphaFunctionCall(self).run(content)
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

            tool_output = self.get_message_handler(category, content)

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
            return self.send_message_to_model(messages, stream=True, replace_context=True)
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

        model_path = f"{settings.model_dir}/{settings.model_name}"
        inference = Inference(
            model_path=model_path,
            temperature=self.get_temperature(payload),
            tool_name=payload.get("tool_name", None),
            tool_list=payload.get("tool_list", None),
            enable_thinking=payload.get("enable_thinking", False),
            debug=True,
            stop_event=self.stop_event
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
            cleaned_content = strip_code_fences(content)
            chatbot_logger.debug(f"Parsing request type JSON (cleaned, first 200 chars): {cleaned_content[:200]}")
            response_json = json.loads(cleaned_content)
            chatbot_logger.debug(f"Successfully parsed request type: {response_json}")
        except ValueError as e:
            chatbot_logger.error(f"Content generating invalid JSON: {content[:500]}, Error: {e}", exc_info=True)
            print(f"Content generating invalid JSON: {content}")
            raise ValueError("Request type response is not proper JSON.") from e

        return response_json

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

        Returns:
            A sorted list of dictionaries, where each dictionary contains metadata about a model,
            such as "model", "name", "type", and optional "qwen_vision".
        """
        directory = settings.model_dir
        if not os.path.isdir(directory):
            raise ValueError(f"{directory} is not a valid directory.")

        directories = []
        for item in os.listdir(directory):
            full_path = os.path.join(directory, item)
            if os.path.isdir(full_path) or full_path.endswith("gguf"):
                directories.append(item)

        model_names = directories

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
            model_dict["name"] = model_data.get("name", x)
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
    args = parser.parse_args()

    if args.mode == "interactive":
        chatbot = ChatBot(assistant=args.assistant, debug=args.debug, stt=args.stt, tts=args.tts)
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
