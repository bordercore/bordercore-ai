![Bordercore AI Logo](/logo.jpg)

---

Bordercore AI is a web-based AI chatbot and voice assistant supporting multiple open-weight and commercial LLMs, Text to Speech (TTS), Speech to Text (STT), audio transcription and RAG (Retrieval Augmented Generation). Discord bots are also supported.

![Screenshot](/screenshot.png)

# Features

## Text to Speech (TTS)

Two TTS engines are supported: [Kokoro](https://kokorottsai.com/) and [Chatterbox](https://github.com/resemble-ai/chatterbox).

## Speech to Text (STT)

[Whisper MIC](https://github.com/mallorbc/whisper_mic) is used for STT, which is based on OpenAI's [Whisper](https://github.com/openai/whisper).

## RAG (Retrieval Augmented Generation)

Chat with your uploaded documents.

## Audio Transcription

Upload audio files to convert them to text, then ask questions based on the generated transcription. Also supports pasting in Youtube URLs.

## Multimodality

Support for the **Qwen2.5-VL** vision models for analyzing images. Upload images or drag-and-drop them into the UI.

## Tool Calling

Built-in tools include Wolfram Alpha (math), weather lookup, Govee smart-light control, music playback, and Google Calendar. Additional tools can be exposed via [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) servers — see `MCP_SERVERS` in `settings_template.py`.

## Thinking

Supports some so-called "thinking" models, such as Qwen3.

## Chat with Web Pages

Paste a URL into the input box and say "Summarize" or something similar.

## Discord Bot Support

Discord bots can be backed by either OpenAI's ChatGPT or an open source LLM.

Set your server's channel ID in `settings.discord_channel_id`.

Set the environment variable `DISCORD_TOKEN`.

To run the local LLM bot:

```bash
python3 -m modules.chatbot -m localllm
```

To run the ChatGPT bot:

```bash
python3 -m modules.chatbot -m chatgpt
```

## Sensor Support

Experimental support for reading real-time sensor data. This can be used, for example, to activate Speech to Text by waving a hand in front of a sensor like the HLK-LD2410B.

To run the sensor webapp:

```bash
python3 -m sensor
```

# Installation

Dependencies are managed with [uv](https://github.com/astral-sh/uv). From the project root:

```bash
uv sync
```

Alternatively, create and activate a virtual environment and install the project in editable mode:

```bash
pip install -e .
```

Build the front-end package:

```bash
npm run build
```

Copy `settings_template.py` to `settings.py` and set the following:

**model_name**: default model to load
**model_dir**: the relative directory containing your models

Edit `models.yaml` to add configuration options for your models. Use `models_template.yaml` as a guide. Example:

```yaml
NousResearch_Nous-Hermes-2-Mistral-7B-DPO:
  name: Nous Research Hermes 2 Mistral 7B DPO
  template: chatml
gpt-4o:
  name: ChatGPT-4o
  type: api
  vendor: openai
```

The **name** is a human-friendly alias used in the UI.
The **template** is the chat template type used by the model (eg ChatML, Alpaca, Llama2, etc).
The **type** specifies an API-based (as opposed to local) model.
The **vendor** specifies the vendor for commercial models. Can be set to *openai* or *anthropic*.
Set **quantize: true** to automatically quantize models to 4bits using the bitsandbytes library.
Set **qwen_vision: true** to enable vision support for the Qwen2.5-VL models.
Set **do_sample: false** to disable sampling via `temperature`, `top_p`, and `top_k`.
Set **add_bos_token: true** to prepend a beginning-of-sequence (BOS) token to the input text.

To run:

```bash
python3 -m webapp
```

To access: https://localhost:5010/

## PostgreSQL MCP server (pg-mcp-server)

1. Configure `pg_mcp_server.toml` with your local Postgres connection string. Leave `allow_writes = false` to keep sessions read-only.
2. Make sure project dependencies are installed (see [Installation](#installation)).
3. Start the MCP server (defaults to HTTP transport on `127.0.0.1:8000/mcp`):
   ```bash
   python run_pg_mcp_server.py
   ```
4. Point the app to the MCP server by adding to `settings.py`:
   ```python
   MCP_SERVERS = {
       "postgres": {
           "url": "http://127.0.0.1:8000/mcp",
           "transport": "http",
       },
       # ...other servers...
   }
   ```

## Command line

You can interact with the API via the command-line:

```bash
python3 -m modules.chatbot -m interactive
```

Options:

- --tts: enable AllTalk TTS (Text to Speech)
- --stt: enable STT (Speech to Text)

To use RAG with a local file:

```bash
python3 -m modules.rag -f <filename>
```

# Usage

## UI

Type your text into the input box to send a message to the chatbot.

To the immediate right of the input box are two buttons. The first is **Regenerate Response**, which will re-send the last message to the chatbot, presumably in hopes that a different response will result. The second is **New Chat**, which will clear the chat history.

The **Selected Model** dropdown lets you choose which LLM the API uses to respond to your prompt.

### Options panel

Toggle features on and off:

- **Voice Features**: Text to Speech, Speech to Text, and VAD (Voice Activation Detection — auto-detects when you're done speaking to initiate a back-and-forth conversation).
- **Reasoning**: Wolfram Alpha tool calling.

### Preferences menu

The hamburger menu to the upper-right lets you adjust:

- **Temperature**: Controls the randomness of the model's output (0 = predictable, 1 = random).
- **Audio Speed**: Playback speed of the TTS audio.
- **TTS Host**: Hostname and port for the TTS server.
- **Aurora**: Toggle the drifting glow background.
- **Panel Opacity**: Transparency of UI panels.
- **Starfield**: Toggle floating particle effects.
- **Cursor Effect**: Toggle animated streaks that follow the cursor (with density and speed sub-controls).

# Tests

To run the unit tests:

```bash
pytest
```

---

[![Run Pytest](https://github.com/bordercore/bordercoreai/actions/workflows/pytest.yml/badge.svg)](https://github.com/bordercore/bordercoreai/actions/workflows/pytest.yml)
