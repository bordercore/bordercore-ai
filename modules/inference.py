"""
This module defines an `Inference` class that loads, configures, and interacts with
language and vision models (e.g., Qwen, LLaMA, Gemma). It supports quantization,
custom templates, image-based prompts, and streaming text generation.

The module can be executed as a script to run inference interactively or with an image.
"""
from __future__ import annotations

import argparse
import base64
import importlib
import json
import logging
import platform
from pathlib import Path
from threading import Event, Thread
from typing import TYPE_CHECKING, Any, Dict, Generator, List

try:
    import llama_cpp
except ImportError:
    llama_cpp = None

import settings
from modules.context import Context
from modules.mcp_client import MCPClient
from modules.mcp_exceptions import MCPConnectionError, MCPServerError
from modules.tool_registry import ToolRegistry
from modules.util import get_model_info

logger = logging.getLogger(__name__)

COLOR_GREEN = "\033[32m"
COLOR_BLUE = "\033[34m"
COLOR_RESET = "\033[0m"

# Heavy ML imports (torch, transformers, qwen_vl_utils) are loaded lazily
# so that importing this module doesn't require them to be installed.
if TYPE_CHECKING:
    import torch
    from qwen_vl_utils import process_vision_info
    from transformers import (
        AutoModelForCausalLM,
        AutoProcessor,
        AutoTokenizer,
        BitsAndBytesConfig,
        Qwen2_5_VLForConditionalGeneration,
        StoppingCriteria,
        StoppingCriteriaList,
        TextIteratorStreamer,
        pipeline,
    )

    class EventStoppingCriteria(StoppingCriteria):
        ...

_ml_imports_done = False


def _ensure_ml_imports() -> None:
    """Import torch, transformers, and qwen_vl_utils on first use."""
    global _ml_imports_done
    if _ml_imports_done:
        return

    import torch as _torch
    import transformers as _transformers
    from qwen_vl_utils import process_vision_info as _process_vision_info
    from transformers import (
        AutoModelForCausalLM as _AutoModelForCausalLM,
        AutoProcessor as _AutoProcessor,
        AutoTokenizer as _AutoTokenizer,
        BitsAndBytesConfig as _BitsAndBytesConfig,
        Qwen2_5_VLForConditionalGeneration as _Qwen2_5_VL,
        StoppingCriteria as _StoppingCriteria,
        StoppingCriteriaList as _StoppingCriteriaList,
        TextIteratorStreamer as _TextIteratorStreamer,
        pipeline as _pipeline,
    )

    _transformers.logging.set_verbosity_error()

    class _EventStoppingCriteria(_StoppingCriteria):
        """Stop generation when a threading.Event is set."""

        def __init__(self, stop_event: Event) -> None:
            self.stop_event = stop_event

        def __call__(self, input_ids: Any, scores: Any, **kwargs: Any) -> bool:
            return self.stop_event.is_set()

    # Publish into module globals so the rest of the code works unchanged.
    g = globals()
    g["torch"] = _torch
    g["transformers"] = _transformers
    g["process_vision_info"] = _process_vision_info
    g["AutoModelForCausalLM"] = _AutoModelForCausalLM
    g["AutoProcessor"] = _AutoProcessor
    g["AutoTokenizer"] = _AutoTokenizer
    g["BitsAndBytesConfig"] = _BitsAndBytesConfig
    g["Qwen2_5_VLForConditionalGeneration"] = _Qwen2_5_VL
    g["StoppingCriteria"] = _StoppingCriteria
    g["StoppingCriteriaList"] = _StoppingCriteriaList
    g["TextIteratorStreamer"] = _TextIteratorStreamer
    g["pipeline"] = _pipeline
    g["EventStoppingCriteria"] = _EventStoppingCriteria

    _ml_imports_done = True


