"""Helpers for emitting Kokoro output as an incrementally playable WAV stream."""

import struct

import numpy as np

SAMPLE_RATE = 24_000
NUM_CHANNELS = 1
BITS_PER_SAMPLE = 16


def streaming_wav_header() -> bytes:
    """Return a PCM WAV header suitable for an HTTP stream of unknown length."""
    byte_rate = SAMPLE_RATE * NUM_CHANNELS * BITS_PER_SAMPLE // 8
    block_align = NUM_CHANNELS * BITS_PER_SAMPLE // 8
    unknown_size = 0xFFFFFFFF
    return struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        unknown_size,
        b"WAVE",
        b"fmt ",
        16,
        1,
        NUM_CHANNELS,
        SAMPLE_RATE,
        byte_rate,
        block_align,
        BITS_PER_SAMPLE,
        b"data",
        unknown_size,
    )


def float_audio_to_pcm16(audio: np.ndarray) -> bytes:
    """Convert normalized floating-point audio to little-endian PCM16."""
    clipped = np.clip(audio, -1.0, 1.0)
    return (clipped * 32767.0).astype("<i2", copy=False).tobytes()
