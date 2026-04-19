#!/usr/bin/env python3
"""
Generate speech using Chatterbox TTS with custom voice cloning.

Usage:
    python generate.py "Your text here" --voice path/to/voice.wav
    python generate.py "Your text here" --voice path/to/voice.wav --output output.wav
    python generate.py "Your text here"  # Uses default voice
"""

import argparse
import sys
from pathlib import Path

import numpy as np
import torch
from scipy.io import wavfile
from chatterbox.tts import ChatterboxTTS


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate speech with Chatterbox TTS using optional voice cloning"
    )
    parser.add_argument(
        "text",
        type=str,
        help="Text to synthesize"
    )
    parser.add_argument(
        "-v", "--voice",
        type=str,
        default=None,
        help="Path to WAV file for voice cloning"
    )
    parser.add_argument(
        "-o", "--output",
        type=str,
        default="output.wav",
        help="Output WAV file path (default: output.wav)"
    )
    parser.add_argument(
        "-e", "--exaggeration",
        type=float,
        default=0.5,
        help="Exaggeration level 0.0-1.0 (default: 0.5, use 0.7+ for dramatic speech)"
    )
    parser.add_argument(
        "-c", "--cfg-weight",
        type=float,
        default=0.5,
        help="CFG weight 0.0-1.0 (default: 0.5, use ~0.3 for fast speakers)"
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    # Validate voice file if provided
    if args.voice:
        voice_path = Path(args.voice)
        if not voice_path.exists():
            print(f"Error: Voice file not found: {args.voice}", file=sys.stderr)
            sys.exit(1)
        if voice_path.suffix.lower() not in [".wav", ".mp3", ".flac", ".ogg"]:
            print(f"Warning: {args.voice} may not be a supported audio format", file=sys.stderr)

    # Select device
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Using device: {device}")

    # Load model
    print("Loading Chatterbox model...")
    model = ChatterboxTTS.from_pretrained(device=device)

    # Generate speech
    print(f"Generating speech: \"{args.text[:50]}{'...' if len(args.text) > 50 else ''}\"")
    if args.voice:
        print(f"Using voice from: {args.voice}")

    wav = model.generate(
        args.text,
        audio_prompt_path=args.voice,
        exaggeration=args.exaggeration,
        cfg_weight=args.cfg_weight
    )

    # Save output using scipy (avoids torchcodec compatibility issues)
    wav_numpy = wav.squeeze().cpu().numpy()
    # Convert to 16-bit PCM
    wav_int16 = np.int16(wav_numpy * 32767)
    wavfile.write(args.output, model.sr, wav_int16)
    print(f"Saved to: {args.output}")


if __name__ == "__main__":
    main()
