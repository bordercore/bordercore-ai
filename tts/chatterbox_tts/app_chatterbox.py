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
import time
from typing import Iterator

import numpy as np
import soundfile as sf
from chatterbox.tts_turbo import ChatterboxTurboTTS
from flask import Flask, Response, request, stream_with_context
from flask_cors import CORS

# Set up command line argument parser
parser = argparse.ArgumentParser(description="Chatterbox-Turbo TTS audio generator")
parser.add_argument("--audio_prompt", dest="audio_prompt", default=None,
                    help="Default reference audio path for voice cloning")
parser.add_argument("--debug", dest="debug", action="store_true", default=False,
                    help="Enable debug mode for saving audio files")
parser.add_argument("--device", dest="device", default="cuda",
                    help="Device to use for inference (cuda/cpu)")
args = parser.parse_args()

app = Flask(__name__)
CORS(app)

# Get values from command line args
AUDIO_PROMPT = args.audio_prompt
DEBUG = args.debug
DEVICE = args.device

# Load the model
model = ChatterboxTurboTTS.from_pretrained(device=DEVICE)


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

    Returns
    -------
    flask.Response
        A streaming response with ``Content-Type: audio/wav``.
    """
    payload = request.args
    text = payload.get("text", "")

    if not text:
        return Response("Missing 'text' query parameter", status=400)

    # Use request audio_prompt if provided, otherwise fall back to default
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

    return Response(stream_with_context(generate_audio_chunks()),
                    mimetype="audio/wav")


if __name__ == "__main__":
    app.run(port=5001, debug=DEBUG)
