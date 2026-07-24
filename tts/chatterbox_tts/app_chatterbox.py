"""
Chatterbox-Turbo TTS Audio Generator Web Service

This module provides a Flask web service that generates text-to-speech audio
using the Chatterbox-Turbo TTS model (350M params, low-latency, English).
It streams the generated audio as a WAV file response.

Supports paralinguistic tags: [laugh], [cough], [chuckle]

Command line arguments:
    --audio_prompt: Optional default reference audio path for voice cloning
    --debug: Enable debug mode for saving audio files and Flask debugging
    --device: cuda/cpu selection (default: cuda)

Usage:
    python app_chatterbox.py --device cuda
    python app_chatterbox.py --audio_prompt reference.wav --debug
"""

import argparse
import hashlib
import io
import os
from pathlib import Path
import tempfile
import time
from typing import Iterator

import numpy as np
import soundfile as sf
from chatterbox.tts_turbo import ChatterboxTurboTTS
from flask import Flask, Response, jsonify, request, stream_with_context
from flask_cors import CORS
from flask.typing import ResponseReturnValue

try:
    from capabilities import build_tts_capabilities
except ModuleNotFoundError:  # Imported as tts.chatterbox_tts from the repository root.
    from tts.capabilities import build_tts_capabilities
from chatterbox_tts.voice_profiles import (
    SUPPORTED_AUDIO_EXTENSIONS,
    list_profiles,
    resolve_profile,
    resolve_profile_from_directories,
    validate_profile_name,
)

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
REPO_VOICES_DIR = REPO_ROOT / "voices"

# Set up command line argument parser
parser = argparse.ArgumentParser(description="Chatterbox-Turbo TTS audio generator")
parser.add_argument(
    "--audio_prompt", dest="audio_prompt", default=None, help="Default reference audio path for voice cloning"
)
parser.add_argument(
    "--debug", dest="debug", action="store_true", default=False, help="Enable debug mode for saving audio files"
)
parser.add_argument("--device", dest="device", default="cuda", help="Device to use for inference (cuda/cpu)")
parser.add_argument(
    "--voice-profile-dir",
    default=os.environ.get(
        "CHATTERBOX_VOICE_DIR",
        str(Path.home() / ".local/share/chatterbox_tts/voices"),
    ),
    help="Directory used to store named voice reference samples",
)
args = parser.parse_args()

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024
CORS(app)

# Get values from command line args
AUDIO_PROMPT = args.audio_prompt
DEBUG = args.debug
DEVICE = args.device
VOICE_PROFILE_DIR = Path(args.voice_profile_dir).expanduser().resolve()
VOICE_PROFILE_DIR.mkdir(parents=True, exist_ok=True)

# Load the model
model = ChatterboxTurboTTS.from_pretrained(device=DEVICE)


def available_voice_profiles() -> list[dict[str, int | str]]:
    """Return metadata for every profile accepted by the synthesis endpoint."""
    profiles: dict[str, dict[str, int | str]] = {}
    for profile in list_profiles(VOICE_PROFILE_DIR) + list_profiles(REPO_VOICES_DIR):
        name = str(profile["name"])
        profiles.setdefault(name, profile)
    return [profiles[name] for name in sorted(profiles)]


def available_voices() -> list[str]:
    """Return every accepted profile name for the capability contract."""
    return [str(profile["name"]) for profile in available_voice_profiles()]


@app.route("/capabilities", methods=["GET"])
def get_capabilities() -> Response:
    """Report the versioned Chatterbox feature and voice inventory."""
    voices = available_voices()
    default_candidate = Path(AUDIO_PROMPT).stem if AUDIO_PROMPT else None
    default_voice = default_candidate if default_candidate in voices else None
    return jsonify(
        build_tts_capabilities(
            engine="chatterbox",
            sample_rate=int(model.sr),
            voices=voices,
            default_voice=default_voice,
            supports_speed=False,
            supports_cloning=True,
        )
    )


@app.route("/voices", methods=["GET"])
def get_voice_profiles() -> Response:
    """List the voice profiles available to this server."""
    return jsonify({"voices": available_voice_profiles()})