class Inference:
    """
    Encapsulates model loading, prompt construction, and text generation for
    various language and vision models.

    Attributes:
        max_new_tokens (int): The maximum number of tokens to generate.
        temperature_default (float): The default sampling temperature.
        top_p (float): The nucleus sampling probability.
        top_k (int): The number of top tokens to consider for sampling.
    """

    max_new_tokens: int = 4096
    temperature_default: float = 0.7
    top_p: float = 0.95
    top_k: int = 40

    def __init__(
        self,
        model_path: str,
        temperature: float | None = None,
        quantize: bool = False,
        tool_name: str | None = None,
        tool_list: str | None = None,
        enable_thinking: bool = False,
        debug: bool = False,
        stop_event: Event | None = None,
        tool_registry: ToolRegistry | None = None,
    ) -> None:
        """
        Initializes the Inference class.

        Args:
            model_path: Path to the model directory.
            temperature: Sampling temperature for generation.
            quantize: If True, applies 4-bit quantization to the model.
            tool_name: The name of the tool module to use.
            tool_list: The function name to use from the tool module.
            enable_thinking: If True, enables tool reasoning mode.
            debug: If True, enables verbose debug output.
        """
        _ensure_ml_imports()

        self.model_path = model_path
        self.model_name = Path(model_path).parts[-1]
        self.quantize = quantize
        self.debug = debug

        self.context = Context()
        self.model_info = get_model_info()
        self.temperature = temperature or self.temperature_default

        self.tool_name = tool_name
        self.tool_list = tool_list
        self.enable_thinking = enable_thinking
        # Use provided tool_registry or create a new one
        self.tool_registry: ToolRegistry | None = tool_registry
        self.tools = self.load_tools()

        self.tokenizer = self.load_tokenizer()
        self.model: Any | None = None
        self.stop_event = stop_event

    def load_model(self) -> None:
        """
        Load the appropriate language or vision-language model into memory.

        This method determines the type of model to load based on the configuration
        and model name, then initializes it using the Hugging Face `from_pretrained()`
        interface. It supports standard causal language models, Qwen2-VL vision models,
        4-bit AWQ quantized models, and GGUF models.

        Behavior:
          - For GGUF models: uses `AutoModelForCausalLM` with `gguf_file` parameter.
          - For Qwen2-VL models: uses `Qwen2_5_VLForConditionalGeneration`.
          - For models containing 'awq' in their name: dynamically imports and loads
            `AutoAWQForCausalLM` with quantization-specific arguments.
          - For all other models: uses `AutoModelForCausalLM`.
        """
        print(f"load_model() called for model_path: {self.model_path}", flush=True)
        logger.info(f"load_model() called for model_path: {self.model_path}")

        # Check path status
        model_path_obj = Path(self.model_path)
        print(f"  Path exists: {model_path_obj.exists()}, is_file: {model_path_obj.is_file()}, is_dir: {model_path_obj.is_dir()}", flush=True)
        logger.info(f"Path exists: {model_path_obj.exists()}, is_file: {model_path_obj.is_file()}, is_dir: {model_path_obj.is_dir()}")

        print("  Calling get_model_loading_args()...", flush=True)
        model_config_args = self.get_model_loading_args()
        print(f"  ✓ Got model_config_args: { {k:v for k,v in model_config_args.items() if k != 'gguf_file'} }", flush=True)

        is_gguf = self._is_gguf_model()

        if is_gguf:
            if llama_cpp is None:
                raise ImportError(
                    "The 'llama-cpp-python' package is required for GGUF models. "
                    "Please install it with: pip install llama-cpp-python"
                )

            # For GGUF models, determine if model_path is a file or directory
            model_path_obj = Path(self.model_path)

            # If it's a directory, find the .gguf file inside it
            if model_path_obj.is_dir():
                gguf_files = list(model_path_obj.glob("*.gguf"))
                if not gguf_files:
                    raise ValueError(
                        f"Directory {self.model_path} does not contain any .gguf files"
                    )
                # Use the first .gguf file found (or prefer Q8_0 if multiple)
                gguf_file_obj = gguf_files[0]
                for gf in gguf_files:
                    if "Q8_0" in gf.name or "q8_0" in gf.name:
                        gguf_file_obj = gf
                        break
                self.model_path = str(gguf_file_obj)

            # Try loading with configured settings, fallback to lower memory if needed
            low_memory_mode = getattr(settings, "gguf_low_memory_mode", False)
            input_context_size = 1024 if low_memory_mode else getattr(settings, "gguf_input_context_size", 2048)
            n_ctx = input_context_size + self.max_new_tokens
            attempt = 0
            max_attempts = 2

            while attempt < max_attempts:
                try:
                    # Load with llama-cpp-python for high performance (Metal on Mac, CUDA on Linux)
                    # n_gpu_layers=-1 offloads all layers to the GPU
                    # n_ctx should include both input context and output tokens
                    # Default: 2048 for input context + max_new_tokens for output
                    # Low memory mode: 1024 for input context + max_new_tokens for output
                    if attempt == 0:
                        logger.info(f"Loading GGUF model with n_ctx={n_ctx} (input={input_context_size}, output={self.max_new_tokens})")
                    else:
                        logger.info(f"Retrying GGUF model load with reduced context: n_ctx={n_ctx} (input={input_context_size}, output={self.max_new_tokens})")
                    self.model = llama_cpp.Llama(
                        model_path=self.model_path,
                        n_gpu_layers=-1,
                        n_ctx=n_ctx,
                        verbose=self.debug
                    )
                    logger.info("GGUF model loaded successfully with llama-cpp-python")
                    break
                except (RuntimeError, MemoryError) as e:
                    error_msg = str(e)
                    # Check if this is a memory error and we haven't already tried low memory mode
                    is_memory_error = (
                        "llama_decode returned -3" in error_msg or
                        "returned -3" in error_msg or
                        "memory" in error_msg.lower() or
                        isinstance(e, MemoryError)
                    )
                    if is_memory_error and attempt == 0 and not low_memory_mode:
                        # Automatically retry with lower context size
                        attempt += 1
                        input_context_size = 1024
                        n_ctx = input_context_size + self.max_new_tokens
                        logger.warning(
                            f"Memory error during model load, retrying with reduced context size "
                            f"(n_ctx={n_ctx}). Consider setting 'gguf_low_memory_mode = True' in settings.py"
                        )
                        continue
                    else:
                        # Re-raise with helpful message if it's a memory error after fallback, or not a memory error
                        if is_memory_error:
                            logger.error(f"Memory allocation failure while loading GGUF model: {e}")
                            helpful_msg = (
                                "Out of memory error while loading GGUF model. This usually means:\n"
                                "1. The model is too large for available RAM/VRAM\n"
                                "2. The context window (n_ctx) is too large\n\n"
                                "Try these solutions:\n"
                                "- Enable low memory mode: Set 'gguf_low_memory_mode = True' in settings.py\n"
                                "- Reduce input context size: Set 'gguf_input_context_size = 1024' (or lower) in settings.py\n"
                                "- Use a smaller model\n"
                                "- Close other applications to free up memory"
                            )
                            raise RuntimeError(helpful_msg) from e
                        else:
                            raise
                except Exception as e:
                    # Catch any other exceptions not caught above (non-memory errors)
                    logger.error(f"Error loading GGUF model with llama-cpp-python: {e}")
                    raise RuntimeError(f"Failed to load GGUF model: {e}") from e
        elif self._is_vision_model():
            if "awq" in self.model_name.lower():
                from transformers import AwqConfig

                awq_config = AwqConfig(bits=4, backend="gemm")
                model_config_args["quantization_config"] = awq_config

            self.model = Qwen2_5_VLForConditionalGeneration.from_pretrained(
                self.model_path, **model_config_args
            )
        elif "awq" in self.model_name.lower():
            # Dynamically import for AWQ models to avoid hard dependency
            try:
                from awq import AutoAWQForCausalLM
            except ImportError as e:
                raise ImportError(
                    "The 'awq' package is required for this model but is not installed."
                ) from e

            awq_args = {
                "fuse_layers": self.get_config_option("fuse_layers", True),
                "safetensors": True,
                "batch_size": 1,
                "max_memory": {0: "8000MiB", "cpu": "99GiB"},
            }
            self.model = AutoAWQForCausalLM.from_quantized(
                self.model_path, **awq_args, **model_config_args
            ).model
        else:
            self.model = AutoModelForCausalLM.from_pretrained(
                self.model_path, **model_config_args
            )

    def generate(self, messages: List[Dict[str, Any]]) -> Generator[str, None, None]:
        """
        Generates a streaming text response from the model.

        This function orchestrates the generation process by preparing messages,
        applying the correct chat template, and dispatching to the appropriate
        model-specific generation method.

        Args:
            messages: A list of chat messages, each with a 'role' and 'content'.

        Yields:
            A generator that produces chunks of the response text.
        """
        if self.stop_event and self.stop_event.is_set():
            return

        if self.model is None:
            raise RuntimeError("Model must be loaded before calling generate().")

        prepared_messages = self.prepare_messages_for_generation(messages)

        # Dispatch to the correct engine based on the model type
        if llama_cpp is not None and isinstance(self.model, llama_cpp.Llama):
            yield from self.generate_with_gguf_model(prepared_messages)
        elif self._is_vision_model():
            # For vision models with list content, skip template application here
            # It will be handled in generate_with_vision_model
            has_list_content = any(
                isinstance(msg.get("content"), list) for msg in prepared_messages
            )
            if has_list_content:
                # Skip template application - will be done in generate_with_vision_model
                prompt = ""
            else:
                prompt = self.apply_chat_template(prepared_messages)
            yield from self.generate_with_vision_model(prompt, prepared_messages)
        else:
            prompt = self.apply_chat_template(prepared_messages)
            yield from self.generate_with_text_model(prompt)

    def load_tokenizer(self) -> Any:
        """
        Load and return the appropriate tokenizer or processor for the model.

        This method selects either an `AutoTokenizer` or an `AutoProcessor` depending
        on whether the model supports vision inputs (e.g., Qwen-VL). It applies any
        model-specific tokenizer adjustments, such as setting padding behavior or
        adding special tokens required by certain model variants.

        For GGUF models, tokenizers are not embedded in the `.gguf` file, so this
        method loads the tokenizer from the parent directory or HuggingFace.

        Returns:
            A tokenizer or processor instance compatible with the target model.
        """
        if self._is_vision_model():
            processor = AutoProcessor.from_pretrained(self.model_path)
            return processor

        # Handle GGUF models - tokenizers need to be loaded from parent directory or HuggingFace
        if self._is_gguf_model():
            model_path_obj = Path(self.model_path)

            # Determine parent_dir: if model_path is a directory, use it; if it's a file, use its parent
            if model_path_obj.is_dir():
                parent_dir = model_path_obj
            else:
                parent_dir = model_path_obj.parent

            model_dir_name = parent_dir.name
            base_name = model_dir_name.replace("-GGUF", "").replace("_GGUF", "")

            # Try to load tokenizer from parent directory first (if tokenizer files exist)
            tokenizer = None
            tokenizer_path = parent_dir / "tokenizer.json"
            config_path = parent_dir / "tokenizer_config.json"

            if tokenizer_path.exists() or config_path.exists():
                try:
                    tokenizer = AutoTokenizer.from_pretrained(
                        str(parent_dir), trust_remote_code=True
                    )
                except Exception:
                    pass  # Continue to HuggingFace fallback

            # If not found in parent directory, try HuggingFace with simple defaults
            if tokenizer is None:
                default_model_ids = [f"Qwen/{base_name}", "Qwen/Qwen2.5-8B-Instruct"]

                print(f"Loading tokenizer from HuggingFace (model files not found locally)...")
                logger.info(f"Attempting to load tokenizer from HuggingFace for {base_name}")
                for model_id in default_model_ids:
                    try:
                        tokenizer = AutoTokenizer.from_pretrained(
                            model_id, trust_remote_code=True
                        )
                        print(f"✓ Successfully loaded tokenizer from {model_id}")
                        logger.info(f"Successfully loaded tokenizer from {model_id}")
                        break
                    except Exception as e:
                        print(f"✗ Failed to load tokenizer from {model_id}: {e}")
                        logger.warning(f"Failed to load tokenizer from {model_id}: {e}")
                        continue

                if tokenizer is None:
                    error_msg = (
                        f"Could not load tokenizer for GGUF model {self.model_path}.\n"
                        f"Please ensure tokenizer files exist in {parent_dir} or "
                        f"provide a valid HuggingFace model ID."
                    )
                    print(f"\n❌ ERROR: {error_msg}")
                    logger.error(error_msg)
                    raise ValueError(error_msg)
        else:
            tokenizer = AutoTokenizer.from_pretrained(self.model_path)

        tokenizer.padding_side = "right"
        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token

        # Model-specific tokenizer adjustments
        if "unsloth_gemma-2-2b-it-bnb-4bit" in self.model_path:
            tokenizer.add_special_tokens({"eos_token": "<end_of_turn>"})

        return tokenizer

    def load_tools(self) -> List[Any] | None:
        """
        Load tools from both local modules and MCP servers.

        This method creates a unified tool registry that includes:
        - Local tools specified via tool_name/tool_list
        - MCP tools from configured MCP servers

        Returns:
            A list of tool schemas in the format expected by the model's chat template,
            or None if no tools are available.
        """
        # Initialize tool registry if not provided
        if self.tool_registry is None:
            self.tool_registry = ToolRegistry()

        # Load local tool if specified
        if self.tool_name and self.tool_list:
            try:
                module = importlib.import_module(f"modules.{self.tool_name}")
                func = getattr(module, self.tool_list)
                # Register the local tool
                self.tool_registry.register_local_tool(
                    tool_name=self.tool_list,
                    function=func,
                    description=f"Tool from {self.tool_name} module",
                )
            except (ImportError, AttributeError) as e:
                print(f"Warning: Could not load tool '{self.tool_list}' from '{self.tool_name}': {e}")

        # Load MCP tools from configured servers
        mcp_servers = getattr(settings, "MCP_SERVERS", {})
        for server_name, server_config in mcp_servers.items():
            try:
                transport = server_config.get("transport", "stdio")
                if transport == "stdio":
                    command = server_config.get("command")
                    args = server_config.get("args", [])
                    env = server_config.get("env", {})
                    if not command:
                        print(f"Warning: MCP server '{server_name}' missing 'command' for stdio transport")
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
                        print(f"Warning: MCP server '{server_name}' missing 'url' for http transport")
                        continue

                    client = MCPClient(
                        server_name=server_name,
                        url=url,
                        transport="http",
                    )
                else:
                    print(f"Warning: MCP server '{server_name}' has unsupported transport '{transport}'")
                    continue

                # Connect and register MCP client
                client.connect()
                # Extract allowed path from args for filesystem servers
                allowed_path = None
                if server_name == "filesystem" and args:
                    # The last argument is typically the allowed directory
                    allowed_path = args[-1] if args else None
                self.tool_registry.register_mcp_client(server_name, client, allowed_path=allowed_path)
                print(f"Successfully connected to MCP server: {server_name}")
            except (MCPConnectionError, MCPServerError) as e:
                print(f"Warning: Failed to connect to MCP server '{server_name}': {e}")
            except Exception as e:
                print(f"Warning: Error setting up MCP server '{server_name}': {e}")

        # Get tool schemas for the model
        tool_schemas = self.tool_registry.get_tool_schema_for_model()
        if tool_schemas:
            return tool_schemas
        return None

    def get_model_loading_args(self) -> Dict[str, Any]:
        """
        Build the keyword arguments used to load the model from disk.

        This method assembles configuration flags required by the `from_pretrained()`
        method for loading Hugging Face-compatible models. It includes:
          - CUDA device mapping
          - Trust flag for loading custom/model-specific code
          - Optional quantization configuration (if not already present in config.json)
          - Flash attention support if enabled via settings

        Returns:
            A dictionary of keyword arguments to pass to the model loader.
        """
        # Use CPU device map for Mac, CUDA for Linux
        device_map: str | Dict[str, int]
        if platform.system() == "Darwin":  # Mac
            device_map = "cpu"
        else:
            device_map = {"": 0}  # CUDA for Linux

        args: Dict[str, Any] = {"device_map": device_map, "trust_remote_code": True}

        # Handle Transformers-based models (GGUF is now handled by llama-cpp-python in load_model)
        model_config = self._get_model_config_from_file()
        if "quantization_config" not in model_config:
            args["quantization_config"] = self.get_quantization_config()

        if settings.use_flash_attention:
            args["attn_implementation"] = "flash_attention_2"

        return args

    def get_quantization_config(self) -> BitsAndBytesConfig | None:
        """
        Return a 4-bit quantization configuration if enabled for this model.

        This method checks whether quantization is either explicitly requested via
        the constructor (`self.quantize`) or specified in the model's configuration
        metadata (under the `quantize` key). If so, it returns a BitsAndBytesConfig
        object suitable for loading the model in 4-bit NF4 format.

        Returns:
            A configured BitsAndBytesConfig object for 4-bit quantization, or None
            if quantization is not requested.
        """
        if self.quantize or self.get_config_option("quantize", False):
            return BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_compute_dtype=torch.bfloat16,
                bnb_4bit_quant_type="nf4",
            )
        return None

    def prepare_messages_for_generation(
        self, messages: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        Prepare and normalize chat messages prior to prompt generation.

        This method performs several preprocessing steps:
          - Creates a shallow copy of the input to avoid mutating the original list.
          - Ensures a system message is included if tools are not being used.
          - Replaces or inserts the system message using the value from settings.
          - Removes the system message entirely for models (e.g. Gemma) that do not support it.
          - Handles tool call messages by ensuring they have proper content fields.

        Args:
            messages: A list of dictionaries representing role-based chat messages.

        Returns:
            A new list of messages, adjusted to meet the input requirements of the current model.
        """
        # Make a copy to avoid modifying the original list
        processed_messages = list(messages)

        # Fix tool call messages - ensure they have content field
        # Use empty string instead of None to avoid template iteration errors
        for msg in processed_messages:
            if "tool_calls" in msg:
                # For assistant messages with tool_calls, use empty string if content is missing
                if "content" not in msg:
                    msg["content"] = ""
                # If content is None, convert to empty string
                elif msg.get("content") is None:
                    msg["content"] = ""
            # Ensure tool messages have content
            if msg.get("role") == "tool" and "content" not in msg:
                msg["content"] = ""
            # Ensure all messages have content (not None)
            if "content" in msg and msg["content"] is None:
                msg["content"] = ""

        # Inject the system message if tools are not being used
        if not self.tools:
            try:
                # Find and update an existing system message
                sys_msg_index = next(
                    i for i, item in enumerate(processed_messages) if item["role"] == "system"
                )
                processed_messages[sys_msg_index]["content"] = settings.system_message
            except StopIteration:
                # Or insert a new one at the beginning
                processed_messages.insert(
                    0, {"role": "system", "content": settings.system_message}
                )

        # Handle model-specific requirements
        if "gemma" in self.model_name.lower():
            # Gemma models do not support the "system" role
            processed_messages = [m for m in processed_messages if m["role"] != "system"]

        return processed_messages

    def apply_chat_template(self, messages: List[Dict[str, Any]]) -> str:
        """
        Convert a sequence of chat messages into a single prompt string.

        This method first checks whether the tokenizer has a built-in `chat_template`
        attribute. If available, that is used to format the messages appropriately.
        Otherwise, a fallback manual template is constructed based on the model's
        template type, such as 'chatml' or 'llama2'.

        Args:
            messages: A list of role-based chat messages, each a dictionary with
                      'role' and 'content' keys.

        Returns:
            str: A single string prompt suitable for passing to the model.
        """
        # For vision models, the tokenizer can handle list content directly
        # For non-vision models, extract text from list content for template application
        has_list_content = any(
            isinstance(msg.get("content"), list) for msg in messages
        )
        if has_list_content and not self._is_vision_model():
            # Extract text from list content for template application
            # (only needed for non-vision models)
            text_messages = []
            for msg in messages:
                content = msg.get("content", "")
                if isinstance(content, list):
                    # Extract text parts from the list
                    text_parts = [
                        item.get("text", "")
                        for item in content
                        if isinstance(item, dict) and item.get("type") == "text"
                    ]
                    text_content = " ".join(text_parts)
                    text_messages.append({"role": msg["role"], "content": text_content})
                else:
                    text_messages.append(msg)
            messages = text_messages

        # Prefer the tokenizer's built-in template
        if hasattr(self.tokenizer, "chat_template") and self.tokenizer.chat_template:
            try:
                prompt = self.tokenizer.apply_chat_template(
                    messages,
                    tokenize=False,
                    add_generation_prompt=True,
                    tools=self.tools,
                    enable_thinking=self.enable_thinking,
                )
            except (AttributeError, TypeError, ValueError) as e:
                # If template application fails (e.g., with list content),
                # extract text and try again
                if any(isinstance(msg.get("content"), list) for msg in messages):
                    text_messages = []
                    for msg in messages:
                        content = msg.get("content", "")
                        if isinstance(content, list):
                            text_parts = [
                                item.get("text", "")
                                for item in content
                                if isinstance(item, dict) and item.get("type") == "text"
                            ]
                            text_content = " ".join(text_parts)
                            text_messages.append({"role": msg["role"], "content": text_content})
                        else:
                            text_messages.append(msg)
                    prompt = self.tokenizer.apply_chat_template(
                        text_messages,
                        tokenize=False,
                        add_generation_prompt=True,
                        tools=self.tools,
                        enable_thinking=self.enable_thinking,
                    )
                else:
                    raise
        else:
            # Fallback to manual templating
            template_type = self.get_config_option("template", "llama2")
            print(f"Warning: Tokenizer has no chat_template. Falling back to '{template_type}'.")
            if template_type == "chatml":
                prompt_template = "<|im_start|>system\n{system}<|im_end|>\n<|im_start|>user\n{user}<|im_end|>\n<|im_start|>assistant\n"
                user_content = next((m["content"] for m in messages if m["role"] == "user"), "")
                system_content = next((m["content"] for m in messages if m["role"] == "system"), "")
                # Handle list content in fallback template
                if isinstance(user_content, list):
                    text_parts = [
                        item.get("text", "")
                        for item in user_content
                        if isinstance(item, dict) and item.get("type") == "text"
                    ]
                    user_content = " ".join(text_parts)
                if isinstance(system_content, list):
                    text_parts = [
                        item.get("text", "")
                        for item in system_content
                        if isinstance(item, dict) and item.get("type") == "text"
                    ]
                    system_content = " ".join(text_parts)
                prompt = prompt_template.format(system=system_content, user=user_content)
            else:  # Default to LLaMA2-style template
                template = ""
                for msg in messages:
                    content = msg.get("content", "")
                    # Handle list content in fallback template
                    if isinstance(content, list):
                        text_parts = [
                            item.get("text", "")
                            for item in content
                            if isinstance(item, dict) and item.get("type") == "text"
                        ]
                        content = " ".join(text_parts)
                    if msg["role"] == "user":
                        template += f"[INST]{content}[/INST]"
                    elif msg["role"] == "assistant":
                        template += f"{content}</s>"
                prompt = template

        # Add beginning-of-sequence token if required by the model
        if self.get_config_option("add_bos_token"):
            prompt = f"<|begin_of_text|>{prompt}"

        return prompt

    def generate_with_text_model(self, prompt: str) -> Generator[str, None, None]:
        """
        Generate text using a standard causal language model (e.g., LLaMA, Mistral).

        This method sets up a streaming text-generation pipeline using the Hugging Face
        `pipeline()` API. It applies appropriate sampling settings, handles special token
        behavior, and runs generation in a background thread to support non-blocking output.

        Args:
            prompt: The textual prompt to feed into the model.

        Yields:
            Segments of the model's decoded response as strings, streamed in real time.
        """
        # If we're using tools, we don't want to skip special tokens in the response.
        skip_special_tokens = self.tools is None

        streamer = TextIteratorStreamer(
            self.tokenizer, skip_prompt=True, skip_special_tokens=skip_special_tokens
        )

        pipeline_args = {
            "model": self.model,
            "tokenizer": self.tokenizer,
            "max_new_tokens": self.max_new_tokens,
            "do_sample": self.get_config_option("do_sample", True),
            "streamer": streamer,
        }

        if self.stop_event is not None:
            pipeline_args["stopping_criteria"] = StoppingCriteriaList(
                [EventStoppingCriteria(self.stop_event)]
            )

        if pipeline_args["do_sample"]:
            pipeline_args.update({
                "temperature": self.temperature,
                "top_p": self.top_p,
                "top_k": self.top_k,
            })

        if not self.tools and "llama" in self.model_name.lower():
            pipeline_args["eos_token_id"] = [
                self.tokenizer.eos_token_id,
                self.tokenizer.convert_tokens_to_ids("<|eot_id|>"),  # Llama3 EOT token
            ]

        try:
            generator = pipeline("text-generation", **pipeline_args)
        except Exception as e:
            logger.error(f"Error creating pipeline: {e}", exc_info=True)
            raise

        # Run generation in a separate thread to enable streaming
        thread = Thread(
            target=generator,
            args=(prompt,),
            kwargs={"max_new_tokens": self.max_new_tokens, "return_full_text": False},
        )
        thread.start()

        try:
            for text in streamer:
                if self.stop_event and self.stop_event.is_set():
                    break
                yield text
        except Exception as e:
            logger.error(f"Error in streamer loop: {e}", exc_info=True)
            raise
        finally:
            thread.join()

    def generate_with_gguf_model(self, messages: List[Dict[str, Any]]) -> Generator[str, None, None]:
        """
        Generate text using a GGUF model via llama-cpp-python.

        This method handles the specific message formatting and streaming API
        of llama-cpp-python, ensuring high performance on Mac (Metal) and Linux (CUDA).

        Args:
            messages: A list of chat messages.

        Yields:
            Segments of the model's decoded response as strings.
        """
        if self.model is None or not isinstance(self.model, llama_cpp.Llama):
            raise RuntimeError("Llama-cpp model must be loaded before calling generate_with_gguf_model().")

        # Use the llama-cpp-python chat completion API with streaming
        try:
            response = self.model.create_chat_completion(
                messages=messages,
                max_tokens=self.max_new_tokens,
                temperature=self.temperature,
                top_p=self.top_p,
                top_k=self.top_k,
                stream=True
            )

            for chunk in response:
                if self.stop_event and self.stop_event.is_set():
                    break

                # Extract the text content from the chunk
                delta = chunk["choices"][0]["delta"]
                if "content" in delta:
                    yield delta["content"]

        except RuntimeError as e:
            error_msg = str(e)
            # Check for memory allocation errors (llama_decode returned -3)
            if "llama_decode returned -3" in error_msg or "returned -3" in error_msg:
                logger.error(f"Memory allocation failure during GGUF generation: {e}")
                helpful_msg = (
                    "Out of memory error during model inference. This usually means:\n"
                    "1. The model is too large for available RAM/VRAM\n"
                    "2. The context window (n_ctx) is too large\n\n"
                    "Try these solutions:\n"
                    "- Enable low memory mode: Set 'gguf_low_memory_mode = True' in settings.py\n"
                    "- Reduce input context size: Set 'gguf_input_context_size = 1024' (or lower) in settings.py\n"
                    "- Use a smaller model or reduce max_new_tokens\n"
                    "- Close other applications to free up memory"
                )
                raise RuntimeError(helpful_msg) from e
            else:
                logger.error(f"Error during GGUF generation: {e}")
                raise RuntimeError(f"GGUF generation failed: {e}") from e
        except Exception as e:
            logger.error(f"Error during GGUF generation: {e}")
            raise RuntimeError(f"GGUF generation failed: {e}") from e

    def generate_with_vision_model(
        self, prompt: str, messages: List[Dict[str, Any]]
    ) -> Generator[str, None, None]:
        """
        Generate text using a vision-language model (e.g., Qwen2-VL).

        This method processes the input `messages` for image and video content,
        tokenizes them along with the prompt, and performs generation using
        the vision-capable model. Unlike text-only models, this bypasses the
        streaming pipeline due to current model limitations.

        Args:
            prompt: A text prompt constructed from the message context.
            messages: A list of chat message dicts, potentially containing vision inputs.

        Yields:
            Segments of the decoded text output as strings.
        """
        if self.model is None:
            raise RuntimeError("Model must be loaded before generation.")

        # Check if messages have list content or if prompt is empty
        has_list_content = any(
            isinstance(msg.get("content"), list) for msg in messages
        )

        image_inputs, video_inputs = process_vision_info(messages)

        if has_list_content or not prompt:
            # For messages with list content, use tokenizer's apply_chat_template directly
            # This should properly insert image tokens like <|vision_start|><|image_pad|><|vision_end|>
            try:
                # Use tokenizer's apply_chat_template to get proper formatting with image tokens
                formatted_prompt = self.tokenizer.apply_chat_template(
                    messages,
                    tokenize=False,
                    add_generation_prompt=True,
                )
                inputs = self.tokenizer(
                    text=[formatted_prompt],
                    images=image_inputs,
                    videos=video_inputs,
                    padding=True,
                    return_tensors="pt",
                ).to("cuda")
            except (AttributeError, TypeError, ValueError) as e:
                # If template application fails, extract text and create a simple prompt
                # This is a fallback - the images will still be processed
                text_parts = []
                for msg in messages:
                    if msg.get("role") == "user":
                        content = msg.get("content", "")
                        if isinstance(content, list):
                            for item in content:
                                if isinstance(item, dict) and item.get("type") == "text":
                                    text_parts.append(item.get("text", ""))
                        elif isinstance(content, str):
                            text_parts.append(content)
                fallback_prompt = " ".join(text_parts) if text_parts else prompt
                inputs = self.tokenizer(
                    text=[fallback_prompt],
                    images=image_inputs,
                    videos=video_inputs,
                    padding=True,
                    return_tensors="pt",
                ).to("cuda")
        else:
            inputs = self.tokenizer(
                text=[prompt],
                images=image_inputs,
                videos=video_inputs,
                padding=True,
                return_tensors="pt",
            ).to("cuda")

        # Qwen2 Vision does not yet support the pipeline streamer
        generated_ids = self.model.generate(**inputs, max_new_tokens=128)

        # Trim the input token IDs from the generated output
        trimmed_ids = [
            out_ids[len(in_ids):]
            for in_ids, out_ids in zip(inputs.input_ids, generated_ids)
        ]

        output_text = self.tokenizer.batch_decode(
            trimmed_ids, skip_special_tokens=True, clean_up_tokenization_spaces=False
        )

        for text in output_text:
            if self.stop_event and self.stop_event.is_set():
                break
            yield text

    def prepare_image_prompt(self, image_path: str, text: str) -> List[Dict[str, Any]]:
        """
        Creates a vision model prompt from an image file and text.

        Args:
            image_path: The path to the image file.
            text: The text to accompany the image.

        Returns:
            A list containing a single message dictionary formatted for vision models.
        """
        path = Path(image_path)
        if not path.is_file():
            raise FileNotFoundError(f"The image file was not found at: {image_path}")

        with open(image_path, "rb") as image_file:
            encoded_string = base64.b64encode(image_file.read()).decode("utf-8")

        return [
            {
                "role": "user",
                "content": [
                    {"type": "image", "image": f"data:image/jpeg;base64,{encoded_string}"},
                    {"type": "text", "text": text},
                ],
            }
        ]

    def get_config_option(self, name: str, default: Any = None) -> Any:
        """
        Retrieves a model configuration value from the model_info dictionary.

        Args:
            name: The key of the configuration option.
            default: The fallback value if the key is not present.

        Returns:
            The value of the configuration option or the specified default.
        """
        return self.model_info.get(self.model_name, {}).get(name, default)

    def _is_gguf_model(self) -> bool:
        """
        Determine whether the model path points to a GGUF file or directory containing one.

        Returns:
            bool: ``True`` if the model_path is a `.gguf` file or a directory containing one, otherwise ``False``.
        """
        model_path_obj = Path(self.model_path)
        # Check if the path ends with .gguf (works even if file doesn't exist yet)
        if model_path_obj.suffix.lower() == ".gguf":
            return True
        # Check if it's a directory containing a .gguf file
        if model_path_obj.is_dir():
            for item in model_path_obj.iterdir():
                if item.is_file() and item.suffix.lower() == ".gguf":
                    return True
        return False

    def _is_vision_model(self) -> bool:
        """
        Determine whether the currently-selected model supports vision inputs.

        The check simply forwards to :py:meth:`get_config_option`, expecting the
        metadata key ``"qwen_vision"`` to be ``True`` for Qwen-VL and other
        vision-language variants.

        Returns:
            bool: ``True`` if the model can accept image/video content,
                  otherwise ``False``.
        """
        return self.get_config_option("qwen_vision", False)

    def _get_model_config_from_file(self) -> Dict[str, Any]:
        """
        Load model configuration from the model's `config.json` file.

        This method attempts to read the configuration JSON file located in the model
        directory specified by `self.model_path`. If the file does not exist, an empty
        dictionary is returned.

        For GGUF models, the config.json would be in the parent directory of the .gguf file.

        Returns:
            dict: A dictionary representing the model's configuration, or an empty
            dict if the file is missing.
        """
        if self._is_gguf_model():
            # For GGUF models, config.json would be in the parent directory
            model_path_obj = Path(self.model_path)
            if model_path_obj.is_dir():
                config_path = model_path_obj / "config.json"
            else:
                config_path = model_path_obj.parent / "config.json"
        else:
            config_path = Path(self.model_path) / "config.json"
        if not config_path.is_file():
            return {}
        with open(config_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def cleanup(self) -> None:
        """
        Clean up resources, including disconnecting MCP servers.

        This method should be called when the Inference instance is no longer needed.
        """
        if self.tool_registry:
            try:
                self.tool_registry.disconnect_all_mcp_servers()
            except Exception as e:
                logger.warning(f"Error cleaning up MCP servers: {e}")


def main() -> None:
    """
    Parse command-line arguments and run the inference engine.

    This function initializes the inference engine with the provided model path and
    configuration flags, loads the model, and runs either image-based inference
    or an interactive chatbot loop depending on the arguments.

    Command-line arguments:
        -m, --model-path   : Path to the model directory (required).
        -q, --quantize     : Enable 4-bit quantization.
        -i, --image        : Path to an image for vision-based prompting.
        --tts              : Enable text-to-speech output.
        --stt              : Enable speech-to-text input.
    """
    parser = argparse.ArgumentParser(description="Run inference with a specified model.")
    parser.add_argument(
        "-m",
        "--model-path",
        required=True,
        help="The path to the model directory."
    )
    parser.add_argument(
        "-q",
        "--quantize",
        action="store_true",
        help="Quantize the model on-the-fly."
    )
    parser.add_argument(
        "-i",
        "--image",
        help="Path to an image for vision model inference."
    )
    parser.add_argument(
        "--tts",
        action="store_true",
        help="Enable Text-to-Speech (TTS)."
    )
    parser.add_argument(
        "--stt",
        action="store_true",
        help="Enable Speech-to-Text (STT)."
    )

    args = parser.parse_args()

    try:
        # Initialize the core inference engine
        inference = Inference(
            model_path=args.model_path,
            quantize=args.quantize,
        )
        print("Loading model...")
        inference.load_model()
        print("Model loaded successfully.")

        if args.image:
            # Handle image-based inference
            prompt_text = "Describe this image in detail."
            image_messages = inference.prepare_image_prompt(args.image, prompt_text)
            inference.context.add(image_messages)

            print(f"{COLOR_GREEN}You: {prompt_text}{COLOR_RESET}")
            print(f"\n{COLOR_BLUE}AI: ", end="")

            response_generator = inference.generate(inference.context.get())
            for chunk in response_generator:
                print(chunk, end="", flush=True)
            print()
        else:
            # Enter interactive chat mode
            from modules.chatbot import ChatBot

            chatbot = ChatBot(stt=args.stt, tts=args.tts)
            chatbot.interactive(inference=inference)

    except (FileNotFoundError, RuntimeError, ImportError) as e:
        print(f"\nError: {e}")


if __name__ == "__main__":
    main()
