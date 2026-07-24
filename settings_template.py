from typing import Any, Dict


system_message = "You are a helpful assistant."

flask_secret_key = ""

model_name = "Qwen3-8B-AWQ-vLLM"
model_dir = "../../models"
temperature = 0.7
use_flash_attention = False
debug = False

# Speech recognition stays resident after its first request. Use "cpu", "cuda",
# or "cuda:<index>" to override automatic device selection.
asr_model = "distil-whisper/distil-large-v3"
asr_device = "auto"
asr_idle_timeout_minutes = 15

discord_channel_id = ""

tts_host = ""
tts_voice = "voice.wav"

# Spoken-text normalization is applied to a copy of assistant output before it
# reaches any TTS engine. Keys are written forms and values are pronunciations.
tts_pronunciations: Dict[str, str] = {
    # "BordercoreAI": "Bordercore A I",
    # "GPU": "G P U",
}

# Trusted JavaScript regular expressions removed from spoken output. These do
# not alter the assistant message displayed in chat.
tts_do_not_speak_patterns: list[str] = [
    # r"\[internal\].*?\[/internal\]",
]

# Presets shown in the frontend's "TTS Host" dropdown. Each entry maps a
# human-readable label to a base URL for the TTS service. The frontend
# persists the user's chosen host in localStorage and uses it to reach the
# engine directly from the browser, so the hostnames here must have a valid
# cert and resolve to the host that's actually running the engine.
tts_host_presets = [
    {"label": "Kokoro (wumpus)", "host": "https://kokoro-tts.bordercore.com:5001"},
    {"label": "Chatterbox / Qwen3 (deepvirtual)", "host": "https://tts.bordercore.com:5001"},
]

anthropic_api_key = ""
openai_api_key = ""
govee_api_key = ""

music_api_host = ""
music_uri = ""

weather_api_key = ""

wolfram_alpha_app_id = ""

sensor_uri = ""
sensor_threshold = 30
sensor_bt_address = ""

# MCP (Model Context Protocol) server configuration
# Each entry defines an MCP server to connect to
# Transport can be "stdio" (subprocess) or "http"
MCP_SERVERS: Dict[str, Dict[str, Any]] = {
    # Example stdio transport:
    # "filesystem": {
    #     "command": ["npx"],
    #     "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/dir"],
    #     "env": {},
    #     "transport": "stdio",
    # },
    # Example HTTP transport:
    # "postgres": {
    #     "url": "http://127.0.0.1:8000/mcp",
    #     "transport": "http",
    # },
}

# Optional single HTTP MCP server (e.g., external Django MCP server)
# If provided, this will be merged into MCP_SERVERS at runtime.
mcp_server_url = ""
mcp_server_name = "django_mcp"
mcp_token = ""
mcp_endpoint = "mcp"
