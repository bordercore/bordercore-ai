"""
Unified tool registry for local functions and MCP tools.

This module provides a single interface for registering and discovering tools,
whether they are local Python functions or tools exposed by MCP servers.
"""

import importlib
import logging
from typing import Any, Callable, Dict, List, Optional

from modules.mcp_client import MCPClient
from modules.mcp_exceptions import MCPConnectionError, MCPServerError

logger = logging.getLogger(__name__)


class ToolRegistry:
    """
    Registry for managing both local tools and MCP tools.

    Provides a unified interface for tool discovery and execution.
    """

    def __init__(self) -> None:
        """Initialize the tool registry."""
        self.local_tools: Dict[str, Dict[str, Any]] = {}
        self.mcp_clients: Dict[str, MCPClient] = {}
        self.mcp_tools: Dict[str, Dict[str, Any]] = {}
        self._tool_source: Dict[str, str] = {}  # Maps tool name to source (local or mcp server name)

    def register_local_tool(
        self,
        tool_name: str,
        function: Callable[..., Any],
        description: Optional[str] = None,
        parameters_schema: Optional[Dict[str, Any]] = None,
    ) -> None:
        """
        Register a local Python function as a tool.

        Args:
            tool_name: Unique name for the tool.
            function: The callable function to register.
            description: Optional description of what the tool does.
            parameters_schema: Optional JSON schema for the tool parameters.
        """
        if not callable(function):
            raise ValueError(f"Tool {tool_name} must be callable")

        self.local_tools[tool_name] = {
            "name": tool_name,
            "function": function,
            "description": description or f"Tool: {tool_name}",
            "parameters_schema": parameters_schema or {},
            "type": "local",
        }
        self._tool_source[tool_name] = "local"
        logger.info(f"Registered local tool: {tool_name}")

    def register_local_tool_from_module(
        self,
        tool_name: str,
        module_name: str,
        function_name: str,
        description: Optional[str] = None,
        parameters_schema: Optional[Dict[str, Any]] = None,
    ) -> None:
        """
        Register a local tool by importing it from a module.

        Args:
            tool_name: Unique name for the tool.
            module_name: Name of the module (e.g., "modules.wolfram_alpha").
            function_name: Name of the function in the module.
            description: Optional description of what the tool does.
            parameters_schema: Optional JSON schema for the tool parameters.
        """
        try:
            module = importlib.import_module(module_name)
            function = getattr(module, function_name)
            if not callable(function):
                raise ValueError(f"{function_name} in {module_name} is not callable")
            self.register_local_tool(tool_name, function, description, parameters_schema)
        except (ImportError, AttributeError) as e:
            logger.error(f"Failed to register local tool {tool_name} from {module_name}.{function_name}: {e}")
            raise

    def register_mcp_client(self, server_name: str, client: MCPClient, allowed_path: str | None = None) -> None:
        """
        Register an MCP client and discover its tools.

        Args:
            server_name: Name identifier for the MCP server.
            client: Initialized MCPClient instance.
            allowed_path: Optional allowed path for filesystem servers (to enhance tool descriptions).
        """
        self.mcp_clients[server_name] = client

        try:
            tools = client.list_tools()
            for tool in tools:
                mcp_tool_name = tool.get("name")
                if not mcp_tool_name:
                    continue

                # Prefix tool name with server name to avoid conflicts
                prefixed_name = f"{server_name}::{mcp_tool_name}"

                # Enhance description with allowed path information for filesystem tools
                description = tool.get("description", "")
                if allowed_path and server_name == "filesystem":
                    path_info = f"\n\nNote: This tool can only access files within the allowed directory: {allowed_path}"
                    description = description + path_info

                self.mcp_tools[prefixed_name] = {
                    "name": prefixed_name,
                    "original_name": mcp_tool_name,
                    "description": description,
                    "inputSchema": tool.get("inputSchema", {}),
                    "server": server_name,
                    "type": "mcp",
                }
                self._tool_source[prefixed_name] = server_name
                logger.info(f"Registered MCP tool: {prefixed_name} from server {server_name}")
        except (MCPConnectionError, MCPServerError) as e:
            logger.error(f"Failed to discover tools from MCP server {server_name}: {e}")
            raise

    def get_tool(self, tool_name: str) -> Optional[Dict[str, Any]]:
        """
        Get tool metadata by name.

        Args:
            tool_name: Name of the tool.

        Returns:
            Tool metadata dictionary, or None if not found.
        """
        if tool_name in self.local_tools:
            return self.local_tools[tool_name]
        if tool_name in self.mcp_tools:
            return self.mcp_tools[tool_name]
        return None

    def list_tools(self) -> List[Dict[str, Any]]:
        """
        List all registered tools.

        Returns:
            List of tool metadata dictionaries.
        """
        tools = []
        for tool in self.local_tools.values():
            tools.append({
                "name": tool["name"],
                "description": tool["description"],
                "parameters_schema": tool["parameters_schema"],
                "type": "local",
            })
        for tool in self.mcp_tools.values():
            tools.append({
                "name": tool["name"],
                "description": tool["description"],
                "parameters_schema": tool.get("inputSchema", {}),
                "type": "mcp",
                "server": tool["server"],
            })
        return tools

    def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Any:
        """
        Call a tool by name.

        Args:
            tool_name: Name of the tool to call.
            arguments: Arguments to pass to the tool.

        Returns:
            The result from the tool execution.

        Raises:
            ValueError: If the tool is not found.
        """
        if tool_name in self.local_tools:
            tool = self.local_tools[tool_name]
            function = tool["function"]
            try:
                return function(**arguments)
            except Exception as e:
                logger.error(f"Error calling local tool {tool_name}: {e}", exc_info=True)
                raise

        if tool_name in self.mcp_tools:
            tool = self.mcp_tools[tool_name]
            server_name = tool["server"]
            original_name = tool["original_name"]

            if server_name not in self.mcp_clients:
                raise ValueError(f"MCP server {server_name} not connected")

            client = self.mcp_clients[server_name]
            try:
                logger.info(f"Calling MCP tool {tool_name} (original: {original_name}) on server {server_name} with arguments: {arguments}")
                print(f"[Tool Registry] Calling MCP tool {tool_name} (original: {original_name}) on server {server_name} with arguments: {arguments}")
                result = client.call_tool(original_name, arguments)
                logger.info(f"MCP tool {tool_name} returned: {str(result)[:500]}")
                print(f"[Tool Registry] MCP tool {tool_name} returned: {str(result)[:500]}")
                return result
            except Exception as e:
                logger.error(f"Error calling MCP tool {tool_name}: {e}", exc_info=True)
                print(f"[Tool Registry] ERROR calling MCP tool {tool_name}: {e}")  # Fallback for visibility
                import traceback
                print(f"[Tool Registry] Traceback: {traceback.format_exc()}")  # Full traceback
                # Include more context in the error
                raise ValueError(f"Error calling MCP tool {tool_name} with arguments {arguments}: {e}") from e

        raise ValueError(f"Tool '{tool_name}' not found in registry")

    def get_tool_schema_for_model(self) -> List[Dict[str, Any]]:
        """
        Get tool schemas in a format suitable for model chat templates.

        Returns:
            List of tool schemas compatible with model tool calling format.
        """
        schemas: List[Dict[str, Any]] = []
        for tool in self.list_tools():
            function_block: Dict[str, Any] = {
                "name": tool["name"],
                "description": tool["description"],
            }
            schema: Dict[str, Any] = {
                "type": "function",
                "function": function_block,
            }

            # Convert parameters schema to model format
            params_schema = tool.get("parameters_schema", {})
            if params_schema:
                function_block["parameters"] = params_schema
            else:
                function_block["parameters"] = {
                    "type": "object",
                    "properties": {},
                }

            schemas.append(schema)
        return schemas

    def disconnect_all_mcp_servers(self) -> None:
        """Disconnect all registered MCP servers."""
        for server_name, client in list(self.mcp_clients.items()):
            try:
                client.disconnect()
                logger.info(f"Disconnected MCP server: {server_name}")
            except Exception as e:
                logger.warning(f"Error disconnecting MCP server {server_name}: {e}")

        self.mcp_clients.clear()
        self.mcp_tools.clear()
        # Remove MCP tools from tool source mapping
        self._tool_source = {
            k: v for k, v in self._tool_source.items() if v == "local"
        }

