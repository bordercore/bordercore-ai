"""Filesystem-backed voice profiles for the Chatterbox service."""

import re
from pathlib import Path


PROFILE_NAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
SUPPORTED_AUDIO_EXTENSIONS = {".flac", ".mp3", ".ogg", ".wav"}


def validate_profile_name(name: str) -> str:
    """Return a valid profile name or raise ``ValueError``."""
    name = name.strip()
    if not PROFILE_NAME_PATTERN.fullmatch(name):
        raise ValueError(
            "Voice names must be 1-64 characters and contain only letters, numbers, hyphens, and underscores."
        )
    return name


def list_profiles(directory: Path) -> list[dict[str, int | str]]:
    """Return metadata for supported audio files in ``directory``."""
    if not directory.exists():
        return []
    return [
        {"name": path.stem, "filename": path.name, "size": path.stat().st_size}
        for path in sorted(directory.iterdir())
        if path.is_file() and path.suffix.lower() in SUPPORTED_AUDIO_EXTENSIONS
    ]


def resolve_profile(directory: Path, name: str) -> Path | None:
    """Resolve ``name`` to its audio file, if present."""
    name = validate_profile_name(name)
    matches = [
        path
        for path in directory.glob(f"{name}.*")
        if path.is_file() and path.suffix.lower() in SUPPORTED_AUDIO_EXTENSIONS
    ]
    return sorted(matches)[0] if matches else None
