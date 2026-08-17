"""
Qwen3-TTS Audio Generator Web Service

Flask service that streams text-to-speech audio produced by
Qwen3-TTS-12Hz-0.6B-Base through faster-qwen3-tts and qwentts.cpp. Codec
frames are returned while each sentence is still being generated, minimizing
first-audio latency while retaining bounded per-sentence generation.

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
import math
import re
import struct
import time
from pathlib import Path
from typing import Any, Iterator

import numpy as np
from flask import Flask, Response, jsonify, request
from flask_cors import CORS
from faster_qwen3_tts import FasterQwen3TTS

try:
    from capabilities import build_tts_capabilities
    from inference_worker import InferenceWorker
except ModuleNotFoundError:  # Imported as tts.qwen3_tts from the repository root.
    from tts.capabilities import build_tts_capabilities
    from tts.inference_worker import InferenceWorker

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
parser.add_argument("--quant", dest="quant", default="Q8_0",
                    help="GGUF quantization used by qwentts.cpp (default: Q8_0)")
parser.add_argument("--streaming-chunk-size", dest="streaming_chunk_size", type=int, default=8,
                    help="Codec frames emitted per streaming chunk (default: 8)")
args = parser.parse_args()

app = Flask(__name__)
CORS(app)
logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

AUDIO_PROMPT = args.audio_prompt
LANGUAGE = normalize_language(args.language)
DEBUG = args.debug
DEVICE = args.device
QUANT = args.quant
STREAMING_CHUNK_SIZE = max(1, args.streaming_chunk_size)

model = FasterQwen3TTS.from_pretrained(
    "Qwen/Qwen3-TTS-12Hz-0.6B-Base",
    backend="ggml",
    quant=QUANT,
)

# All synthesis runs here rather than on the per-request threads Flask's server
# creates, whose per-thread allocator state is never reclaimed. Also serializes
# access to the shared model, so two clients cannot drive it concurrently.
inference = InferenceWorker(name="qwen3-inference")


def available_voices() -> list[str]:
    """Return extension-free voice names accepted by resolve_audio_prompt()."""
    return sorted(
        {
            path.stem
            for path in VOICES_DIR.iterdir()
            if path.is_file() and path.suffix.lower() in AUDIO_EXTENSIONS
        }
    ) if VOICES_DIR.is_dir() else []


@app.route("/capabilities", methods=["GET"])
def get_capabilities() -> Response:
    """Report the versioned Qwen3-TTS feature and voice inventory."""
    voices = available_voices()
    default_candidate = Path(AUDIO_PROMPT).stem if AUDIO_PROMPT else None
    default_voice = default_candidate if default_candidate in voices else None
    return jsonify(
        build_tts_capabilities(
            engine=f"qwen3-tts-ggml-{QUANT.lower()}",
            sample_rate=24000,
            voices=voices,
            default_voice=default_voice,
            supports_speed=False,
            supports_cloning=True,
        )
    )


@app.route("/", methods=["GET"])
def generate_tts_audio() -> Response:
    """
    **/ (GET)** – Generate text-to-speech audio using Qwen3-TTS.

    The text is split into sentences and synthesized sequentially. Each
    sentence yields codec-sized PCM chunks before the complete sentence is
    ready, and all chunks are appended to one streaming-WAV response.

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
        "chunk_size": STREAMING_CHUNK_SIZE,
        "non_streaming_mode": True,
    }
    if ref_text:
        base_kwargs["ref_text"] = ref_text
    else:
        base_kwargs["xvec_only"] = True

    sentences = split_sentences(text)
    mode = "full_clone" if ref_text else "x_vector_only"
    req_start = time.perf_counter()

    def max_tokens_for(sentence: str) -> int:
        """Bound runaway speech while leaving conversational text headroom."""
        words = len(re.findall(r"\w+", sentence, flags=re.UNICODE))
        characters = len(re.sub(r"\s+", "", sentence))
        estimated_seconds = max(words / 2.5, characters / 15) + 1
        estimated = math.ceil(estimated_seconds * 12.5 * 1.5)
        aligned = math.ceil(estimated / STREAMING_CHUNK_SIZE) * STREAMING_CHUNK_SIZE
        return min(512, max(64, aligned))

    def sentence_chunks(sentence: str) -> Iterator[tuple[np.ndarray, int]]:
        generator = model.generate_voice_clone_streaming(
            text=sentence,
            max_new_tokens=max_tokens_for(sentence),
            **base_kwargs,
        )
        for chunk, sample_rate, _timing in generator:
            audio = _audio_to_numpy(chunk)
            if audio.size:
                yield audio, int(sample_rate)

    def synthesize() -> Iterator[tuple[np.ndarray, int]]:
        """Yield every sentence's audio chunks in order.

        Runs on the inference worker thread, so model inference never touches
        the per-request threads Flask's server creates.
        """
        for index, sentence in enumerate(sentences, start=1):
            t_sent = time.perf_counter()
            generated_audio = 0.0
            for audio, chunk_sample_rate in sentence_chunks(sentence):
                generated_audio += len(audio) / chunk_sample_rate
                yield audio, chunk_sample_rate
            logger.warning(
                "TTS sentence %d/%d | chars=%d gen=%.3fs audio=%.2fs",
                index, len(sentences), len(sentence),
                time.perf_counter() - t_sent, generated_audio,
            )

    chunks = inference.stream(synthesize)

    # Pull the first chunk before returning the response so startup and prompt
    # errors remain ordinary HTTP 500 responses rather than truncated WAVs.
    t0 = time.perf_counter()
    try:
        first_audio, sample_rate = next(chunks)
    except StopIteration:
        chunks.close()
        return Response("TTS generation produced no audio", status=500, mimetype="text/plain")
    except Exception as exc:
        chunks.close()
        logger.exception("Qwen3-TTS first-chunk generation failed: %s", exc)
        return Response(
            f"TTS generation failed: {exc}",
            status=500,
            mimetype="text/plain",
        )
    t_first = time.perf_counter() - t0
    logger.warning(
        "TTS stream start | sentences=%d chars=%d mode=%s | "
        "first_chunk=%.3fs chunk_audio=%.2fs sr=%d",
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
        try:
            for audio, chunk_sample_rate in chunks:
                if chunk_sample_rate != sample_rate:
                    logger.error("Qwen3-TTS sample rate changed within a response")
                    return
                total_audio += len(audio) / sample_rate
                yield to_pcm16_bytes(audio)
        except Exception as exc:
            # Can't signal an error after the header is sent; log and close.
            logger.exception("Qwen3-TTS generation failed mid-stream: %s", exc)
            return
        finally:
            # A client that disconnects mid-response abandons this generator;
            # close explicitly so the worker is released now, not at collection.
            chunks.close()
        logger.warning(
            "TTS stream done | sentences=%d total_audio=%.2fs wall=%.3fs",
            len(sentences), total_audio, time.perf_counter() - req_start,
        )

    return Response(stream(), mimetype="audio/wav")


if __name__ == "__main__":
    app.run(port=5001, debug=DEBUG)
