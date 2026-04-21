"""
Qwen3-TTS Audio Generator Web Service

Flask service that streams text-to-speech audio produced by
Qwen3-TTS-12Hz-0.6B-Base. Long inputs are split by sentence and generated one
at a time; the first chunk returns as soon as the first sentence is ready,
and subsequent chunks are appended to the same WAV stream while later
sentences generate. This collapses first-audio latency from "total
generation time" to "first-sentence generation time" — see ``LATENCY.md`` for
the profile.

Qwen3-TTS-Base requires reference audio to clone a voice. A matching
transcript (``ref_text``) yields the best quality; when omitted the server
looks for a ``<stem>.txt`` sidecar next to the reference audio, and falls
back to ``x_vector_only_mode=True`` (speaker embedding only, lower fidelity)
if that's also missing.

Command line arguments:
    --audio_prompt: Default reference audio path (default: voices/shadowheart.wav)
    --language: Synthesis language (default: auto)
    --debug: Enable Flask debug mode
    --device: cuda/cpu selection (default: cuda)

Usage:
    python -m qwen3_tts --device cuda
    python -m qwen3_tts --audio_prompt voices/shadowheart.wav
"""

import argparse
import logging
import re
import struct
import time
from pathlib import Path
from typing import Any, Iterator

import numpy as np
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


_SENT_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")


def split_sentences(text: str) -> list[str]:
    """Split ``text`` into sentence-ish chunks suitable for per-chunk generation.

    Simple heuristic: break on whitespace that follows ``.``, ``!``, or ``?``.
    Abbreviations like ``Mr.`` will cause mid-sentence splits, but the model
    handles short fragments fine — the only user-visible effect is a slightly
    different prosodic contour between chunks. Preserves the original text if
    there are no sentence-ending marks.
    """
    parts = [s.strip() for s in _SENT_SPLIT_RE.split(text.strip()) if s.strip()]
    return parts or [text.strip()]


def streaming_wav_header(sample_rate: int,
                         num_channels: int = 1,
                         bits_per_sample: int = 16) -> bytes:
    """Build a WAV header whose RIFF and data chunk sizes are the 0xFFFFFFFF
    sentinel, signaling "unknown/streaming length" to players.

    Browsers' HTMLAudioElement accepts this and plays progressively as bytes
    arrive. The duration displayed by UI players is garbage (~6 hours) until
    the stream ends, but for fire-and-forget playback that's irrelevant.
    """
    byte_rate = sample_rate * num_channels * bits_per_sample // 8
    block_align = num_channels * bits_per_sample // 8
    sentinel = 0xFFFFFFFF
    return (
        b"RIFF" + struct.pack("<I", sentinel)
        + b"WAVE"
        + b"fmt " + struct.pack("<I", 16)
        + struct.pack(
            "<HHIIHH",
            1,  # PCM
            num_channels,
            sample_rate,
            byte_rate,
            block_align,
            bits_per_sample,
        )
        + b"data" + struct.pack("<I", sentinel)
    )


def to_pcm16_bytes(audio: np.ndarray) -> bytes:
    """Convert a float waveform in [-1, 1] to little-endian 16-bit PCM bytes."""
    clipped = np.clip(audio, -1.0, 1.0)
    return (clipped * 32767.0).astype("<i2").tobytes()


def _audio_to_numpy(wav: Any) -> np.ndarray:
    """Normalize whatever ``generate_voice_clone`` returns for one clip into a
    1-D float32 numpy array on CPU."""
    if hasattr(wav, "cpu"):
        wav = wav.squeeze().cpu().numpy()
    return np.asarray(wav, dtype=np.float32).reshape(-1)


parser = argparse.ArgumentParser(description="Qwen3-TTS audio generator")
parser.add_argument("--audio_prompt", dest="audio_prompt", default=DEFAULT_AUDIO_PROMPT,
                    help="Default reference audio path for voice cloning")
parser.add_argument("--language", dest="language", default="auto",
                    help="Synthesis language (auto, english, chinese, japanese, ...)")
