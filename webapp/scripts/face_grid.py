#!/usr/bin/env python3
"""Enlarge part of a face's reference picture under a labelled pixel grid.

A helper for marking a picture by hand: the landmarks, irises and glyph
boxes in scripts/faces/<face>.json. Enlarge one feature at a time (an eye,
the brows, the mouth) and read positions off the grid:

    python scripts/face_grid.py <face> <out.png> <left> <top> <right> <bottom>
                                [--scale 8] [--step 10] [--source <image>]

The box and the grid's labels are in pixels of the picture. A mark is that
position divided by the picture's width (x) or height (y).

Requires Pillow.
"""

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw

FACES_DIR = Path(__file__).resolve().parent / "faces"

LABEL = (255, 255, 0)
# Every other line is brighter, to make counting along the grid easier.
MAJOR_LINE = (255, 255, 255)
MINOR_LINE = (120, 120, 120)


def draw_grid(
    picture: Image.Image, box: tuple[int, int, int, int], scale: int, step: int
) -> Image.Image:
    """Return the boxed part of the picture, enlarged, with the grid on it."""
    left, top, right, bottom = box
    crop = picture.crop(box).resize(
        ((right - left) * scale, (bottom - top) * scale), Image.Resampling.LANCZOS
    )
    draw = ImageDraw.Draw(crop)

    def shade(value: int) -> tuple[int, int, int]:
        return MAJOR_LINE if value % (step * 2) == 0 else MINOR_LINE

    # The first line at or after each edge of the box.
    for x in range(-(-left // step) * step, right + 1, step):
        at = (x - left) * scale
        draw.line([(at, 0), (at, crop.height)], fill=shade(x))
        draw.text((at + 2, 2), str(x), fill=LABEL)
    for y in range(-(-top // step) * step, bottom + 1, step):
        at = (y - top) * scale
        draw.line([(0, at), (crop.width, at)], fill=shade(y))
        draw.text((2, at + 2), str(y), fill=LABEL)
    return crop


def main() -> None:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n", maxsplit=1)[0])
    parser.add_argument("face", help="name of a file in scripts/faces, without .json")
    parser.add_argument("out", type=Path, help="image to write")
    parser.add_argument("left", type=int)
    parser.add_argument("top", type=int)
    parser.add_argument("right", type=int)
    parser.add_argument("bottom", type=int)
    parser.add_argument("--scale", type=int, default=8, help="enlargement (default 8)")
    parser.add_argument("--step", type=int, default=10, help="pixels between lines (default 10)")
    parser.add_argument("--source", type=Path, help="picture to use in place of the marked one")
    args = parser.parse_args()

    face = json.loads((FACES_DIR / f"{args.face}.json").read_text())
    picture = Image.open(args.source or FACES_DIR / face["reference"]).convert("RGB")
    box = (args.left, args.top, args.right, args.bottom)
    draw_grid(picture, box, args.scale, args.step).save(args.out)
    print(f"Wrote {args.out} ({picture.width} x {picture.height} picture)")


if __name__ == "__main__":
    main()
