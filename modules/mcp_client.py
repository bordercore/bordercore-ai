"""
MCP (Model Context Protocol) client implementation.

This module provides a client for connecting to MCP servers via stdio or HTTP,
discovering available tools, and executing tool calls.
"""

import json
import logging
import os
import subprocess
import threading
from typing import IO, Any, Dict, List, Optional

import httpx

from modules.mcp_exceptions import (MCPConnectionError, MCPServerError,
                                    MCPTimeoutError, MCPToolNotFoundError)

logger = logging.getLogger(__name__)


class MCPClient:
    """
    Client for connecting to MCP servers and executing tool calls.

    Supports both stdio (subprocess) and HTTP transport methods.
    """

    def __init__(
        self,
        server_name: str,
        command: Optional[List[str]] = None,
        args: Optional[List[str]] = None,
        env: Optional[Dict[str, str]] = None,
        url: Optional[str] = None,
        transport: str = "stdio",
        timeout: int = 30,
        auth_token: Optional[str] = None,
        endpoint_path: str = "mcp",
        headers: Optional[Dict[str, str]] = None,
    ) -> None:
        """
        Initialize MCP client.

        Args:
            server_name: Name identifier for this MCP server.
            command: Command to run for stdio transport (e.g., ["npx"]).
            args: Arguments for the command (e.g., ["-y", "@modelcontextprotocol/server-filesystem"]).
            env: Environment variables to pass to subprocess.
            url: HTTP endpoint URL for HTTP transport.
            transport: Transport method, either "stdio" or "http".
            timeout: Timeout in seconds for operations.
            auth_token: Optional bearer token for HTTP transport.
            endpoint_path: Endpoint path for HTTP requests (default: "mcp").
            headers: Optional extra HTTP headers.
        """
        self.server_name = server_name
        self.transport = transport
        self.timeout = timeout
        self._request_id = 0
        self._request_lock = threading.Lock()
        self._auth_token = auth_token
        self._endpoint_path = endpoint_path.strip("/") or "mcp"
        self._session_id: Optional[str] = None
        self._http_headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "Mcp-Protocol-Version": "2024-11-05",
        }
        if headers:
            self._http_headers.update(headers)
        if auth_token:
            self._http_headers["Authorization"] = f"Bearer {auth_token}"

        if transport == "stdio":
            if not command:
                raise ValueError("command is required for stdio transport")
            self.command = command
            self.args = args or []
            self.env = env or {}
            self.process: Optional[subprocess.Popen[bytes]] = None
        elif transport == "http":
            if not url:
                raise ValueError("url is required for http transport")
            self.url = url.rstrip("/")
            self.client = httpx.Client(timeout=timeout)
            self.endpoint = f"{self.url}/{self._endpoint_path}"
        else:
            raise ValueError(f"Unsupported transport: {transport}")

        self._tools: Optional[List[Dict[str, Any]]] = None

    def _require_process_streams(self) -> tuple[subprocess.Popen[bytes], IO[bytes], IO[bytes], Optional[IO[bytes]]]:
        """
        Ensure the stdio process and its streams are available.

        Returns:
            Tuple of (process, stdin, stdout, stderr).

        Raises:
            MCPConnectionError: If the process or its stdio streams are unavailable.
        """
        process = self.process
        if process is None:
            raise MCPConnectionError(f"MCP server {self.server_name} process is not running")

        stdin = process.stdin
        stdout = process.stdout
        stderr = process.stderr

        if stdin is None or stdout is None:
            raise MCPConnectionError(f"MCP server {self.server_name} stdio streams are unavailable")

        return process, stdin, stdout, stderr

    def _get_next_request_id(self) -> int:
        """Get the next request ID for JSON-RPC calls."""
        with self._request_lock:
            self._request_id += 1
            return self._request_id

    def _send_jsonrpc_request(self, method: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Send a JSON-RPC 2.0 request to the MCP server.

        Args:
            method: The JSON-RPC method name.
            params: Optional parameters for the method.

        Returns:
            The JSON-RPC response.

        Raises:
            MCPConnectionError: If unable to connect to the server.
            MCPServerError: If the server returns an error.
            MCPTimeoutError: If the operation times out.
        """
        request_id = self._get_next_request_id()
        request = {
            "jsonrpc": "2.0",
            "id": request_id,
            "method": method,
        }
        if params:
            request["params"] = params

        if self.transport == "stdio":
            return self._send_stdio_request(request)
        else:
            return self._send_http_request(request)

    def _send_stdio_request(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """Send a request via stdio transport."""
        if not self.process:
            self.connect()

        if not self.process:
            raise MCPConnectionError(f"Failed to start MCP server process: {self.server_name}")

        try:
            request_json = json.dumps(request) + "\n"
            process, stdin, stdout, stderr = self._require_process_streams()
            stdin.write(request_json.encode("utf-8"))
            stdin.flush()

            # Read response line
            response_line = stdout.readline()
            if not response_line:
                # Check if process has terminated
                if process.poll() is not None:
                    # Process has exited, try to read stderr
                    if stderr:
                        try:
                            stderr_data = stderr.read(1024)
                            if stderr_data:
                                logger.error(f"MCP server {self.server_name} stderr: {stderr_data.decode('utf-8', errors='ignore')}")
                        except Exception:
                            pass
                raise MCPConnectionError(f"MCP server {self.server_name} closed connection")

            response = json.loads(response_line.decode("utf-8"))

            if "error" in response:
                error = response["error"]
                raise MCPServerError(
                    f"MCP server error: {error.get('message', 'Unknown error')} "
                    f"(code: {error.get('code', 'unknown')})"
                )

            return response.get("result", {})
        except json.JSONDecodeError as e:
            raise MCPServerError(f"Invalid JSON response from MCP server: {e}") from e
        except (IOError, OSError) as e:
            raise MCPConnectionError(f"Error communicating with MCP server: {e}") from e

    def _send_http_request(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """Send a request via HTTP transport."""
        # Build headers for this request
        headers = self._http_headers.copy()
        if self._session_id:
            headers["Mcp-Session-Id"] = self._session_id

        # Debug logging: request details
        logger.info(f"[MCP {self.server_name}] Sending request to {self.endpoint}")
        logger.debug(f"[MCP {self.server_name}] Request method: {request.get('method', 'unknown')}")
        logger.debug(f"[MCP {self.server_name}] Request headers: {headers}")
        logger.debug(f"[MCP {self.server_name}] Request body: {json.dumps(request, indent=2)}")

        try:
            response = self.client.post(
                self.endpoint,
                json=request,
                headers=headers,
            )
            response.raise_for_status()

            # Debug logging: response details
            logger.info(f"[MCP {self.server_name}] Response status: {response.status_code}")
            logger.debug(f"[MCP {self.server_name}] Response headers: {dict(response.headers)}")

            # Check response body
            response_text = response.text
            logger.debug(f"[MCP {self.server_name}] Response body length: {len(response_text)}")
            if response_text:
                logger.debug(f"[MCP {self.server_name}] Response body (first 500 chars): {response_text[:500]}")
            else:
                logger.warning(f"[MCP {self.server_name}] Response body is EMPTY!")

            # Check for session ID in response headers (only set if we don't have one yet)
            if not self._session_id and "mcp-session-id" in response.headers:
                self._session_id = response.headers["mcp-session-id"]
                logger.info(f"[MCP {self.server_name}] Received session ID: {self._session_id}")

        except httpx.TimeoutException as e:
            logger.error(f"[MCP {self.server_name}] Request timed out")
            raise MCPTimeoutError(f"MCP request to {self.server_name} timed out") from e
        except httpx.HTTPStatusError as e:
            error_text = ""
            try:
                error_text = e.response.text
                logger.error(f"[MCP {self.server_name}] HTTP {e.response.status_code} error: {error_text[:500]}")
            except Exception:
                pass
            raise MCPServerError(
                f"MCP server {self.server_name} returned HTTP {e.response.status_code}: {error_text}"
            ) from e
        except httpx.RequestError as e:
            logger.error(f"[MCP {self.server_name}] Request error: {e}")
            raise MCPConnectionError(f"Error connecting to MCP server {self.server_name}: {e}") from e

        # Validate response body before parsing
        if not response_text:
            logger.error(f"[MCP {self.server_name}] Empty response body received")
            raise MCPServerError(
                f"MCP server {self.server_name} returned empty response. "
                f"Status: {response.status_code}, Headers: {dict(response.headers)}"
            )

        # Parse SSE format if present (starts with "event:" or "data:")
        json_text = response_text
        if response_text.startswith("event:") or response_text.startswith("data:"):
            # Parse SSE format: extract JSON from "data: {...}" lines
            lines = response_text.split("\n")
            json_lines = []
            for line in lines:
                line = line.strip()
                if line.startswith("data: "):
                    json_lines.append(line[6:])  # Remove "data: " prefix
                elif line.startswith("data:"):
                    json_lines.append(line[5:])  # Remove "data:" prefix
            if json_lines:
                json_text = "\n".join(json_lines)
            logger.debug(f"[MCP {self.server_name}] Parsed SSE format, extracted JSON: {json_text[:200]}")

        try:
            result = json.loads(json_text)
        except ValueError as e:
            logger.error(f"[MCP {self.server_name}] JSON parse error: {e}")
            logger.error(f"[MCP {self.server_name}] Response text: {response_text[:1000]}")
            raise MCPServerError(
                f"Invalid JSON response from MCP server {self.server_name}: {e}. "
                f"Response (first 500 chars): {response_text[:500]}"
            ) from e

        if "error" in result:
            error = result["error"]
            logger.error(f"[MCP {self.server_name}] Server error in response: {error}")
            raise MCPServerError(
                f"MCP server error: {error.get('message', 'Unknown error')} "
                f"(code: {error.get('code', 'unknown')})"
            )

        logger.debug(f"[MCP {self.server_name}] Request successful, result: {result}")
        return result.get("result", {})

    def _initialize_protocol(self) -> None:
        """
        Perform the MCP protocol initialization handshake for stdio transport.

        This must be called before any other MCP operations.
        """
        if self.transport != "stdio" or not self.process:
            return  # HTTP transport uses _initialize_http_protocol instead

        try:
            # Step 1: Send initialize request
            init_request = {
                "jsonrpc": "2.0",
                "id": self._get_next_request_id(),
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {
                        "name": "bordercore-ai",
                        "version": "1.0.0"
                    }
                }
            }

            request_json = json.dumps(init_request) + "\n"
            process, stdin, stdout, stderr = self._require_process_streams()
            stdin.write(request_json.encode("utf-8"))
            stdin.flush()

            # Step 2: Read initialize response
            response_line = stdout.readline()
            if not response_line:
                # Check if process has terminated
                if process.poll() is not None:
                    # Process has exited, try to read stderr
                    if stderr:
                        try:
                            stderr_data = stderr.read(1024)
                            if stderr_data:
                                logger.error(f"MCP server {self.server_name} stderr: {stderr_data.decode('utf-8', errors='ignore')}")
                        except Exception:
                            pass
                raise MCPConnectionError(f"MCP server {self.server_name} closed connection during initialization")

            response = json.loads(response_line.decode("utf-8"))

            if "error" in response:
                error = response["error"]
                raise MCPServerError(
                    f"MCP initialization error: {error.get('message', 'Unknown error')} "
                    f"(code: {error.get('code', 'unknown')})"
                )

            # Step 3: Send initialized notification (no response expected)
            initialized_notification = {
                "jsonrpc": "2.0",
                "method": "notifications/initialized"
            }

            notification_json = json.dumps(initialized_notification) + "\n"
            stdin.write(notification_json.encode("utf-8"))
            stdin.flush()

            logger.debug(f"MCP protocol initialized for server {self.server_name}")
        except json.JSONDecodeError as e:
            raise MCPServerError(f"Invalid JSON during MCP initialization: {e}") from e
        except (IOError, OSError) as e:
            raise MCPConnectionError(f"Error during MCP initialization: {e}") from e

    def _initialize_http_protocol(self) -> None:
        """
        Perform the MCP protocol initialization handshake for HTTP transport.

        This must be called before any other MCP operations for HTTP transport.
        """
        if self.transport != "http":
            return

        logger.info(f"[MCP {self.server_name}] Initializing HTTP protocol to {self.endpoint}")

        try:
            # Step 1: Send initialize request (without session ID)
            init_request = {
                "jsonrpc": "2.0",
                "id": self._get_next_request_id(),
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {
                        "name": "bordercore-ai",
                        "version": "1.0.0"
                    }
                }
            }

            # Build headers without session ID for initialization
            headers = self._http_headers.copy()

            logger.info(f"[MCP {self.server_name}] Sending initialize request to {self.endpoint}")
            logger.debug(f"[MCP {self.server_name}] Initialize headers: {headers}")
            logger.debug(f"[MCP {self.server_name}] Initialize body: {json.dumps(init_request, indent=2)}")

            response = self.client.post(
                self.endpoint,
                json=init_request,
                headers=headers,
            )
            response.raise_for_status()

            logger.info(f"[MCP {self.server_name}] Initialize response status: {response.status_code}")
            logger.debug(f"[MCP {self.server_name}] Initialize response headers: {dict(response.headers)}")

            # Check response body
            response_text = response.text
            logger.debug(f"[MCP {self.server_name}] Initialize response body length: {len(response_text)}")
            if response_text:
                logger.debug(f"[MCP {self.server_name}] Initialize response body: {response_text[:500]}")
            else:
                logger.warning(f"[MCP {self.server_name}] Initialize response body is EMPTY!")

            # Extract session ID from response header if present
            if "mcp-session-id" in response.headers:
                self._session_id = response.headers["mcp-session-id"]
                logger.info(f"[MCP {self.server_name}] Received session ID: {self._session_id}")

            # Validate response body before parsing
            if not response_text:
                raise MCPServerError(
                    f"MCP server {self.server_name} returned empty response during initialization. "
                    f"Status: {response.status_code}, Headers: {dict(response.headers)}"
                )

            # Parse SSE format if present (starts with "event:" or "data:")
            json_text = response_text
            if response_text.startswith("event:") or response_text.startswith("data:"):
                # Parse SSE format: extract JSON from "data: {...}" lines
                lines = response_text.split("\n")
                json_lines = []
                for line in lines:
                    line = line.strip()
                    if line.startswith("data: "):
                        json_lines.append(line[6:])  # Remove "data: " prefix
                    elif line.startswith("data:"):
                        json_lines.append(line[5:])  # Remove "data:" prefix
                if json_lines:
                    json_text = "\n".join(json_lines)
                logger.debug(f"[MCP {self.server_name}] Parsed SSE format, extracted JSON: {json_text[:200]}")

            try:
                result = json.loads(json_text)
            except ValueError as e:
                logger.error(f"[MCP {self.server_name}] JSON parse error during initialization: {e}")
                logger.error(f"[MCP {self.server_name}] Response text: {response_text[:1000]}")
                raise MCPServerError(
                    f"Invalid JSON response during initialization: {e}. "
                    f"Response (first 500 chars): {response_text[:500]}"
                ) from e

            if "error" in result:
                error = result["error"]
                logger.error(f"[MCP {self.server_name}] Initialization error: {error}")
                raise MCPServerError(
                    f"MCP initialization error: {error.get('message', 'Unknown error')} "
                    f"(code: {error.get('code', 'unknown')})"
                )

            logger.info(f"[MCP {self.server_name}] Initialize successful, result: {result}")

            # Step 2: Send initialized notification (no response expected)
            initialized_notification = {
                "jsonrpc": "2.0",
                "method": "notifications/initialized"
            }

            # Include session ID in notification if we have one
            notif_headers = self._http_headers.copy()
            if self._session_id:
                notif_headers["Mcp-Session-Id"] = self._session_id

            logger.debug(f"[MCP {self.server_name}] Sending initialized notification")
            # Send notification (some servers may not respond, so we don't check response)
            try:
                notif_response = self.client.post(
                    self.endpoint,
                    json=initialized_notification,
                    headers=notif_headers,
                )
                logger.debug(f"[MCP {self.server_name}] Initialized notification response: {notif_response.status_code}")
            except Exception as e:
                # Notification may not return a response, which is fine
                logger.debug(f"[MCP {self.server_name}] Initialized notification exception (expected): {e}")

            logger.info(f"[MCP {self.server_name}] HTTP protocol initialized successfully")
        except httpx.HTTPStatusError as e:
            error_text = ""
            try:
                error_text = e.response.text
                logger.error(f"[MCP {self.server_name}] HTTP {e.response.status_code} during initialization: {error_text[:500]}")
            except Exception:
                pass
            raise MCPServerError(
                f"MCP initialization error: HTTP {e.response.status_code}: {error_text}"
            ) from e
        except httpx.RequestError as e:
            logger.error(f"[MCP {self.server_name}] Request error during initialization: {e}")
            raise MCPConnectionError(f"Error during MCP HTTP initialization: {e}") from e

    def connect(self) -> None:
        """Connect to the MCP server."""
        logger.info(f"[MCP {self.server_name}] connect() called with transport='{self.transport}'")
        if self.transport == "stdio":
            logger.info(f"[MCP {self.server_name}] Using stdio transport")
            try:
                full_command = self.command + self.args
                env = {**os.environ, **self.env} if hasattr(os, "environ") else self.env
                self.process = subprocess.Popen(
                    full_command,
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    env=env,
                    text=False,
                    bufsize=0,
                )
                logger.info(f"Started MCP server process {self.server_name}")

                # Perform protocol initialization
                self._initialize_protocol()
                logger.info(f"Connected to MCP server {self.server_name} via stdio")
            except Exception as e:
                logger.error(f"[MCP {self.server_name}] Error in stdio connect: {e}", exc_info=True)
                raise MCPConnectionError(f"Failed to start MCP server {self.server_name}: {e}") from e
        else:
            logger.info(f"[MCP {self.server_name}] Using HTTP transport, calling _initialize_http_protocol()")
            # HTTP transport requires initialization handshake
            try:
                self._initialize_http_protocol()
                logger.info(f"Connected to MCP server {self.server_name} via HTTP")
            except Exception as e:
                logger.error(f"[MCP {self.server_name}] Error in HTTP connect: {e}", exc_info=True)
                raise

    def disconnect(self) -> None:
        """Disconnect from the MCP server."""
        if self.transport == "stdio" and self.process:
            try:
                self.process.terminate()
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
            except Exception as e:
                logger.warning(f"Error disconnecting from MCP server {self.server_name}: {e}")
            finally:
                self.process = None
        elif self.transport == "http":
            self.client.close()

        self._tools = None
        logger.info(f"Disconnected from MCP server {self.server_name}")

    def list_tools(self) -> List[Dict[str, Any]]:
        """
        List all available tools from the MCP server.

        Returns:
            List of tool definitions, each containing name, description, and inputSchema.

        Raises:
            MCPConnectionError: If not connected to the server.
            MCPServerError: If the server returns an error.
        """
        if self._tools is not None:
            return self._tools

        try:
            response = self._send_jsonrpc_request("tools/list")
            tools = response.get("tools", [])
            self._tools = tools
            logger.info(f"Discovered {len(tools)} tools from MCP server {self.server_name}")
            return tools
        except Exception as e:
            logger.error(f"Error listing tools from MCP server {self.server_name}: {e}")
            raise

    def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Any:
        """
        Call a tool on the MCP server.

        Args:
            tool_name: Name of the tool to call.
            arguments: Arguments to pass to the tool.

        Returns:
            The result from the tool execution.

        Raises:
            MCPToolNotFoundError: If the tool is not found.
            MCPServerError: If the server returns an error.
        """
        try:
            logger.info(f"Calling MCP tool {tool_name} with arguments: {arguments}")
            print(f"[MCP] Calling tool {tool_name} with arguments: {arguments}")  # Fallback for visibility
            response = self._send_jsonrpc_request(
                "tools/call",
                {"name": tool_name, "arguments": arguments},
            )

            logger.info(f"MCP tool {tool_name} response: {response}")
            print(f"[MCP] Tool {tool_name} response: {response}")  # Fallback for visibility

            # Check for errors in the response
            if "isError" in response and response.get("isError"):
                error_msg = response.get("content", "Unknown error")
                logger.error(f"MCP tool {tool_name} returned error: {error_msg}")
                print(f"[MCP] ERROR: Tool {tool_name} returned error: {error_msg}")
                raise MCPServerError(f"MCP tool {tool_name} error: {error_msg}")

            if "content" in response:
                # MCP tools return content array
                content = response["content"]
                if content and isinstance(content, list) and len(content) > 0:
                    # Extract text from content items
                    text_parts: List[str] = []
                    for item in content:
                        if isinstance(item, dict):
                            # Check for error type
                            if item.get("type") == "text":
                                text_parts.append(item.get("text", ""))
                            elif item.get("type") == "error":
                                error_text = item.get("text", "Unknown error")
                                logger.error(f"MCP tool {tool_name} content error: {error_text}")
                                print(f"[MCP] ERROR in content: {error_text}")
                                text_parts.append(f"Error: {error_text}")
                    text_result = "\n".join(text_parts) if text_parts else str(response)
                    logger.info(f"MCP tool {tool_name} returned: {text_result[:200]}")
                    print(f"[MCP] Tool {tool_name} returned: {text_result[:200]}")
                    return text_result
                response_text = str(response)
                logger.info(f"MCP tool {tool_name} returned (no content): {response_text[:200]}")
                print(f"[MCP] Tool {tool_name} returned (no content): {response_text[:200]}")
                return response_text

            logger.info(f"MCP tool {tool_name} returned: {response}")
            print(f"[MCP] Tool {tool_name} returned: {response}")
            return response
        except MCPServerError as e:
            logger.error(f"MCP server error calling tool {tool_name}: {e}")
            if "not found" in str(e).lower():
                raise MCPToolNotFoundError(f"Tool '{tool_name}' not found on MCP server {self.server_name}") from e
            # Re-raise with more context
            raise MCPServerError(f"MCP server error calling tool {tool_name} with arguments {arguments}: {e}") from e
        except Exception as e:
            logger.error(f"Error calling tool {tool_name} on MCP server {self.server_name}: {e}", exc_info=True)
            raise MCPServerError(f"Error calling tool {tool_name}: {e}") from e

    def __enter__(self) -> "MCPClient":
        """Context manager entry."""
        self.connect()
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        """Context manager exit."""
        self.disconnect()
