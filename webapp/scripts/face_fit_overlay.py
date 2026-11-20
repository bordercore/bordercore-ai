#!/usr/bin/env python3
"""Draw a head fit over the reference picture it was fitted to.

A helper for judging the marks in scripts/faces/<face>.json by eye. Bake
with --debug to record the fit, then draw it:

    node scripts/bake-face.mjs <face> --out <file.glb> --debug <fit.json>
    python scripts/face_fit_overlay.py <face> <fit.json> <out.png>
                                       [--source <image>]

Green rings are the marks. Red dots are where the fitted model puts the
same landmarks, and a yellow line joins each pair. The faint mesh is the
part of the head the picture shows.

Requires Pillow.
"""

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw

FACES_DIR = Path(__file__).resolve().parent / "faces"

# The overlay is drawn at this size, whatever the picture's.
OUTPUT_SIZE = 1024

MESH = (255, 255, 255, 46)
MARKED = (0, 255, 0, 255)
FITTED = (255, 0, 0, 255)
OFFSET = (255, 255, 0, 255)


def draw_fit(picture: Image.Image, fit: dict) -> Image.Image:
    """Return the picture with the fit drawn over it.

    `fit` is what bake-face.mjs writes with --debug: `edges` as lists of
    x, y, x, y and `landmarks` with `marked` and `fitted` positions, all as
    fractions of the picture.
    """
    size = OUTPUT_SIZE
    base = picture.convert("RGBA").resize((size, size), Image.Resampling.LANCZOS)
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)

    for x0, y0, x1, y1 in fit["edges"]:
        draw.line([(x0 * size, y0 * size), (x1 * size, y1 * size)], fill=MESH)
    for landmark in fit["landmarks"]:
        marked_x, marked_y = (value * size for value in landmark["marked"])
        fitted_x, fitted_y = (value * size for value in landmark["fitted"])
        draw.line([(marked_x, marked_y), (fitted_x, fitted_y)], fill=OFFSET, width=2)
        draw.ellipse(
            [marked_x - 4, marked_y - 4, marked_x + 4, marked_y + 4], outline=MARKED, width=2
        )
        draw.ellipse([fitted_x - 3, fitted_y - 3, fitted_x + 3, fitted_y + 3], fill=FITTED)
    return Image.alpha_composite(base, layer).convert("RGB")


def main() -> None:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n", maxsplit=1)[0])
    parser.add_argument("face", help="name of a file in scripts/faces, without .json")
    parser.add_argument("fit", type=Path, help="file written by bake-face.mjs --debug")
    parser.add_argument("out", type=Path, help="image to write")
    parser.add_argument("--source", type=Path, help="picture to use in place of the marked one")
    args = parser.parse_args()

    face = json.loads((FACES_DIR / f"{args.face}.json").read_text())
    picture = Image.open(args.source or FACES_DIR / face["reference"])
    draw_fit(picture, json.loads(args.fit.read_text())).save(args.out)
    print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
