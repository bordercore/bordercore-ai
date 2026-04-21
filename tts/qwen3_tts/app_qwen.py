"""
Qwen3-TTS Audio Generator Web Service

This module provides a Flask web service that generates text-to-speech audio
using the Qwen3-TTS-12Hz-0.6B-Base model (0.6B params, multilingual, voice
cloning). It streams the generated audio as a WAV file response.

Qwen3-TTS-Base requires reference audio to clone a voice. A matching transcript
(``ref_text``) yields the best quality; when omitted, ``x_vector_only_mode=True``
is used so only the speaker embedding is consumed.

Command line arguments:
    --audio_prompt: Default reference audio path (default: voices/shadowheart.wav)
    --ref_text: Optional transcript of the reference audio
    --language: Synthesis language (default: auto)
    --debug: Enable debug mode for saving audio files and Flask debugging
    --device: cuda/cpu selection (default: cuda)

Usage:
    python -m qwen3_tts --device cuda
    python -m qwen3_tts --audio_prompt voices/shadowheart.wav --ref_text "..."
"""

import argparse
import hashlib
import io
import logging
import os
import time
from pathlib import Path
from typing import Any, Iterator

import soundfile as sf
import torch
from flask import Flask, Response, request
from flask_cors import CORS
from qwen_tts import Qwen3TTSModel

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
VOICES_DIR = REPO_ROOT / "voices"
DEFAULT_AUDIO_PROMPT = str(VOICES_DIR / "shadowheart.wav")

# Map common ISO-639-1 / short codes to the full language names accepted by
# Qwen3-TTS. Anything unrecognized falls back to "auto".
LANGUAGE_ALIASES = {
    "en": "english",
    "zh": "chinese",
    "cn": "chinese",
    "ja": "japanese",
    "jp": "japanese",
    "ko": "korean",
    "de": "german",
    "fr": "french",
    "ru": "russian",
    "pt": "portuguese",
    "es": "spanish",
    "it": "italian",
}
SUPPORTED_LANGUAGES = {
    "auto", "chinese", "english", "french", "german", "italian",
    "japanese", "korean", "portuguese", "russian", "spanish",
}


def normalize_language(value: str) -> str:
    if not value:
        return "auto"
    v = value.strip().lower()
    v = LANGUAGE_ALIASES.get(v, v)
    return v if v in SUPPORTED_LANGUAGES else "auto"


AUDIO_EXTENSIONS = (".wav", ".mp3", ".flac", ".ogg")


def resolve_audio_prompt(voice: str | None, audio_prompt: str | None, default: str) -> str | None:
    """Accept either ``voice=<filename>`` (resolved under voices/) or an explicit
    ``audio_prompt=<path>``. If ``voice`` is given but the exact file doesn't
    exist, try the same stem with other common audio extensions. Returns None
    if a requested voice can't be found (so the caller can 404)."""
    if audio_prompt:
        return audio_prompt
    if voice:
        candidate = Path(voice)
        if not candidate.is_absolute():
            candidate = VOICES_DIR / candidate
        if candidate.exists():
            return str(candidate)
        for ext in AUDIO_EXTENSIONS:
            alt = candidate.with_suffix(ext)
            if alt.exists():
                return str(alt)
        return None
    return default


def load_ref_text_for(audio_path: str) -> str | None:
    """Look for ``<audio_stem>.txt`` next to the reference audio and return its
    contents. Used to auto-pair transcripts with voice clips for full-quality
    cloning. Returns None if the sidecar doesn't exist."""
    sidecar = Path(audio_path).with_suffix(".txt")
    if sidecar.is_file():
        return sidecar.read_text(encoding="utf-8").strip() or None
    return None


parser = argparse.ArgumentParser(description="Qwen3-TTS audio generator")
parser.add_argument("--audio_prompt", dest="audio_prompt", default=DEFAULT_AUDIO_PROMPT,
                    help="Default reference audio path for voice cloning")
parser.add_argument("--language", dest="language", default="auto",
                    help="Synthesis language (auto, english, chinese, japanese, ...)")
parser.add_argument("--debug", dest="debug", action="store_true", default=False,
                    help="Enable debug mode for saving audio files")
parser.add_argument("--device", dest="device", default="cuda",
                    help="Device to use for inference (cuda/cpu)")
args = parser.parse_args()

