"""Assemble reviewed episode WAV clips into a normalized MP3, fully offline."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import wave
from pathlib import Path
from typing import Any

from .validate_episode import validate_episode


class AssemblyError(Exception):
    """An actionable input or media-processing error."""


def _load_json(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise AssemblyError(f"cannot read {label} {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise AssemblyError(f"{label} must contain a JSON object")
    return value


def _turn_ids(episode: dict[str, Any]) -> list[str]:
    if episode.get("status") != "reviewed":
        raise AssemblyError("episode must have status 'reviewed'")
    turns = episode.get("turns")
    if not isinstance(turns, list) or not turns:
        raise AssemblyError("episode must contain at least one turn")
    ids: list[str] = []
    for index, turn in enumerate(turns):
        if not isinstance(turn, dict) or not isinstance(turn.get("id"), str) or not turn["id"]:
            raise AssemblyError(f"episode turn {index + 1} must have a non-empty string id")
        ids.append(turn["id"])
    if len(ids) != len(set(ids)):
        raise AssemblyError("episode turn IDs must be unique")
    return ids


def _validate_manifest(manifest: dict[str, Any], episode: dict[str, Any], manifest_path: Path,
                       expected_ids: list[str]) -> list[tuple[str, Path, int]]:
    version = manifest.get("schema_version")
    if isinstance(version, bool) or not isinstance(version, int) or version != 1:
        raise AssemblyError("manifest schema_version must be 1")
    episode_id = episode.get("episode_id")
    if not isinstance(episode_id, str) or manifest.get("episode_id") != episode_id:
        raise AssemblyError("manifest episode_id must match the episode")
    clips = manifest.get("clips")
    if not isinstance(clips, list):
        raise AssemblyError("manifest clips must be an array")
    clip_ids = [c.get("turn_id") if isinstance(c, dict) else None for c in clips]
    if clip_ids != expected_ids:
        raise AssemblyError("manifest must have exactly one clip per episode turn, in the same order")

    result: list[tuple[str, Path, int]] = []
    for index, clip in enumerate(clips):
        path_value = clip.get("path")
        pause = clip.get("pause_after_ms")
        if not isinstance(path_value, str) or not path_value.strip():
            raise AssemblyError(f"clip {expected_ids[index]} needs a non-empty path")
        if isinstance(pause, bool) or not isinstance(pause, int) or not 0 <= pause <= 5000:
            raise AssemblyError(f"clip {expected_ids[index]} pause_after_ms must be an integer from 0 to 5000")
        if index == len(clips) - 1 and pause != 0:
            raise AssemblyError("the final clip pause_after_ms must be 0")
        path = (manifest_path.parent / path_value).resolve()
        try:
            if not path.is_file() or path.stat().st_size == 0:
                raise AssemblyError(f"clip {expected_ids[index]} is missing or empty: {path}")
        except OSError as exc:
            raise AssemblyError(f"cannot access clip {expected_ids[index]} at {path}: {exc}") from exc
        result.append((expected_ids[index], path, pause))
    return result


def _run(command: list[str], label: str) -> subprocess.CompletedProcess[str]:
    try:
        completed = subprocess.run(command, check=False, capture_output=True, text=True)
    except OSError as exc:
        raise AssemblyError(f"could not run {label}: {exc}") from exc
    if completed.returncode:
        detail = completed.stderr.strip().splitlines()
        message = detail[-1] if detail else f"exit status {completed.returncode}"
        raise AssemblyError(f"{label} failed: {message}")
    return completed


def _decode_clip(source: Path, destination: Path, turn_id: str) -> None:
    _run([
        "ffmpeg", "-v", "error", "-nostdin", "-y", "-i", str(source),
        "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le",
        str(destination),
    ], f"decoding WAV clip {turn_id}")
    try:
        with wave.open(str(destination), "rb") as wav:
            if wav.getnchannels() != 1 or wav.getframerate() != 24000 or wav.getsampwidth() != 2:
                raise AssemblyError(f"normalized clip {turn_id} has an unexpected audio format")
            if wav.getnframes() <= 0:
                raise AssemblyError(f"clip {turn_id} contains no audio")
            # Force reading all frames so truncated or malformed WAV data is caught before publish.
            remaining = wav.getnframes()
            while remaining:
                block = wav.readframes(min(remaining, 24000 * 30))
                if not block:
                    raise AssemblyError(f"clip {turn_id} is truncated")
                remaining -= len(block) // 2
    except (OSError, wave.Error, EOFError) as exc:
        raise AssemblyError(f"clip {turn_id} is not a readable WAV audio file: {exc}") from exc


def assemble(episode_path: Path, manifest_path: Path, output_path: Path) -> dict[str, Any]:
    episode = _load_json(episode_path, "episode")
    manifest = _load_json(manifest_path, "manifest")
    episode_errors = validate_episode(episode)
    if episode_errors:
        raise AssemblyError("episode structure is invalid: " + "; ".join(episode_errors))
    ids = _turn_ids(episode)
    clips = _validate_manifest(manifest, episode, manifest_path.resolve(), ids)
    output_path = output_path.resolve()
    protected_paths = {episode_path.resolve(), manifest_path.resolve(), *(source for _, source, _ in clips)}
    if output_path in protected_paths:
        raise AssemblyError("output path must not overwrite the episode, manifest, or a source clip")
    if output_path.suffix.lower() != ".mp3":
        raise AssemblyError("output path must have an .mp3 suffix")
    report_path = output_path.with_name(output_path.stem + ".report.json")
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        raise AssemblyError("FFmpeg and FFprobe must be installed and available on PATH")

    try:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix=".assemble-audio-", dir=output_path.parent) as temp_name:
            temp_dir = Path(temp_name)
            normalized: list[Path] = []
            for index, (turn_id, source, _) in enumerate(clips):
                wav_path = temp_dir / f"{index:04d}.wav"
                _decode_clip(source, wav_path, turn_id)
                normalized.append(wav_path)

            pcm_path = temp_dir / "joined.wav"
            total_pause_ms = sum(pause for _, _, pause in clips)
            total_pause_frames = 0
            with wave.open(str(pcm_path), "wb") as output_wav:
                output_wav.setnchannels(1)
                output_wav.setsampwidth(2)
                output_wav.setframerate(24000)
                for index, (wav_path, (_, _, pause_ms)) in enumerate(zip(normalized, clips)):
                    with wave.open(str(wav_path), "rb") as clip_wav:
                        output_wav.writeframes(clip_wav.readframes(clip_wav.getnframes()))
                    pause_frames = (pause_ms * 24000) // 1000
                    if index < len(clips) - 1 and pause_frames:
                        output_wav.writeframes(b"\x00\x00" * pause_frames)
                        total_pause_frames += pause_frames

            temp_mp3 = temp_dir / "assembled.mp3"
            _run([
                "ffmpeg", "-v", "error", "-nostdin", "-y", "-i", str(pcm_path),
                "-codec:a", "libmp3lame", "-q:a", "2", "-id3v2_version", "3", str(temp_mp3),
            ], "MP3 encoding")
            probe = _run([
                "ffprobe", "-v", "error", "-show_entries", "format=duration",
                "-of", "json", str(temp_mp3),
            ], "MP3 duration check")
            try:
                duration = float(json.loads(probe.stdout)["format"]["duration"])
            except (KeyError, ValueError, TypeError, json.JSONDecodeError) as exc:
                raise AssemblyError("FFprobe did not return a valid MP3 duration") from exc
            if duration <= 0:
                raise AssemblyError("assembled MP3 has no measurable duration")
            report = {
                "schema_version": 1,
                "episode_id": episode["episode_id"],
                "output_file": output_path.name,
                "duration_seconds": round(duration, 3),
                "turn_ids": ids,
                "pause_total_ms": total_pause_ms,
                "sample_rate_hz": 24000,
                "channels": 1,
                "encoding": "MP3",
            }
            temp_report = temp_dir / "report.json"
            temp_report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
            # Both outputs are fully prepared before either visible file changes.
            os.replace(temp_mp3, output_path)
            os.replace(temp_report, report_path)
    except AssemblyError:
        raise
    except (OSError, wave.Error, EOFError) as exc:
        raise AssemblyError(f"audio assembly failed: {exc}") from exc
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Assemble reviewed WAV clips into an offline MP3")
    parser.add_argument("--episode", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        report = assemble(args.episode, args.manifest, args.output)
    except AssemblyError as exc:
        print(f"assembly error: {exc}", file=sys.stderr)
        return 2
    print(f"Created {args.output} ({report['duration_seconds']:.3f}s); {len(report['turn_ids'])} turns, "
          f"{report['pause_total_ms']}ms pauses.")
    print(f"Report: {args.output.with_name(args.output.stem + '.report.json')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
