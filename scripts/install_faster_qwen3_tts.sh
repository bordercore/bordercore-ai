#!/usr/bin/env bash

set -euo pipefail

python_bin=${BORDERCORE_PYTHON:-"$HOME/dev/envs/bordercoreai/bin/python"}
uv pip install --python "$python_bin" --no-deps \
    "faster-qwen3-tts==0.3.2" \
    "qwentts-cpp-python==0.3.1"
