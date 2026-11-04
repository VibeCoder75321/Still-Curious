"""Server-side ElevenLabs TTS adapter for reviewed speech plans.

No requests occur at import time. The API key is read at client construction
and is never included in errors or manifests.
"""
from __future__ import annotations

import json
import hashlib
import os
import re
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable, Mapping


class ElevenLabsError(RuntimeError):
    """A safe, actionable TTS integration error."""


SPEAKERS = ("host", "expert1", "expert2", "expert3")
_TURN_SLUG = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")


def assemble_mp3_manifest(manifest_path: str | Path, output_path: str | Path, *,
                          runner: Callable[..., Any] = subprocess.run) -> dict[str, Any]:
    """Concatenate manifest clips in order and verify the resulting MP3."""
    manifest_path, output_path = Path(manifest_path).resolve(), Path(output_path).resolve()
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ElevenLabsError(f"cannot read TTS manifest ({type(exc).__name__})") from None
    clips = manifest.get("clips") if isinstance(manifest, dict) else None
    if not isinstance(manifest, dict) or manifest.get("schema_version") != 1 or not isinstance(clips, list) or not clips:
        raise ElevenLabsError("TTS manifest must have schema_version 1 and a non-empty clips array")
    sources = []
    for index, clip in enumerate(clips):
        if not isinstance(clip, dict) or not isinstance(clip.get("path"), str) or not isinstance(clip.get("turn_id"), str) or not _TURN_SLUG.fullmatch(clip["turn_id"]):
            raise ElevenLabsError(f"manifest clip {index + 1} has invalid turn_id or path")
        source = (manifest_path.parent / clip["path"]).resolve()
        if source.parent != manifest_path.parent or source == output_path:
            raise ElevenLabsError(f"manifest clip {clip['turn_id']} path must be a local file beside the manifest")
        if not source.is_file() or source.stat().st_size == 0:
            raise ElevenLabsError(f"manifest clip {clip['turn_id']} is missing or empty")
        sources.append(source)
    if output_path in sources:
        raise ElevenLabsError("output path must not overwrite a source clip")
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        raise ElevenLabsError("FFmpeg and FFprobe must be installed and available on PATH")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with tempfile.TemporaryDirectory(prefix=".tts-assemble-", dir=output_path.parent) as work:
            workdir = Path(work)
            concat_file = workdir / "clips.txt"
            # Absolute paths are single-quoted per FFmpeg concat demuxer syntax.
            lines = ["file '" + str(path).replace("'", "'\\''") + "'" for path in sources]
            concat_file.write_text("\n".join(lines) + "\n", encoding="utf-8")
            temp_output = workdir / "assembled.mp3"
            run = runner(["ffmpeg", "-v", "error", "-nostdin", "-y", "-f", "concat", "-safe", "0",
                          "-i", str(concat_file), "-c:a", "libmp3lame", "-q:a", "2", str(temp_output)],
                         check=False, capture_output=True, text=True)
            if run.returncode:
                raise ElevenLabsError("FFmpeg MP3 assembly failed")
            if not temp_output.is_file() or temp_output.stat().st_size == 0:
                raise ElevenLabsError("FFmpeg produced an empty MP3")
            probe = runner(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                            "-of", "json", str(temp_output)], check=False,
                           capture_output=True, text=True)
            if probe.returncode:
                raise ElevenLabsError("FFprobe could not read assembled MP3")
            try:
                duration = float(json.loads(probe.stdout)["format"]["duration"])
            except (KeyError, ValueError, TypeError, json.JSONDecodeError):
                raise ElevenLabsError("FFprobe returned no valid MP3 duration") from None
            if duration <= 0:
                raise ElevenLabsError("assembled MP3 has no measurable duration")
            os.replace(temp_output, output_path)
    except ElevenLabsError:
        raise
    except OSError as exc:
        raise ElevenLabsError(f"MP3 assembly failed ({type(exc).__name__})") from None
    return {"output_file": output_path.name, "duration_seconds": round(duration, 3),
            "clip_count": len(sources), "turn_ids": [clip["turn_id"] for clip in clips], "encoding": "MP3"}


