"""Check theme release notes without needing the Windows app toolchain."""

import json
from pathlib import Path
import re
import sys


def check(root):
    theme = (root / "assets/hotori.theme.css").read_text(encoding="utf-8-sig")
    match = re.search(r"^\s*\* @version\s+(\S+)", theme, re.MULTILINE)
    if not match:
        raise ValueError("Theme @version is missing")
    version = match.group(1)
    raw = (root / "assets/theme-changelog.json").read_bytes()
    if len(raw) > 128 * 1024:
        raise ValueError("Theme changelog exceeds 128 KB")
    catalog = json.loads(raw)
    if catalog.get("schemaVersion") != 1:
        raise ValueError("Unsupported theme changelog schema")
    versions = catalog.get("versions")
    if not isinstance(versions, dict) or not 1 <= len(versions) <= 256:
        raise ValueError("Invalid theme changelog versions")
    if version not in versions:
        raise ValueError(f"Theme {version} has no release notes in assets/theme-changelog.json")
    for key, notes in versions.items():
        if not re.fullmatch(r"\d+\.\d+\.\d+", key):
            raise ValueError(f"Invalid theme version: {key}")
        if not isinstance(notes, list) or not 1 <= len(notes) <= 12:
            raise ValueError(f"Theme {key} needs 1-12 release notes")
        for note in notes:
            for field, limit in (("title", 100), ("description", 600)):
                value = note.get(field) if isinstance(note, dict) else None
                if not isinstance(value, str) or not value.strip() or len(value.encode("utf-8")) > limit:
                    raise ValueError(f"Invalid {field} in theme {key} release notes")
    return version


if __name__ == "__main__":
    try:
        version = check(Path(__file__).resolve().parents[1])
    except (ValueError, OSError) as error:
        print(f"Theme release notes check failed: {error}", file=sys.stderr)
        sys.exit(1)
    print(f"Theme {version} has valid release notes")
