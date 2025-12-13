"""
Utility functions for loading model configuration, sorting model metadata, extracting
web content, and post-processing model outputs.
"""

from pathlib import Path
from typing import Any, Dict, List

import requests
import yaml

try:
    from trafilatura import bare_extraction
except ModuleNotFoundError:
    # This package is not required for the API
    pass


def get_model_info() -> Dict[str, Any]:
    """
    Load and parse the `models.yaml` configuration file.

    Returns:
        dict: A dictionary containing model configuration data.
    """
    try:
        models_file_path = Path(__file__).resolve().parent.parent / Path("models.yaml")
        with open(models_file_path, "r", encoding="utf-8") as file:
            model_info = yaml.safe_load(file)
        return model_info
    except FileNotFoundError:
        return {}


def sort_models(
    original_list: List[Dict[str, Any]],
    sort_order: List[str]
) -> List[Dict[str, Any]]:
    """
    Sort a list of model dictionaries based on a predefined name order.

    Items not in the sort order will be placed at the end, in original order.

    Args:
        original_list: List of model dictionaries, each with a 'name' key.
        sort_order: List of model names specifying the desired sort order.

    Returns:
        List of model dictionaries sorted by the specified order.
    """
    sort_order_dict = {value: index for index, value in enumerate(sort_order)}
    to_sort = [item for item in original_list if item["name"] in sort_order_dict]
    to_keep = [item for item in original_list if item["name"] not in sort_order_dict]
    sorted_items = sorted(to_sort, key=lambda x: sort_order_dict[x["name"]])
    return sorted_items + to_keep


def get_webpage_contents(url: str) -> str:
    """
    Fetch a webpage and extract its raw text content.

    Args:
        url: The URL of the webpage to fetch.

    Returns:
        str: The extracted raw text of the page.

    Raises:
        requests.exceptions.RequestException: If the request fails.
        KeyError: If expected fields are missing from the extracted output.
    """
    response = requests.get(url, timeout=10)
    response.raise_for_status()
    extracted_text = bare_extraction(response.text)
    return extracted_text["raw_text"]


def strip_code_fences(text: str) -> str:
    """
    Remove surrounding Markdown code fences from a string, if present.

    Args:
        text: The input string potentially wrapped in triple backticks.

    Returns:
        str: The unwrapped text, or the original text if no fences are found.
    """
    lines = text.splitlines()
    if lines and lines[0].startswith("```") and lines[-1].startswith("```"):
        return "\n".join(lines[1:-1])
    return text


def clean_model_response(text: str) -> str:
    """
    Clean model response by removing special tokens and code fences.

    Removes:
    - Markdown code fences (triple backticks)
    - Common special tokens like <|im_end|>, <|eot_id|>, <|eom_id|>, etc.
    - Trailing whitespace

    Also attempts to extract valid JSON if the response contains JSON followed by tokens.

    Args:
        text: The raw model response text.

    Returns:
        str: The cleaned text.
    """
    import json
    import re

    # First strip code fences
    cleaned = strip_code_fences(text.strip())

    # Try to extract JSON if the response looks like it contains JSON
    # This handles cases where the model appends tokens after JSON
    # Look for the first { and try to find the matching }
    brace_start = cleaned.find("{")
    if brace_start != -1:
        # Count braces to find the matching closing brace
        brace_count = 0
        for i in range(brace_start, len(cleaned)):
            if cleaned[i] == "{":
                brace_count += 1
            elif cleaned[i] == "}":
                brace_count -= 1
                if brace_count == 0:
                    # Found complete JSON object
                    json_candidate = cleaned[brace_start:i + 1]
                    # Validate it's actually JSON
                    try:
                        json.loads(json_candidate)
                        cleaned = json_candidate
                        break
                    except json.JSONDecodeError:
                        pass

    # Remove common special tokens that models append
    special_tokens = [
        "<|im_end|>",
        "<|im_start|>",
        "<|eot_id|>",
        "<|eom_id|>",
        "<|endoftext|>",
        "<|end|>",
    ]

    for token in special_tokens:
        # Remove token from anywhere in the string (handle multiple occurrences)
        while token in cleaned:
            cleaned = cleaned.replace(token, "")
        # Also remove if it's at the end (common case) - double check
        if cleaned.endswith(token):
            cleaned = cleaned[:-len(token)]

    # Strip whitespace again after token removal
    return cleaned.strip()
