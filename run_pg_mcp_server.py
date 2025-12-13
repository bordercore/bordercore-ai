"""
Helper to launch pg-mcp-server using settings from pg_mcp_server.toml.
Requires pgsql-mcp-server installed in the active virtualenv.
"""

import os
import sys
import tomllib
from pathlib import Path
from typing import Any, Dict


ROOT = Path(__file__).resolve().parent
CONFIG_PATH = ROOT / "pg_mcp_server.toml"


def _as_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lower = value.strip().lower()
        if lower in {"true", "1", "yes", "y"}:
            return True
        if lower in {"false", "0", "no", "n"}:
            return False
    return default


def load_config() -> Dict[str, Any]:
    if not CONFIG_PATH.exists():
        raise SystemExit(
            f"Config file not found at {CONFIG_PATH}. Create it from pg_mcp_server.toml."
        )
    with CONFIG_PATH.open("rb") as fh:
        data = tomllib.load(fh)
    config = data.get("server", {})
    database_url = config.get("database_url")
    if not database_url:
        raise SystemExit("Missing required `database_url` in [server] config.")
    return config


def main() -> None:
    config = load_config()
    database_url = str(config.get("database_url"))
    transport = str(config.get("transport", "stdio")).lower()
    host = str(config.get("host", "127.0.0.1"))
    port = int(config.get("port", 8000))
    allow_writes = _as_bool(config.get("allow_writes"), False)

    # Set environment variables for the MCP server
    os.environ["DATABASE_URL"] = database_url
    if allow_writes:
        os.environ["DANGEROUSLY_ALLOW_WRITE_OPS"] = "true"
    else:
        os.environ["DANGEROUSLY_ALLOW_WRITE_OPS"] = "false"
    if config.get("ssl_root_cert"):
        os.environ["PG_SSL_ROOT_CERT"] = str(config["ssl_root_cert"])

    # Import and run the MCP server
    from pgsql_mcp_server.app import mcp

    # Map transport names: "http" -> "streamable-http", "sse" -> "sse", else "stdio"
    if transport == "http":
        transport = "streamable-http"
    elif transport not in ("stdio", "sse", "streamable-http"):
        print(f"Warning: Unknown transport '{transport}', using 'stdio'")
        transport = "stdio"

    print(f"Starting pg-mcp-server with transport={transport} on {host}:{port}")
    if transport == "stdio":
        mcp.run(transport="stdio")
    else:
        # For HTTP transports, FastMCP uses host/port from environment or defaults
        os.environ["HOST"] = host
        os.environ["PORT"] = str(port)
        mcp.run(transport=transport)


if __name__ == "__main__":
    main()
