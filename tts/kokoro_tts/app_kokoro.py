"""
TTS Audio Generator Web Service

This module provides a Flask web service that generates text-to-speech audio
using the Kokoro TTS pipeline. It streams the generated audio as a WAV file response.

Command line arguments:
    --voice: Voice to use for TTS (default: bf_emma)
    --debug: Enable debug mode for saving audio files and Flask debugging
    --tts_speed: Speed of TTS voice (default: 1.0)

Usage:
    python -m tts --voice bf_emma --tts_speed 1.2
"""

import argparse
import hashlib
import os
import threading
import time
from typing import Iterator

import numpy as np
from flask import Flask, Response, jsonify, request, stream_with_context
from flask_cors import CORS
from kokoro import KPipeline

try:
    from capabilities import build_tts_capabilities
except ModuleNotFoundError:  # Imported as tts.kokoro_tts from the repository root.
    from tts.capabilities import build_tts_capabilities

from .streaming_audio import (
    SAMPLE_RATE,
    float_audio_to_pcm16,
    streaming_wav_header,
)

# Set up command line argument parser
parser = argparse.ArgumentParser(description="TTS audio generator")
parser.add_argument("--voice", dest="tts_voice", default="bf_emma",
                    help="Voice to use for TTS")
parser.add_argument("--tts_speed", dest="tts_speed", type=float, default=1.0,
                    help="Speed of TTS voice")
parser.add_argument("--debug", dest="debug", action="store_true", default=False,
                    help="Voice to use for TTS")
args, _unknown_args = parser.parse_known_args()

app = Flask(__name__)
CORS(app)

# Get values from command line args
TTS_VOICE = args.tts_voice
TTS_SPEED = args.tts_speed
DEBUG = args.debug

# Load the model
pipeline = KPipeline(lang_code="a")  # <= make sure lang_code matches voice
pipeline_lock = threading.Lock()

KOKORO_VOICES = [
    "af_alloy", "af_aoede", "af_bella", "af_heart", "af_jessica",
    "af_kore", "af_nicole", "af_nova", "af_river", "af_sarah", "af_sky",
    "am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam", "am_michael",
    "am_onyx", "am_puck", "am_santa", "bf_alice", "bf_emma", "bf_isabella",
    "bf_lily", "bm_daniel", "bm_fable", "bm_george", "bm_lewis",
]


@app.route("/capabilities", methods=["GET"])
def get_capabilities() -> Response:
    """Report the versioned Kokoro feature and voice inventory."""
    return jsonify(
        build_tts_capabilities(
            engine="kokoro",
            sample_rate=SAMPLE_RATE,
            voices=KOKORO_VOICES,
            default_voice=TTS_VOICE,
            supports_speed=True,
            supports_cloning=False,
        )
    )


@app.route("/", methods=["GET"])
def generate_tts_audio() -> Response:
    """
    **/ (GET)** – Generate text-to-speech audio.

    Expected query parameters
    -------------------------
    text : str
        The text that should be converted to speech.

    Returns
    -------
    flask.Response
        A streaming response with ``Content-Type: audio/wav``.
    """
    payload = request.args
    if DEBUG:
        # Create a filename based on timestamp and a hash of the text
        timestamp = int(time.time())
        text_hash = hashlib.md5(payload["text"].encode()).hexdigest()[:8]
        filename = f"tts_{timestamp}_{text_hash}.wav"
        save_path = os.path.join("saved_audio", filename)
        # Ensure the directory exists
        os.makedirs(os.path.dirname(save_path), exist_ok=True)

    # Set up streaming response
    def generate_audio_chunks() -> Iterator[bytes]:
        """
        Yield a WAV header followed by PCM as Kokoro produces each audio chunk.
        """
        text = payload.get("text", "").strip()
        if not text:
            return

        # These endpoint-specific names avoid accidentally treating voice.wav
        # profiles intended for another TTS engine as Kokoro voice identifiers.
        voice = payload.get("kokoro_voice", TTS_VOICE)
        try:
            speed = float(payload.get("kokoro_speed", TTS_SPEED))
        except (TypeError, ValueError):
            speed = TTS_SPEED
        speed = min(max(speed, 0.5), 2.0)

        yield streaming_wav_header()
        debug_audio: list[np.ndarray] = []

        # KPipeline is shared by all Flask requests. Serialize inference so two
        # clients cannot mutate/use the underlying model concurrently.
        with pipeline_lock:
            generator = pipeline(
                text,
                voice=voice,
                speed=speed,
                split_pattern=r"(?<=[.!?])\s+|\n+",
            )
            for _, _, chunk in generator:
                audio_data = chunk.squeeze().detach().cpu().numpy().astype(np.float32)
                if DEBUG:
                    debug_audio.append(audio_data)
                pcm = float_audio_to_pcm16(audio_data)
                for offset in range(0, len(pcm), 4096):
                    yield pcm[offset : offset + 4096]

        if DEBUG and debug_audio:
            import soundfile as sf

            sf.write(save_path, np.concatenate(debug_audio), SAMPLE_RATE, format="WAV")

    return Response(stream_with_context(generate_audio_chunks()),
                    mimetype="audio/wav")


if __name__ == "__main__":
    app.run(debug=DEBUG)
