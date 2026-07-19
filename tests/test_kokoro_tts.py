import struct

import numpy as np

from tts.kokoro_tts.streaming_audio import float_audio_to_pcm16, streaming_wav_header


def test_streaming_wav_header_describes_pcm16_audio():
    header = streaming_wav_header()

    assert len(header) == 44
    assert header[:4] == b"RIFF"
    assert header[8:12] == b"WAVE"
    assert header[12:16] == b"fmt "
    assert struct.unpack_from("<H", header, 20)[0] == 1
    assert struct.unpack_from("<H", header, 22)[0] == 1
    assert struct.unpack_from("<I", header, 24)[0] == 24_000
    assert struct.unpack_from("<H", header, 34)[0] == 16
    assert header[36:40] == b"data"


def test_float_audio_to_pcm16_clips_and_encodes_little_endian():
    encoded = float_audio_to_pcm16(
        np.array([-2.0, -1.0, 0.0, 0.5, 1.0, 2.0], dtype=np.float32)
    )

    assert np.frombuffer(encoded, dtype="<i2").tolist() == [
        -32767,
        -32767,
        0,
        16383,
        32767,
        32767,
    ]
