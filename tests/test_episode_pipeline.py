import tempfile
import unittest
import re
from pathlib import Path

from src.episode_pipeline import EpisodePipeline, PipelineError


class FakeClient:
    model = "fake-model"
    def __init__(self): self.calls = []
    def generate(self, prompt, *, research=False, max_output_tokens=0):
        self.calls.append((prompt, research))
        if "Create a compact" in prompt:
            minutes = int(re.search(r"for (\d+) minutes", prompt).group(1))
            result = {"title": "Sleep", "segments": [{"id": "open", "title": "Open", "duration_minutes": minutes}]}
        elif "Build a concise" in prompt:
            result = {"sources": [{"id": "s1", "title": "Study", "url": "https://example.org"}],
                      "findings": [{"id": "c1", "source_ids": ["s1"], "statement": "A supported finding."}]}
        elif "Audit this draft" in prompt:
            result = {"findings": [], "unresolved_questions": [], "approved_claims": []}
        elif "Convert the reviewed" in prompt:
            result = {"assets": []}
        else:
            minutes = int(re.search(r"Target (\d+) minutes", prompt).group(1))
            result = {"turns": [{"id": "t1", "speaker": "host", "text": "word " * (minutes * 130),
                                  "claim_ids": ["c1"], "delivery": "conversational"}],
                      "section_summary": "Next section starts here."}
        return result, {"response_id": f"r{len(self.calls)}", "usage": {"total_tokens": 20}}


class PipelineTests(unittest.TestCase):
    def test_length_restrictions_and_ordering(self):
        with self.assertRaises(ValueError): EpisodePipeline.new_state("x", 20)
        with tempfile.TemporaryDirectory() as d:
            pipe = EpisodePipeline(FakeClient(), cache_dir=d)
            state = pipe.new_state("Sleep science", 15)
            with self.assertRaises(PipelineError): pipe.research(state)
            pipe.outline(state); pipe.research(state)
            pipe.draft(state, ["opening"])
            pipe.review(state); pipe.speech_plan(state)
            self.assertEqual(state.status, "speech-planned")
            self.assertEqual(state.calls_used, 4)

    def test_cache_and_budget(self):
        with tempfile.TemporaryDirectory() as d:
            client = FakeClient()
            a = EpisodePipeline(client, cache_dir=d, max_calls=1)
            state = a.new_state("Sleep", 30)
            a.outline(state)
            # A new run with same prompt reuses the cache without spending budget.
            b = EpisodePipeline(client, cache_dir=d, max_calls=1)
            other = b.new_state("Sleep", 30)
            b.outline(other)
            self.assertEqual(len(client.calls), 1)
            self.assertTrue(other.stages["outline"]["cache_hit"])
            b.research(other)
            b.research(other)
            with self.assertRaises(PipelineError): b.draft(other, ["opening"])

    def test_state_roundtrip(self):
        with tempfile.TemporaryDirectory() as d:
            state = EpisodePipeline.new_state("Bounded topic", 45)
            path = Path(d) / "state.json"
            state.save(path)
            from src.episode_pipeline import EpisodeState
            self.assertEqual(EpisodeState.load(path).episode_id, state.episode_id)

    def test_bad_outline_and_empty_or_unknown_citations_fail_closed(self):
        with tempfile.TemporaryDirectory() as d:
            client = FakeClient()
            pipe = EpisodePipeline(client, cache_dir=d)
            state = pipe.new_state("Sleep", 15)
            state.outline = {"segments": [{"id": "too-short", "duration_minutes": 10}]}
            with self.assertRaises(PipelineError): pipe._validate_outline(state, state.outline)
            with self.assertRaises(PipelineError): pipe._validate_dossier({"sources": [], "findings": []})
            with self.assertRaises(PipelineError): pipe._validate_dossier({"sources": [{"id": "s1"}], "findings": [{"id": "c1", "source_ids": ["missing"]}]})

    def test_review_replacement_is_deterministically_assembled_as_audio_asset(self):
        with tempfile.TemporaryDirectory() as d:
            client = FakeClient()
            pipe = EpisodePipeline(client, cache_dir=d)
            state = pipe.new_state("Sleep", 15)
            pipe.outline(state); pipe.research(state); pipe.draft(state, ["opening"])
            state.review = {"findings": [{"turn_id": "t1", "source_ids": ["s1"],
                                            "minimal_replacement": "Corrected wording."}],
                            "unresolved_questions": []}
            state.status = "reviewed"
            plan = pipe.speech_plan(state)
            self.assertEqual(len(client.calls), 3)  # no additional model call
            self.assertEqual(plan["turns"][0]["text"], "Corrected wording.")
            self.assertEqual(plan["audio_assets"][0]["text"], "Corrected wording.")
            self.assertEqual(plan["audio_assets"][0]["claim_ids"], ["c1"])
            self.assertGreater(plan["estimated_duration_seconds"], 0)

    def test_framing_turn_can_omit_claims_but_factual_turn_cannot(self):
        framing = {"text": "Welcome to the discussion."}
        EpisodePipeline._validate_turn_citations(framing, {"c1"})
        self.assertEqual(framing["claim_ids"], [])
        with self.assertRaises(PipelineError):
            EpisodePipeline._validate_turn_citations({"text": "REM sleep was discovered in 1953."}, {"c1"})


if __name__ == "__main__": unittest.main()
