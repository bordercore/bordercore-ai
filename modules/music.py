"""
Music playback command parser and executor using an LLM and a music search API.

This module accepts natural language music commands, uses an LLM to extract structured
JSON containing artist/song/album information, then queries a music API and returns
a formatted response with playback instructions.
"""

import json
import logging
import os
import urllib.parse
from typing import TYPE_CHECKING

import requests
from http_constants.status import HttpStatus

import settings

if TYPE_CHECKING:
    from mypackage.chatbot import ChatBot

logger = logging.getLogger(__name__)

# Configure logger to display DEBUG level and up messages to console
logger.setLevel(logging.DEBUG)
# Only add handler if one doesn't already exist (prevents duplicate logs)
if not logger.handlers:
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.DEBUG)
    formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)


class MusicServiceError(Exception):
    """User-friendly error for music service failures."""
    pass


def play_music(chatbot: "ChatBot", command: str) -> str:
    """
    Parse a natural language command to play music using an LLM, then look up matching music.

    Args:
        chatbot: ChatBot instance providing LLM access
        command: A string instruction like "Play Just Drive by Wolf Club".

    Returns:
        A JSON-formatted string prefixed with CONTROL_VALUE, containing:
            - content: A user-facing string summarizing playback.
            - music_info: A list of results from the music API.
    """
    logger.info(f"Starting music request processing for command: {command}")

    prompt = """
    I will give you an instruction to play music. From the instruction you must select an artist name, a song name, or an album name, or all three. I want your response in JSON format. For example, if the instruction is "Play me With or Without You by U2", you would respond with the following JSON: {"artist": "U2", "song": "With or Without You"}. For the instruction "Play Just Drive by Wolf Club", you would respond with the following JSON: {"artist": "Wolf Club", "song": "Just Drive"}. If no artist is provided, do not include an artist field in the JSON; only include the song. For example, for the instruction "Play the song Promise", you would respond with the following JSON: {"song": "Promise"}. If I do not explicitly mention playing a song in the instruction, assume I am asking for an artist and do not include a song field in the JSON. In this case I want to play an artist and not a song. For example, for the instruction "Play Foo Fighters", you would respond with the following JSON: {"artist": "Foo Fighters"}.

Verify that the JSON object represents valid JSON. If it does not, correct the JSON so that it is valid.

Give me only the JSON and no additional characters, text, or comments.

Do not format the JSON by including newlines.

Here is the instruction:
    """

    prompt += command
    args = {"temperature": 1.0}

    from modules.chatbot import CONTROL_VALUE

    try:
        logger.debug(f"Sending prompt to LLM for music command parsing")
        llm_response = chatbot.send_message_to_model(prompt, args)
        logger.debug(f"Received LLM response (first 200 chars): {str(llm_response)[:200]}")

        try:
            content = json.loads(llm_response)
            logger.info(f"Successfully parsed LLM response as JSON: {content}")
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse LLM response as JSON. Response: {llm_response[:500]}, Error: {e}")
            raise MusicServiceError("Sorry, I couldn't understand that music request. Please try again.") from e
    except MusicServiceError:
        raise  # Re-raise our custom errors as-is
    except Exception as e:
        logger.error(f"Error calling LLM or parsing response: {e}", exc_info=True)
        raise MusicServiceError("Sorry, I had trouble processing your music request.") from e

    # Get the song info from the music API
    uri_music = f"{settings.music_api_host}/api/search/music"
    headers = {
        "Authorization": f"Token {os.environ.get('DRF_TOKEN_JERRELL')}",
    }

    query_string = urllib.parse.urlencode(content)
    music_api_url = f"{uri_music}?{query_string}"

    logger.info(f"Querying music API: {music_api_url} (auth token present: {bool(headers['Authorization'])})")

    try:
        response = requests.get(music_api_url, headers=headers, timeout=20)
        logger.debug(f"Music API response status: {response.status_code}")

        if response.status_code != HttpStatus.OK:
            logger.error(f"Music API returned non-200 status: {response.status_code}, Response: {response.text[:500]}")
            # Convert status code to readable name (e.g., 400 -> "Bad Request")
            try:
                status_name = HttpStatus(response.status_code).name.replace("_", " ").title()
            except ValueError:
                status_name = f"Error {response.status_code}"
            raise MusicServiceError(f"Unable to search for music ({status_name})")

        try:
            music_info = response.json()
            logger.info(f"Music API returned {len(music_info) if isinstance(music_info, list) else 'non-list'} result(s)")
            if settings.debug:
                logger.debug(f"Music API response: {music_info}")
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse music API response as JSON. Status: {response.status_code}, Response: {response.text[:500]}, Error: {e}")
            raise MusicServiceError("Music service returned an invalid response") from e
    except requests.exceptions.Timeout as e:
        logger.error(f"Timeout connecting to music API: {e}", exc_info=True)
        raise MusicServiceError("Music service is taking too long to respond") from e
    except requests.exceptions.ConnectionError as e:
        logger.error(f"Connection error to music API: {e}", exc_info=True)
        raise MusicServiceError("Unable to connect to music service") from e
    except requests.exceptions.RequestException as e:
        logger.error(f"Error making request to music API: {e}", exc_info=True)
        raise MusicServiceError("Error communicating with music service") from e
    except MusicServiceError:
        raise  # Re-raise our custom errors as-is
    except Exception as e:
        logger.error(f"Unexpected error processing music API response: {e}", exc_info=True)
        raise MusicServiceError("An unexpected error occurred while searching for music") from e

    # Prepare response content
    try:
        if not music_info:
            content_message = "Sorry, no music found that matches."
            logger.warning("No music found matching the query")
        elif "album" in content:
            content_message = f"Playing album by {music_info[0]['artist']}."
            logger.info(f"Playing album by {music_info[0]['artist']}")
        elif len(music_info) > 1:
            content_message = f"More than one song found. Playing the first one, {music_info[0]['title']} by {music_info[0]['artist']}."
            logger.info(f"Multiple songs found, playing first: {music_info[0]['title']} by {music_info[0]['artist']}")
        else:
            content_message = f"Playing {music_info[0]['title']} by {music_info[0]['artist']}."
            logger.info(f"Playing: {music_info[0]['title']} by {music_info[0]['artist']}")

        result = CONTROL_VALUE + json.dumps({
            "music_info": music_info,
            "content": content_message,
        })
        print(result)
        logger.info("Successfully constructed music response with CONTROL_VALUE prefix")
        return result
    except (KeyError, IndexError, TypeError) as e:
        logger.error(f"Error accessing music_info fields. music_info structure: {music_info}, Error: {e}", exc_info=True)
        raise MusicServiceError("Music search returned unexpected data") from e
    except MusicServiceError:
        raise  # Re-raise our custom errors as-is
    except Exception as e:
        logger.error(f"Unexpected error constructing response: {e}", exc_info=True)
        raise MusicServiceError("An unexpected error occurred") from e