parser.add_argument("--debug", dest="debug", action="store_true", default=False,
                    help="Enable Flask debug mode")
parser.add_argument("--device", dest="device", default="cuda",
                    help="Device to use for inference (cuda/cpu)")
args = parser.parse_args()

app = Flask(__name__)
CORS(app)
logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

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

    The text is split into sentences and each sentence is synthesized
    sequentially. The first sentence is generated synchronously (so
    generation errors produce a clean 500 with CORS headers), then subsequent
    sentences are streamed as raw PCM frames appended to a single
    streaming-WAV body. The browser's ``<audio>`` element plays the stream
    progressively, so first-audio latency drops from "total generation time"
    to "first-sentence generation time".

    Expected query parameters
    -------------------------
    text : str
        The text to convert to speech.
    voice : str, optional
        Filename under ``voices/`` (e.g. ``valerie.wav``).
    audio_prompt : str, optional
        Explicit path to reference audio (overrides ``voice``).
    ref_text : str, optional
        Transcript of the reference audio. When omitted, the sidecar
        ``<stem>.txt`` next to the reference audio is used. When that's also
        missing, falls back to ``x_vector_only_mode=True`` (lower fidelity).
    language : str, optional
        Target synthesis language. Accepts full names or ISO codes.

    Returns
    -------
    flask.Response
        ``audio/wav`` streaming body on success, plain-text error body on
        failure. All responses carry CORS headers via flask-cors.
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

    base_kwargs: dict[str, Any] = {
        "language": language,
        "ref_audio": audio_prompt_path,
    }
    if ref_text:
        base_kwargs["ref_text"] = ref_text
    else:
        base_kwargs["x_vector_only_mode"] = True

    sentences = split_sentences(text)
    mode = "full_clone" if ref_text else "x_vector_only"
    req_start = time.perf_counter()

    # Generate the first sentence synchronously so that a generation failure
    # produces a proper 500 Response (with CORS headers from flask-cors)
    # instead of truncating an already-streaming audio body.
    t0 = time.perf_counter()
    try:
        first_wavs, sample_rate = model.generate_voice_clone(
            text=sentences[0], **base_kwargs
        )
    except Exception as exc:
        logger.exception("Qwen3-TTS first-sentence generation failed: %s", exc)
        return Response(
            f"TTS generation failed: {exc}",
            status=500,
            mimetype="text/plain",
        )
    first_audio = _audio_to_numpy(first_wavs[0])
    t_first = time.perf_counter() - t0
    logger.warning(
        "TTS stream start | sentences=%d chars=%d mode=%s | "
        "first_gen=%.3fs first_audio=%.2fs sr=%d",
        len(sentences),
        len(text),
        mode,
        t_first,
        len(first_audio) / sample_rate if sample_rate else 0,
        sample_rate,
    )

    def stream() -> Iterator[bytes]:
        yield streaming_wav_header(sample_rate)
        yield to_pcm16_bytes(first_audio)
        total_audio = len(first_audio) / sample_rate
        for i, sent in enumerate(sentences[1:], start=2):
            t_sent = time.perf_counter()
            try:
                wavs, _ = model.generate_voice_clone(text=sent, **base_kwargs)
            except Exception as exc:
                # Can't signal an error after the header is sent; log and close.
                logger.exception(
                    "Qwen3-TTS sentence %d/%d failed mid-stream: %s",
                    i, len(sentences), exc,
                )
                return
            audio = _audio_to_numpy(wavs[0])
            dt = time.perf_counter() - t_sent
            total_audio += len(audio) / sample_rate
            logger.warning(
                "TTS stream chunk %d/%d | chars=%d gen=%.3fs audio=%.2fs",
                i, len(sentences), len(sent), dt, len(audio) / sample_rate,
            )
            yield to_pcm16_bytes(audio)
        logger.warning(
            "TTS stream done | sentences=%d total_audio=%.2fs wall=%.3fs",
            len(sentences), total_audio, time.perf_counter() - req_start,
        )

    return Response(stream(), mimetype="audio/wav")


if __name__ == "__main__":
    app.run(port=5001, debug=DEBUG)
