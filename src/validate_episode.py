"""Bounded, offline structural validation for episode-v1 JSON."""

from __future__ import annotations

import json
import math
import re
import sys
from datetime import date
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit


_EPISODE_ID = re.compile(r"^[a-z][a-z0-9-]*$")
_ISO_DATE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$")
_REQUIRED_SPEAKERS = {"host", "companion"}
_ALLOWED_SPEAKERS = _REQUIRED_SPEAKERS | {"companion2"}


def validate_episode(data: Any) -> list[str]:
    """Return structural validation errors; never performs factual/source review."""
    errors: list[str] = []

    def err(path: str, message: str) -> None:
        errors.append(f"{path}: {message}")

    def nonempty(value: Any, path: str) -> bool:
        if not isinstance(value, str) or not value.strip():
            err(path, "must be a non-empty string")
            return False
        return True

    def obj(value: Any, path: str) -> bool:
        if not isinstance(value, dict):
            err(path, "must be an object")
            return False
        return True

    def arr(value: Any, path: str, *, nonempty_array: bool = False) -> bool:
        if not isinstance(value, list):
            err(path, "must be an array")
            return False
        if nonempty_array and not value:
            err(path, "must contain at least one item")
        return True

    def finite_positive(value: Any, path: str) -> None:
        if (isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0
                or (isinstance(value, float) and not math.isfinite(value))):
            err(path, "must be a finite positive number")

    if not obj(data, "$episode"):
        return errors
    required = {"schema_version", "episode_id", "topic", "title", "target_minutes", "status", "speakers", "sources", "claims", "turns", "audio"}
    for key in sorted(required - data.keys()):
        err(key, "is required")
    for key in sorted(data.keys() - required):
        err(key, "is not allowed")

    version = data.get("schema_version")
    if isinstance(version, bool) or not isinstance(version, int) or version != 1:
        err("schema_version", "must be integer 1")
    episode_id = data.get("episode_id")
    if not isinstance(episode_id, str) or not _EPISODE_ID.fullmatch(episode_id):
        err("episode_id", "must match ^[a-z][a-z0-9-]*$")
    for key in ("topic", "title"):
        if key in data:
            nonempty(data[key], key)
    if "target_minutes" in data:
        finite_positive(data["target_minutes"], "target_minutes")
    if "status" in data and data["status"] not in ("draft", "reviewed"):
        err("status", "must be 'draft' or 'reviewed'")

    speaker_names: set[str] = set()
    if "speakers" in data:
        speakers = data["speakers"]
        if obj(speakers, "speakers"):
            for name in sorted(_REQUIRED_SPEAKERS - speakers.keys()):
                err(f"speakers.{name}", "is required")
            for name in sorted(speakers.keys() - _ALLOWED_SPEAKERS):
                err(f"speakers.{name}", "is not allowed")
            for name in sorted(_ALLOWED_SPEAKERS & speakers.keys()):
                spath = f"speakers.{name}"
                if obj(speakers[name], spath):
                    speaker = speakers[name]
                    if set(speaker) != {"display_name"}:
                        for k in sorted({"display_name"} - speaker.keys()): err(f"{spath}.{k}", "is required")
                        for k in sorted(speaker.keys() - {"display_name"}): err(f"{spath}.{k}", "is not allowed")
                    if "display_name" in speaker: nonempty(speaker["display_name"], f"{spath}.display_name")
                    speaker_names.add(name)

    source_ids: set[str] = set()
    if "sources" in data and arr(data["sources"], "sources"):
        for i, source in enumerate(data["sources"]):
            path = f"sources[{i}]"
            if not obj(source, path): continue
            expected = {"id", "title", "url", "accessed_on", "locator"}
            for k in sorted(expected - source.keys()): err(f"{path}.{k}", "is required")
            for k in sorted(source.keys() - expected): err(f"{path}.{k}", "is not allowed")
            for k in ("id", "title", "url", "accessed_on", "locator"):
                if k in source and nonempty(source[k], f"{path}.{k}"):
                    if k == "id":
                        if source[k] in source_ids: err(f"{path}.id", f"duplicate source id {source[k]!r}")
                        source_ids.add(source[k])
                    elif k == "url":
                        try:
                            parsed = urlsplit(source[k])
                            if parsed.scheme not in {"http", "https"} or not parsed.netloc:
                                err(f"{path}.url", "must be an absolute http or https URL")
                        except ValueError:
                            err(f"{path}.url", "must be a valid http or https URL")
                    elif k == "accessed_on":
                        if not _ISO_DATE.fullmatch(source[k]):
                            err(f"{path}.accessed_on", "must be an ISO date (YYYY-MM-DD)")
                        else:
                            try: date.fromisoformat(source[k])
                            except ValueError: err(f"{path}.accessed_on", "must be a valid calendar date")

    claim_ids: set[str] = set()
    if "claims" in data and arr(data["claims"], "claims"):
        for i, claim in enumerate(data["claims"]):
            path = f"claims[{i}]"
            if not obj(claim, path): continue
            expected = {"id", "statement", "source_ids"}
            for k in sorted(expected - claim.keys()): err(f"{path}.{k}", "is required")
            for k in sorted(claim.keys() - expected): err(f"{path}.{k}", "is not allowed")
            if "id" in claim and nonempty(claim["id"], f"{path}.id"):
                if claim["id"] in claim_ids: err(f"{path}.id", f"duplicate claim id {claim['id']!r}")
                claim_ids.add(claim["id"])
            if "statement" in claim: nonempty(claim["statement"], f"{path}.statement")
            if "source_ids" in claim and arr(claim["source_ids"], f"{path}.source_ids", nonempty_array=True):
                refs: set[str] = set()
                for j, ref in enumerate(claim["source_ids"]):
                    rpath = f"{path}.source_ids[{j}]"
                    if not nonempty(ref, rpath): continue
                    if ref in refs: err(rpath, f"duplicate reference {ref!r}")
                    refs.add(ref)
                    if ref not in source_ids: err(rpath, f"unresolved source id {ref!r}")

    turn_ids: set[str] = set()
    if "turns" in data and arr(data["turns"], "turns", nonempty_array=True):
        for i, turn in enumerate(data["turns"]):
            path = f"turns[{i}]"
            if not obj(turn, path): continue
            expected = {"id", "speaker", "text", "claim_ids", "delivery"}
            for k in sorted(expected - turn.keys()): err(f"{path}.{k}", "is required")
            for k in sorted(turn.keys() - expected): err(f"{path}.{k}", "is not allowed")
            if "id" in turn and nonempty(turn["id"], f"{path}.id"):
                if turn["id"] in turn_ids: err(f"{path}.id", f"duplicate turn id {turn['id']!r}")
                turn_ids.add(turn["id"])
            if "speaker" in turn:
                speaker = turn["speaker"]
                if not isinstance(speaker, str) or speaker not in _ALLOWED_SPEAKERS:
                    err(f"{path}.speaker", "must be 'host', 'companion', or 'companion2'")
                elif speaker not in speaker_names:
                    err(f"{path}.speaker", f"speaker {speaker!r} is not defined")
            if "text" in turn: nonempty(turn["text"], f"{path}.text")
            if "delivery" in turn and turn["delivery"] not in ("conversational", "settling"):
                err(f"{path}.delivery", "must be 'conversational' or 'settling'")
            if "claim_ids" in turn and arr(turn["claim_ids"], f"{path}.claim_ids"):
                refs: set[str] = set()
                for j, ref in enumerate(turn["claim_ids"]):
                    rpath = f"{path}.claim_ids[{j}]"
                    if not nonempty(ref, rpath): continue
                    if ref in refs: err(rpath, f"duplicate reference {ref!r}")
                    refs.add(ref)
                    if ref not in claim_ids: err(rpath, f"unresolved claim id {ref!r}")

    if "audio" in data and data["audio"] is not None:
        audio = data["audio"]
        if obj(audio, "audio"):
            expected = {"file_name", "duration_seconds"}
            for k in sorted(expected - audio.keys()): err(f"audio.{k}", "is required")
            for k in sorted(audio.keys() - expected): err(f"audio.{k}", "is not allowed")
            if "file_name" in audio: nonempty(audio["file_name"], "audio.file_name")
            if "duration_seconds" in audio: finite_positive(audio["duration_seconds"], "audio.duration_seconds")
    return errors


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 1:
        print("Usage: python -m src.validate_episode PATH.json", file=sys.stderr)
        return 2
    path = Path(args[0])
    try:
        with path.open(encoding="utf-8") as stream:
            data = json.load(stream)
    except (OSError, json.JSONDecodeError) as exc:
        print(f"{path}: {exc}", file=sys.stderr)
        return 2
    errors = validate_episode(data)
    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        return 2
    print(f"{path}: valid episode-v1 structure")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
