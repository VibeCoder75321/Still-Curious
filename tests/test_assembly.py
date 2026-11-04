import json
import math
import copy
import shutil
import subprocess
import tempfile
import unittest
import wave
from pathlib import Path

from src.assemble_audio import AssemblyError, assemble


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg/FFprobe required")
class AssemblyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.episode_path = self.root / "episode.json"
        self.manifest_path = self.root / "manifest.json"
        self.output_path = self.root / "episode.mp3"
        fixture = Path(__file__).resolve().parents[1] / "fixtures" / "wayfinding-audition.json"
        self.episode = json.loads(fixture.read_text(encoding="utf-8"))
        self.episode["episode_id"] = "tiny-test"
        self.episode["turns"] = copy.deepcopy(self.episode["turns"][:2])
        self.episode_path.write_text(json.dumps(self.episode), encoding="utf-8")
        self._make_tone(self.root / "first.wav", 1.0, 440)
        self._make_tone(self.root / "second.wav", 2.0, 660)
        self.manifest = {
            "schema_version": 1,
            "episode_id": "tiny-test",
            "clips": [
                {"turn_id": "t01", "path": "first.wav", "pause_after_ms": 350},
                {"turn_id": "t02", "path": "second.wav", "pause_after_ms": 0},
            ],
        }
        self._write_manifest()

    def tearDown(self):
        self.temp.cleanup()

    def _make_tone(self, path, duration, frequency):
        rate = 24000
        frames = bytearray()
        for index in range(int(rate * duration)):
            sample = int(8000 * math.sin(2 * math.pi * frequency * index / rate))
            frames.extend(sample.to_bytes(2, "little", signed=True))
        with wave.open(str(path), "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(rate)
            wav.writeframes(frames)

    def _write_manifest(self):
        self.manifest_path.write_text(json.dumps(self.manifest), encoding="utf-8")

    def test_assembles_playable_mp3_and_report(self):
        report = assemble(self.episode_path, self.manifest_path, self.output_path)
        self.assertTrue(self.output_path.is_file())
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(self.output_path)],
            check=True, capture_output=True, text=True,
        )
        duration = float(json.loads(probe.stdout)["format"]["duration"])
        self.assertAlmostEqual(duration, 3.35, delta=0.15)
        self.assertEqual(report["turn_ids"], ["t01", "t02"])
        self.assertEqual(report["pause_total_ms"], 350)
        saved_report = json.loads(self.output_path.with_name("episode.report.json").read_text(encoding="utf-8"))
        self.assertEqual(saved_report["duration_seconds"], report["duration_seconds"])

    def test_wrong_order_fails_without_output(self):
        self.manifest["clips"].reverse()
        self._write_manifest()
        with self.assertRaises(AssemblyError):
            assemble(self.episode_path, self.manifest_path, self.output_path)
        self.assertFalse(self.output_path.exists())

    def test_missing_clip_fails_without_damaging_existing_output(self):
        self.output_path.write_bytes(b"previous-good-output")
        self.manifest["clips"][1]["path"] = "missing.wav"
        self._write_manifest()
        with self.assertRaises(AssemblyError):
            assemble(self.episode_path, self.manifest_path, self.output_path)
        self.assertEqual(self.output_path.read_bytes(), b"previous-good-output")

    def test_unresolved_claim_reference_fails_without_replacing_output(self):
        self.output_path.write_bytes(b"previous-good-output")
        self.episode["turns"][1]["claim_ids"] = ["C-not-resolved"]
        self.episode_path.write_text(json.dumps(self.episode), encoding="utf-8")
        with self.assertRaisesRegex(AssemblyError, "unresolved claim id"):
            assemble(self.episode_path, self.manifest_path, self.output_path)
        self.assertEqual(self.output_path.read_bytes(), b"previous-good-output")

    def test_output_cannot_overwrite_manifest_or_use_non_mp3_suffix(self):
        with self.assertRaisesRegex(AssemblyError, "output path must not overwrite"):
            assemble(self.episode_path, self.manifest_path, self.manifest_path)
        with self.assertRaisesRegex(AssemblyError, "must have an .mp3 suffix"):
            assemble(self.episode_path, self.manifest_path, self.root / "episode.wav")

    def test_manifest_version_must_be_integer_not_boolean_or_float(self):
        for version in (True, 1.0):
            with self.subTest(version=version):
                self.manifest["schema_version"] = version
                self._write_manifest()
                with self.assertRaisesRegex(AssemblyError, "schema_version must be 1"):
                    assemble(self.episode_path, self.manifest_path, self.output_path)


if __name__ == "__main__":
    unittest.main()
