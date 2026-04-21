#!/usr/bin/env python3
"""
Transcribe voice clips to sidecar .txt files using Whisper.

Each input audio file writes a ``<stem>.txt`` next to it containing the
transcript. These sidecars are consumed by ``tts/qwen3_tts`` (and any future
engine that does full-quality voice cloning) as the ``ref_text`` paired with
the audio reference. Existing .txt files are left alone unless ``--force``.

Usage:
    python scripts/transcribe_voice.py voices/shadowheart.wav
    python scripts/transcribe_voice.py voices/*.wav voices/*.mp3
    python scripts/transcribe_voice.py --force voices/valerie.mp3
    python scripts/transcribe_voice.py --model openai/whisper-large-v3 voices/foo.wav
"""

import argparse
import sys
from pathlib import Path
from typing import Any


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Transcribe voice clips to <stem>.txt sidecars via Whisper.",
    )
    parser.add_argument("audio", nargs="+", type=Path,
                        help="Audio file(s) to transcribe")
    parser.add_argument("--model", default="openai/whisper-large-v3",
                        help="HuggingFace model id (default: openai/whisper-large-v3)")
    parser.add_argument("--device", default="cuda:0",
                        help="Inference device (default: cuda:0; use 'cpu' without a GPU)")
    parser.add_argument("--force", action="store_true",
                        help="Overwrite existing .txt sidecars")
    args = parser.parse_args()

    missing = [p for p in args.audio if not p.is_file()]
    if missing:
        for p in missing:
            print(f"error: not a file: {p}", file=sys.stderr)
        return 1

    todo: list[Path] = []
    for p in args.audio:
        sidecar = p.with_suffix(".txt")
        if sidecar.exists() and not args.force:
            print(f"skip: {sidecar} exists (use --force to overwrite)")
            continue
        todo.append(p)

    if not todo:
        return 0

    # Lazy import so --help, skip-only runs, and argparse errors don't pay the
    # cost of loading transformers / torch.
    from transformers import pipeline

    pipe = pipeline(
        "automatic-speech-recognition",
        model=args.model,
        device=args.device,
        chunk_length_s=30,
        return_timestamps=False,
    )

    for p in todo:
        # transformers pipeline's return type is overloaded (dict for a single
        # input, list of dict for batched) and mypy picks the list variant;
        # widen to Any so indexing by string doesn't trip the check.
        result: Any = pipe(str(p))
        text = str(result["text"]).strip()
        sidecar = p.with_suffix(".txt")
        sidecar.write_text(text + "\n", encoding="utf-8")
        preview = text if len(text) <= 120 else text[:120] + "…"
        print(f"{p.name} → {sidecar.name} ({len(text)} chars)")
        print(f"  {preview}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
