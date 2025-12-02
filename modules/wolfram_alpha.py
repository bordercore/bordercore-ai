"""
This module defines a function to query Wolfram Alpha for simple
calculations and a FunctionCall integration for use in model-based toolchains.
"""

import logging
import urllib.parse

import requests
from requests.exceptions import ConnectionError, RequestException, Timeout

import settings
from modules.function_calling import FunctionCall

logger = logging.getLogger(__name__)


def calculate(query: str) -> str:
    """
    Perform a mathematical calculation using the Wolfram Alpha API.

    Args:
        query: A natural language or symbolic math expression.
    Returns:
        The textual result of the calculation returned by Wolfram Alpha.
    Raises:
        Exception: If the API request fails or returns an error.
    """
    logger.info(f"Calculating query: {query[:200]}")

    uri_api = f"http://api.wolframalpha.com/v1/result?appid={settings.wolfram_alpha_app_id}&i={urllib.parse.quote(query)}"
    logger.debug(f"Querying Wolfram Alpha API: {uri_api.split('?')[0]}... (appid present: {bool(settings.wolfram_alpha_app_id)})")

    try:
        response = requests.get(uri_api, timeout=20)
        logger.debug(f"Wolfram Alpha API response status: {response.status_code}")

        if response.status_code != 200:
            error_msg = f"Wolfram Alpha API returned status {response.status_code}"
            logger.error(f"{error_msg}, Response: {response.text[:500]}")
            return f"Error: Wolfram Alpha API returned status {response.status_code}. {response.text[:200]}"

        result = response.text
        logger.info(f"Wolfram Alpha calculation successful (result length: {len(result)} chars): {result[:200]}")

        if settings.debug:
            print(result)

        return result

    except Timeout as e:
        logger.error(f"Timeout connecting to Wolfram Alpha API: {e}", exc_info=True)
        return "Error: Wolfram Alpha API request timed out. Please try again."
    except ConnectionError as e:
        logger.error(f"Connection error to Wolfram Alpha API: {e}", exc_info=True)
        return "Error: Unable to connect to Wolfram Alpha API. Please check your internet connection."
    except RequestException as e:
        logger.error(f"Error making request to Wolfram Alpha API: {e}", exc_info=True)
        return f"Error: Failed to query Wolfram Alpha API. {str(e)[:200]}"
    except Exception as e:
        logger.error(f"Unexpected error in Wolfram Alpha calculation: {e}", exc_info=True)
        return f"Error: An unexpected error occurred while calculating. {str(e)[:200]}"


class WolframAlphaFunctionCall(FunctionCall):
    """
    A wrapper class for calling Wolfram Alpha as a tool function in an agent chain.
    """

    tool_name = "wolfram_alpha"
    tool_list = "calculate"


def main() -> None:
    """
    Launch an interactive loop for querying Wolfram Alpha via the FunctionCall interface.

    This function continuously prompts the user for input, sends the query to a
    WolframAlphaFunctionCall instance, and prints the result. It is intended for
    simple REPL-style debugging or manual exploration of the Wolfram Alpha tool logic.
    """
    while True:
        user_input = input("Query: ")
        func = WolframAlphaFunctionCall("")
        print(func.run(user_input))


if __name__ == "__main__":
    main()