@app.route("/voices", methods=["POST"])
def create_voice_profile() -> ResponseReturnValue:
    """Create a named voice profile from a multipart audio upload."""
    try:
        name = validate_profile_name(request.form.get("name", ""))
    except ValueError as error:
        return jsonify({"error": str(error)}), 400

    audio = request.files.get("audio")
    if audio is None or not audio.filename:
        return jsonify({"error": "Missing multipart 'audio' file."}), 400

    extension = Path(audio.filename).suffix.lower()
    if extension not in SUPPORTED_AUDIO_EXTENSIONS:
        supported = ", ".join(sorted(SUPPORTED_AUDIO_EXTENSIONS))
        return jsonify({"error": f"Unsupported audio type. Use: {supported}"}), 400

    if resolve_profile(VOICE_PROFILE_DIR, name) is not None:
        return jsonify({"error": f"Voice profile '{name}' already exists."}), 409

    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(dir=VOICE_PROFILE_DIR, suffix=extension, delete=False) as temporary_file:
            temporary_path = Path(temporary_file.name)
            audio.save(temporary_file)

        # Reject corrupt or unreadable files before making the profile visible.
        audio_info = sf.info(temporary_path)
        if audio_info.duration <= 5:
            raise ValueError("Voice samples must be longer than 5 seconds.")
        destination = VOICE_PROFILE_DIR / f"{name}{extension}"
        temporary_path.replace(destination)
    except (OSError, RuntimeError, ValueError) as error:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
        return jsonify({"error": f"Invalid audio file: {error}"}), 400

    return jsonify(
        {
            "name": name,
            "filename": destination.name,
            "size": destination.stat().st_size,
        }
    ), 201


@app.route("/", methods=["GET"])
def generate_tts_audio() -> Response:
    """
    **/ (GET)** – Generate text-to-speech audio using Chatterbox-Turbo.

    Expected query parameters
    -------------------------
    text : str
        The text to convert to speech. Supports paralinguistic tags:
        [laugh], [cough], [chuckle]
    audio_prompt : str, optional
        Path to reference audio for voice cloning. Overrides default.
    voice : str, optional
        Name of an uploaded voice profile. Takes precedence over audio_prompt.

    Returns
    -------
    flask.Response
        A streaming response with ``Content-Type: audio/wav``.
    """
    payload = request.args
    text = payload.get("text", "")

    if not text:
        return Response("Missing 'text' query parameter", status=400)

    voice = payload.get("voice")
    if voice:
        try:
            profile_path = resolve_profile_from_directories(
                (VOICE_PROFILE_DIR, REPO_VOICES_DIR), voice
            )
        except ValueError as error:
            return Response(str(error), status=400)
        if profile_path is None:
            return Response(f"Unknown voice profile: {voice}", status=404)
        audio_prompt_path = str(profile_path)
    else:
        # Preserve direct server-side paths for backwards compatibility.
        audio_prompt_path = payload.get("audio_prompt", AUDIO_PROMPT)

    if DEBUG:
        # Create a filename based on timestamp and a hash of the text
        timestamp = int(time.time())
        text_hash = hashlib.md5(text.encode()).hexdigest()[:8]
        filename = f"tts_{timestamp}_{text_hash}.wav"
        save_path = os.path.join("saved_audio", filename)
        # Ensure the directory exists
        os.makedirs(os.path.dirname(save_path), exist_ok=True)

    def generate_audio_chunks() -> Iterator[bytes]:
        """
        Yield fixed-size chunks (**1024 bytes**) from an in-memory WAV buffer.

        Chatterbox-Turbo generates a single audio tensor which is written to
        an in-memory WAV buffer and streamed back to the caller.
        """
        # Generate audio using Chatterbox-Turbo
        audio_tensor = model.generate(text, audio_prompt_path=audio_prompt_path)

        # Convert tensor to numpy array
        audio_data = audio_tensor.squeeze().cpu().numpy()

        # Get sample rate from model
        sample_rate = model.sr

        # Save the WAV file to disk in debug mode
        if DEBUG:
            sf.write(save_path, audio_data, sample_rate, format="WAV")

        # Write data to an in-memory buffer as a single WAV
        wav_buffer = io.BytesIO()
        sf.write(wav_buffer, audio_data, sample_rate, format="WAV")
        wav_buffer.seek(0)

        # Stream the buffer to the client
        chunk_size = 1024
        while True:
            data = wav_buffer.read(chunk_size)
            if not data:
                break
            yield data

    return Response(stream_with_context(generate_audio_chunks()), mimetype="audio/wav")


if __name__ == "__main__":
    app.run(port=5001, debug=DEBUG)
