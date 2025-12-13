from typing import Any, Dict


system_message = "You are a helpful assistant."

flask_secret_key = ""

api_host = "http://localhost:5000"
model_name = "hermes-pro-llama3-awq"
model_dir = "../../models"
temperature = 0.7
use_flash_attention = False
debug = False

discord_channel_id = ""

tts_host = ""
tts_voice = "voice.wav"

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