class ElevenLabsTTS:
    def __init__(self, voice_ids: Mapping[str, str], *, api_key: str | None = None,
                 max_characters_per_request: int = 5000,
                 character_budget: int = 100_000, model_id: str = "eleven_multilingual_v2",
                 output_format: str = "mp3_44100_128", max_retries: int = 2,
                 timeout: int = 120, opener: Callable[..., Any] = urllib.request.urlopen,
                 sleeper: Callable[[float], None] = time.sleep):
        self.api_key = api_key if api_key is not None else os.environ.get("ELEVENLABS_API_KEY")
        if not self.api_key:
            raise ElevenLabsError("ELEVENLABS_API_KEY is required for live synthesis")
        if max_characters_per_request < 1 or character_budget < 0 or max_retries < 0:
            raise ValueError("request limit and budget must be non-negative; request limit must be positive")
        missing = [speaker for speaker in SPEAKERS if not isinstance(voice_ids.get(speaker), str) or not voice_ids[speaker].strip()]
        if missing:
            raise ElevenLabsError("voice IDs are required for: " + ", ".join(missing))
        self.voice_ids = dict(voice_ids)
        self.max_chars = max_characters_per_request
        self.budget = character_budget
        self.model_id = model_id
        self.output_format = output_format
        self.max_retries = max_retries
        self.timeout = timeout
        self.opener = opener
        self.sleeper = sleeper

    def _request(self, voice_id: str, text: str) -> tuple[bytes, dict[str, Any]]:
        query = urllib.parse.urlencode({"output_format": self.output_format})
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{urllib.parse.quote(voice_id, safe='')}?{query}"
        body = json.dumps({"text": text, "model_id": self.model_id}).encode("utf-8")
        req = urllib.request.Request(url, data=body, headers={
            "xi-api-key": self.api_key, "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        }, method="POST")
        attempt = 0
        while True:
            try:
                with self.opener(req, timeout=self.timeout) as response:
                    audio = response.read()
                    headers = getattr(response, "headers", {})
                    meta = {"request_id": headers.get("request-id"),
                            "character_cost": headers.get("character-cost")}
                    return audio, meta
            except urllib.error.HTTPError as exc:
                # Retry explicit throttling only. Ambiguous transport/server
                # failures are not retried because POST has no idempotency key.
                if exc.code == 429 and attempt < self.max_retries:
                    delay = exc.headers.get("Retry-After", "1") if exc.headers else "1"
                    try:
                        self.sleeper(min(max(float(delay), 0), 30))
                    except ValueError:
                        self.sleeper(1)
                    attempt += 1
                    continue
                raise ElevenLabsError(f"ElevenLabs HTTP {exc.code}; request was not retried") from None
            except (urllib.error.URLError, TimeoutError, OSError) as exc:
                raise ElevenLabsError(f"ElevenLabs connection failed ({type(exc).__name__}); request was not retried") from None

    def synthesize(self, speech_plan: Mapping[str, Any], output_dir: str | Path) -> dict[str, Any]:
        assets = speech_plan.get("audio_assets")
        if not isinstance(assets, list) or not assets:
            raise ElevenLabsError("speech_plan.audio_assets must be a non-empty array")
        total = 0
        normalized = []
        seen = set()
        for index, asset in enumerate(assets):
            if not isinstance(asset, dict):
                raise ElevenLabsError(f"audio asset {index + 1} must be an object")
            speaker, text, turn_id = asset.get("speaker"), asset.get("text"), asset.get("turn_id")
            if speaker not in SPEAKERS or not isinstance(text, str) or not text.strip() or not isinstance(turn_id, str) or not _TURN_SLUG.fullmatch(turn_id):
                raise ElevenLabsError(f"audio asset {index + 1} needs a supported speaker, turn_id, and non-empty text")
            if turn_id in seen:
                raise ElevenLabsError(f"duplicate turn_id: {turn_id}")
            seen.add(turn_id)
            count = len(text)
            if count > self.max_chars:
                raise ElevenLabsError(f"turn {turn_id} has {count} characters; per-request limit is {self.max_chars}")
            total += count
            normalized.append((turn_id, speaker, text, count))
        if total > self.budget:
            raise ElevenLabsError(f"character budget exceeded: plan has {total}, budget is {self.budget}")

        dest = Path(output_dir)
        dest.mkdir(parents=True, exist_ok=True)
        progress_path = dest / "tts_progress.json"
        if progress_path.exists():
            try:
                progress = json.loads(progress_path.read_text(encoding="utf-8"))
            except (OSError, UnicodeError, json.JSONDecodeError):
                raise ElevenLabsError("cannot read TTS progress record") from None
            if not isinstance(progress, dict) or progress.get("schema_version") != 1 or not isinstance(progress.get("clips"), dict):
                raise ElevenLabsError("TTS progress record is invalid")
            completed = progress["clips"]
        else:
            completed = {}
        expected = {}
        for index, (turn_id, speaker, text, count) in enumerate(normalized):
            voice_id = self.voice_ids[speaker]
            fingerprint = hashlib.sha256(json.dumps(
                {"text": text, "speaker": speaker, "voice_id": voice_id,
                 "model_id": self.model_id, "output_format": self.output_format},
                sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest()
            expected[turn_id] = (fingerprint, f"{index:04d}-{turn_id}.mp3")
        for turn_id, record in completed.items():
            if turn_id not in expected or not isinstance(record, dict) or record.get("fingerprint") != expected[turn_id][0] or record.get("path") != expected[turn_id][1]:
                raise ElevenLabsError(f"saved progress does not match current input for turn {turn_id}")
            clip_path = dest / record["path"]
            if not clip_path.is_file() or not _is_mp3(clip_path.read_bytes()):
                raise ElevenLabsError(f"saved progress clip is missing or invalid for turn {turn_id}")

        clips = []
        for turn_id, speaker, text, count in normalized:
            fingerprint, filename = expected[turn_id]
            if turn_id in completed:
                saved = completed[turn_id]
                clips.append({"turn_id": turn_id, "speaker": speaker, "path": filename,
                              "characters": count, **saved.get("metadata", {})})
                continue
            path = dest / filename
            if path.exists():
                raise ElevenLabsError(f"clip exists without matching progress record for turn {turn_id}")
            audio, meta = self._request(self.voice_ids[speaker], text)
            if not _is_mp3(audio):
                raise ElevenLabsError(f"turn {turn_id} returned an empty or non-MP3 response")
            temp = path.with_suffix(".mp3.tmp")
            try:
                temp.write_bytes(audio)
                temp.replace(path)
            except OSError as exc:
                temp.unlink(missing_ok=True)
                raise ElevenLabsError(f"could not save turn {turn_id} audio ({type(exc).__name__})") from None
            completed[turn_id] = {"fingerprint": fingerprint, "path": filename, "metadata": meta}
            _atomic_json(progress_path, {"schema_version": 1, "clips": completed})
            clips.append({"turn_id": turn_id, "speaker": speaker, "path": filename,
                          "characters": count, **meta})
        manifest = {"schema_version": 1, "clips": clips, "total_characters": total,
                    "model_id": self.model_id, "output_format": self.output_format}
        manifest_path = dest / "tts_manifest.json"
        _atomic_json(manifest_path, manifest)
        return manifest


def _is_mp3(audio: bytes) -> bool:
    return bool(audio) and (audio.startswith(b"ID3") or
                            (len(audio) > 1 and audio[0] == 0xFF and audio[1] & 0xE0 == 0xE0))


def _atomic_json(path: Path, value: dict[str, Any]) -> None:
    temp = path.with_suffix(path.suffix + ".tmp")
    try:
        temp.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        temp.replace(path)
    except OSError as exc:
        temp.unlink(missing_ok=True)
        raise ElevenLabsError(f"could not save TTS progress ({type(exc).__name__})") from None
