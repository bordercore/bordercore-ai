"""
Custom exceptions for MCP (Model Context Protocol) operations.
"""


class MCPError(Exception):
    """Base exception for MCP-related errors."""


class MCPServerError(MCPError):
    """Exception raised when an MCP server returns an error."""


class MCPConnectionError(MCPError):
    """Exception raised when unable to connect to an MCP server."""


class MCPToolNotFoundError(MCPError):
    """Exception raised when a requested tool is not found."""


class MCPTimeoutError(MCPError):
    """Exception raised when an MCP operation times out."""