app = Flask(__name__)
CORS(app)
logger = logging.getLogger(__name__)

AUDIO_PROMPT = args.audio_prompt
LANGUAGE = normalize_language(args.language)
DEBUG = args.debug
DEVICE = args.device

model = Qwen3TTSModel.from_pretrained(
    "Qwen/Qwen3-TTS-12Hz-0.6B-Base",
    device_map=DEVICE,
    dtype=torch.bfloat16,
    attn_implementation="flash_attention_2",
)


@app.route("/", methods=["GET"])
def generate_tts_audio() -> Response:
    """
    **/ (GET)** – Generate text-to-speech audio using Qwen3-TTS.

    Expected query parameters
    -------------------------
    text : str
        The text to convert to speech.
    voice : str, optional
        Filename under ``voices/`` (e.g. ``valerie.wav``).
    audio_prompt : str, optional
        Explicit path to reference audio (overrides ``voice``).
    ref_text : str, optional
        Transcript of the reference audio. When omitted, the model runs in
        x-vector-only mode (speaker embedding only, lower fidelity).
    language : str, optional
        Target synthesis language. Accepts full names or ISO codes.

    Returns
    -------
    flask.Response
        ``audio/wav`` body on success, JSON error body on failure. All
        responses carry CORS headers via flask-cors.
    """
    payload = request.args
    text = payload.get("text", "")

    if not text:
        return Response("Missing 'text' query parameter", status=400)

    audio_prompt_path = resolve_audio_prompt(
        payload.get("voice"),
        payload.get("audio_prompt"),
        AUDIO_PROMPT,
    )
    if audio_prompt_path is None:
        return Response(
            f"Voice not found under voices/: {payload.get('voice')}",
            status=404,
            mimetype="text/plain",
        )
    # Precedence: explicit query param → sidecar transcript (<stem>.txt) → none.
    ref_text = payload.get("ref_text") or load_ref_text_for(audio_prompt_path)
    language = normalize_language(payload.get("language", LANGUAGE))

    save_path: str | None = None
    if DEBUG:
        timestamp = int(time.time())
        text_hash = hashlib.md5(text.encode()).hexdigest()[:8]
        filename = f"tts_{timestamp}_{text_hash}.wav"
        save_path = os.path.join("saved_audio", filename)
        os.makedirs(os.path.dirname(save_path), exist_ok=True)

    clone_kwargs: dict[str, Any] = {
        "text": text,
        "language": language,
        "ref_audio": audio_prompt_path,
    }
    if ref_text:
        clone_kwargs["ref_text"] = ref_text
    else:
        clone_kwargs["x_vector_only_mode"] = True

    t0 = time.perf_counter()
    try:
        wavs, sample_rate = model.generate_voice_clone(**clone_kwargs)
    except Exception as exc:
        logger.exception("Qwen3-TTS generation failed: %s", exc)
        return Response(
            f"TTS generation failed: {exc}",
            status=500,
            mimetype="text/plain",
        )
    t_gen = time.perf_counter() - t0

    t0 = time.perf_counter()
    audio_data = wavs[0]
    if hasattr(audio_data, "cpu"):
        audio_data = audio_data.squeeze().cpu().numpy()
    t_tensor = time.perf_counter() - t0

    if DEBUG and save_path:
        sf.write(save_path, audio_data, sample_rate, format="WAV")

    t0 = time.perf_counter()
    wav_buffer = io.BytesIO()
    sf.write(wav_buffer, audio_data, sample_rate, format="WAV")
    wav_buffer.seek(0)
    t_encode = time.perf_counter() - t0

    audio_seconds = len(audio_data) / sample_rate if sample_rate else 0
    logger.warning(
        "TTS timing | chars=%d audio=%.2fs | gen=%.3fs tensor=%.3fs encode=%.3fs | mode=%s",
        len(text),
        audio_seconds,
        t_gen,
        t_tensor,
        t_encode,
        "full_clone" if ref_text else "x_vector_only",
    )

    def generate_audio_chunks() -> Iterator[bytes]:
        chunk_size = 1024
        while True:
            data = wav_buffer.read(chunk_size)
            if not data:
                break
            yield data

    return Response(generate_audio_chunks(), mimetype="audio/wav")


if __name__ == "__main__":
    app.run(port=5001, debug=DEBUG)
