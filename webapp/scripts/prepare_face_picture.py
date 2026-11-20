#!/usr/bin/env python3
"""Prepare the reference picture for a projected-face visualization.

The picture is projected onto the head model as its skin. It already has
neon glyphs painted on the face, which the visualization needs to bring on
and dissolve by itself, so this script splits it into two layers:

  static/img/<face>.jpg         the picture with the glyphs painted out
  static/img/<face>-glyphs.jpg  the glyphs alone, to be added back as light

The glyphs are found inside a few hand-placed boxes as pixels that stand
out from a blurred copy of their surroundings, and are painted out by
letting the surrounding colour flow in from the edges of each patch.

The irises are painted out of the first layer in the same way. The
visualization draws them itself so that the eyes can turn, over what is
left of the painted eye: the white, the lashes and their shadow.

The boxes and the irises are marked in scripts/faces/<face>.json, next to
the picture itself. They are fractions of the picture's size, so a larger
copy of the same picture can be dropped in without changing anything:

    python scripts/prepare_face_picture.py <face> [--source <image>]

Requires Pillow and NumPy.
"""

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

SCRIPT_DIR = Path(__file__).resolve().parent
FACES_DIR = SCRIPT_DIR / "faces"
OUTPUT_DIR = SCRIPT_DIR.parent / "static" / "img"

# Both layers are written at this size, whatever the source's.
OUTPUT_SIZE = 1024

CHANNELS = ["red", "green", "blue"]

# How far the painted-out patch extends past the detected pixels, as a
# fraction of the picture's width, to take the glow around each line too.
GROW = 0.012
BACKGROUND_BLUR = 0.03


def detect_glyphs(pixels: np.ndarray, boxes: list[dict]) -> np.ndarray:
    """Return a boolean mask of the painted glyph pixels.

    Each box is (left, top, right, bottom) as fractions of the picture, with
    how far a pixel must stand out from its surroundings (0-255) to count.
    A box may name one colour channel to judge by, which keeps glyphs apart
    from highlights of another colour that cross them.
    """
    height, width, _ = pixels.shape
    image = Image.fromarray(pixels)
    blurred = np.asarray(
        image.filter(ImageFilter.GaussianBlur(BACKGROUND_BLUR * width)), dtype=np.float32
    )
    difference = pixels.astype(np.float32) - blurred
    stand_out = difference.max(axis=2)

    mask = np.zeros((height, width), dtype=bool)
    for entry in boxes:
        left, top, right, bottom = entry["box"]
        rows = slice(round(top * height), round(bottom * height))
        cols = slice(round(left * width), round(right * width))
        channel = entry.get("channel")
        measure = stand_out if channel is None else difference[..., CHANNELS.index(channel)]
        mask[rows, cols] |= measure[rows, cols] > entry["threshold"]

    grown = Image.fromarray((mask * 255).astype(np.uint8)).filter(
        ImageFilter.MaxFilter(2 * max(1, round(GROW * width)) + 1)
    )
    return np.asarray(grown) > 127


def iris_mask(height: int, width: int, irises: list[dict]) -> np.ndarray:
    """Return a boolean mask covering the irises.

    Only the part of each disc between the lids is covered, so the lash line
    above and the lid below survive.
    """
    rows, cols = np.mgrid[0:height, 0:width]
    mask = np.zeros((height, width), dtype=bool)
    for iris in irises:
        across = cols + 0.5 - iris["x"] * width
        down = rows + 0.5 - iris["y"] * height
        reach = iris["radius"] * width
        mask |= (
            (np.hypot(across, down) < reach)
            & (down > iris["top"] * reach)
            & (down < iris["bottom"] * reach)
        )
    return mask


def paint_out(pixels: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Fill the masked pixels by diffusing colour in from their edges."""
    result = pixels.astype(np.float32)
    # Start from a blurred guess so the fill converges quickly.
    source = Image.fromarray(np.clip(pixels, 0, 255).astype(np.uint8))
    guess = np.asarray(
        source.filter(ImageFilter.GaussianBlur(0.02 * pixels.shape[1])),
        dtype=np.float32,
    )
    result[mask] = guess[mask]
    for _ in range(600):
        padded = np.pad(result, ((1, 1), (1, 1), (0, 0)), mode="edge")
        average = (
            padded[:-2, 1:-1] + padded[2:, 1:-1] + padded[1:-1, :-2] + padded[1:-1, 2:]
        ) / 4
        result[mask] = average[mask]
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", maxsplit=1)[0])
    parser.add_argument("face", help="name of a file in scripts/faces, without .json")
    parser.add_argument("--source", type=Path, help="picture to use in place of the marked one")
    parser.add_argument("--output-dir", type=Path, default=OUTPUT_DIR)
    args = parser.parse_args()

    face = json.loads((FACES_DIR / f"{args.face}.json").read_text())
    source = Image.open(args.source or FACES_DIR / face["reference"]).convert("RGB")
    pixels = np.asarray(source)
    mask = detect_glyphs(pixels, face["glyphBoxes"])
    clean = paint_out(pixels, mask)
    # Whatever the painting-out removed is the glyph layer.
    glyphs = np.clip(pixels.astype(np.float32) - clean, 0, 255)
    height, width = mask.shape
    clean = paint_out(clean, iris_mask(height, width, face["irises"]))

    args.output_dir.mkdir(parents=True, exist_ok=True)
    for name, layer in ((f"{args.face}.jpg", clean), (f"{args.face}-glyphs.jpg", glyphs)):
        image = Image.fromarray(np.clip(layer, 0, 255).astype(np.uint8))
        if image.size != (OUTPUT_SIZE, OUTPUT_SIZE):
            image = image.resize((OUTPUT_SIZE, OUTPUT_SIZE), Image.Resampling.LANCZOS)
        image.save(args.output_dir / name, quality=90, optimize=True)
        print(f"Wrote {args.output_dir / name}")
    print(f"Painted out {mask.mean() * 100:.1f}% of the picture")


if __name__ == "__main__":
    main()
