import json
import shutil
import subprocess
import tempfile
import unittest
import urllib.error
from pathlib import Path

from src.elevenlabs_tts import ElevenLabsError, ElevenLabsTTS, assemble_mp3_manifest


VOICES = {"host": "voice-host", "expert1": "voice-1", "expert2": "voice-2", "expert3": "voice-3"}
MP3 = b"ID3" + b"fixture-audio"


class FakeResponse:
    headers = {"request-id": "req-fixture", "character-cost": "12"}

    def __enter__(self): return self
    def __exit__(self, *args): return False
    def read(self): return MP3


class ElevenLabsTests(unittest.TestCase):
    def plan(self):
        return {"audio_assets": [
            {"turn_id": "t01", "speaker": "host", "text": "Hello there."},
            {"turn_id": "t02", "speaker": "expert1", "text": "A quiet answer."},
        ]}

    def test_saves_individual_mp3s_and_manifest_and_sends_official_request_shape(self):
        calls = []
        def opener(req, timeout):
            calls.append((req, timeout))
            return FakeResponse()
        with tempfile.TemporaryDirectory() as temp:
            adapter = ElevenLabsTTS(VOICES, api_key="test-secret", opener=opener)
            manifest = adapter.synthesize(self.plan(), temp)
            self.assertEqual([c["turn_id"] for c in manifest["clips"]], ["t01", "t02"])
            self.assertEqual((Path(temp) / "0000-t01.mp3").read_bytes(), MP3)
            self.assertEqual(json.loads((Path(temp) / "tts_manifest.json").read_text()), manifest)
            req, timeout = calls[0]
            self.assertEqual(req.get_header("Xi-api-key"), "test-secret")
            self.assertIn("/v1/text-to-speech/voice-host?output_format=mp3_44100_128", req.full_url)
            self.assertEqual(json.loads(req.data), {"text": "Hello there.", "model_id": "eleven_multilingual_v2"})
            self.assertEqual(manifest["clips"][0]["request_id"], "req-fixture")

    def test_budget_and_per_request_limits_preflight_before_network(self):
        calls = []
        adapter = ElevenLabsTTS(VOICES, api_key="x", max_characters_per_request=5,
                                character_budget=100, opener=lambda *a, **k: calls.append(1))
        with self.assertRaisesRegex(ElevenLabsError, "per-request limit"):
            adapter.synthesize(self.plan(), tempfile.gettempdir())
        self.assertEqual(calls, [])
        adapter = ElevenLabsTTS(VOICES, api_key="x", max_characters_per_request=100,
                                character_budget=5, opener=lambda *a, **k: calls.append(1))
        with self.assertRaisesRegex(ElevenLabsError, "budget exceeded"):
            adapter.synthesize(self.plan(), tempfile.gettempdir())
        self.assertEqual(calls, [])

    def test_throttle_retries_bounded_and_transport_error_does_not_retry(self):
        attempts, waits = [], []
        def throttled(req, timeout):
            attempts.append(req)
            if len(attempts) == 1:
                raise urllib.error.HTTPError(req.full_url, 429, "throttled", {"Retry-After": "0"}, None)
            return FakeResponse()
        adapter = ElevenLabsTTS(VOICES, api_key="x", opener=throttled, sleeper=waits.append)
        audio, _ = adapter._request("voice-host", "hello")
        self.assertEqual(audio, MP3)
        self.assertEqual(len(attempts), 2)
        self.assertEqual(waits, [0.0])

        count = []
        def lost(req, timeout):
            count.append(1)
            raise TimeoutError()
        adapter = ElevenLabsTTS(VOICES, api_key="x", opener=lost)
        with self.assertRaisesRegex(ElevenLabsError, "not retried"):
            adapter._request("voice-host", "hello")
        self.assertEqual(len(count), 1)

    def test_requires_voice_map_and_valid_audio(self):
        with self.assertRaisesRegex(ElevenLabsError, "voice IDs"):
            ElevenLabsTTS({"host": "v"}, api_key="x")
        with tempfile.TemporaryDirectory() as temp:
            class Bad(FakeResponse):
                def read(self): return b"not audio"
            adapter = ElevenLabsTTS(VOICES, api_key="x", opener=lambda *a, **k: Bad())
            with self.assertRaisesRegex(ElevenLabsError, "non-MP3"):
                adapter.synthesize(self.plan(), temp)

    def test_turn_ids_must_be_safe_filename_slugs(self):
        for turn_id in ("../escape", "a/b", "x" * 65, "-starts-with-dash"):
            with self.subTest(turn_id=turn_id), tempfile.TemporaryDirectory() as temp:
                plan = {"audio_assets": [{"turn_id": turn_id, "speaker": "host", "text": "hello"}]}
                adapter = ElevenLabsTTS(VOICES, api_key="x", opener=lambda *a, **k: self.fail("network called"))
                with self.assertRaisesRegex(ElevenLabsError, "turn_id"):
                    adapter.synthesize(plan, temp)

    def test_partial_synthesis_resumes_matching_clips_and_rejects_changed_inputs(self):
        with tempfile.TemporaryDirectory() as temp:
            calls = []
            def fails_second(req, timeout):
                calls.append(req)
                if len(calls) == 2:
                    raise urllib.error.HTTPError(req.full_url, 500, "failed", {}, None)
                return FakeResponse()
            adapter = ElevenLabsTTS(VOICES, api_key="secret-never-record", opener=fails_second)
            with self.assertRaisesRegex(ElevenLabsError, "HTTP 500"):
                adapter.synthesize(self.plan(), temp)
            progress = json.loads((Path(temp) / "tts_progress.json").read_text())
            progress_text = json.dumps(progress)
            self.assertNotIn("secret-never-record", progress_text)
            self.assertEqual(list(progress["clips"]), ["t01"])

            resumed_calls = []
            resumed = ElevenLabsTTS(VOICES, api_key="another-secret",
                                    opener=lambda req, timeout: (resumed_calls.append(req) or FakeResponse()))
            manifest = resumed.synthesize(self.plan(), temp)
            self.assertEqual(len(resumed_calls), 1)
            self.assertIn("t02", [clip["turn_id"] for clip in manifest["clips"]])
            self.assertEqual((Path(temp) / "0000-t01.mp3").read_bytes(), MP3)

            changed_plan = self.plan()
            changed_plan["audio_assets"][0]["text"] = "Changed input."
            no_calls = []
            changed = ElevenLabsTTS(VOICES, api_key="x", opener=lambda *a, **k: no_calls.append(1))
            with self.assertRaisesRegex(ElevenLabsError, "does not match current input"):
                changed.synthesize(changed_plan, temp)
            self.assertEqual(no_calls, [])

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg/FFprobe required")
    def test_assembles_manifest_clips_in_order_to_playable_mp3(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for name, frequency in (("a.mp3", "440"), ("b.mp3", "660")):
                subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i",
                                f"sine=frequency={frequency}:duration=0.25", "-y", str(root / name)],
                               check=True, capture_output=True)
            manifest_path = root / "tts_manifest.json"
            manifest_path.write_text(json.dumps({"schema_version": 1, "clips": [
                {"turn_id": "first", "path": "a.mp3"}, {"turn_id": "second", "path": "b.mp3"}]}))
            output = root / "episode.mp3"
            result = assemble_mp3_manifest(manifest_path, output)
            self.assertGreater(output.stat().st_size, 0)
            self.assertEqual(result["turn_ids"], ["first", "second"])
            self.assertGreater(result["duration_seconds"], 0.4)
            probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                    "-of", "json", str(output)], check=True, capture_output=True, text=True)
            self.assertGreater(float(json.loads(probe.stdout)["format"]["duration"]), 0)


if __name__ == "__main__":
    unittest.main()
