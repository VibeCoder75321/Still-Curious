import copy
import json
import unittest
from pathlib import Path

from src.validate_episode import validate_episode


FIXTURE = Path(__file__).parents[1] / "fixtures" / "wayfinding-audition.json"


class EpisodeValidationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.episode = json.loads(FIXTURE.read_text(encoding="utf-8"))

    def errors_for(self, mutate):
        episode = copy.deepcopy(self.episode)
        mutate(episode)
        return validate_episode(episode)

    def test_lead_fixture_passes(self):
        self.assertEqual(validate_episode(self.episode), [])

    def test_unknown_speaker(self):
        errors = self.errors_for(lambda e: e["turns"][0].update(speaker="narrator"))
        self.assertTrue(any("turns[0].speaker" in error for error in errors))

    def test_unresolved_claim_and_source(self):
        def mutate(e):
            e["claims"][0]["source_ids"] = ["missing-source"]
            e["turns"][0]["claim_ids"] = ["missing-claim"]
        errors = self.errors_for(mutate)
        self.assertTrue(any("unresolved source id" in error for error in errors))
        self.assertTrue(any("unresolved claim id" in error for error in errors))

    def test_duplicate_turn_id(self):
        errors = self.errors_for(lambda e: e["turns"][1].update(id=e["turns"][0]["id"]))
        self.assertTrue(any("duplicate turn id" in error for error in errors))

    def test_empty_spoken_text(self):
        errors = self.errors_for(lambda e: e["turns"][0].update(text="  "))
        self.assertTrue(any("turns[0].text" in error for error in errors))

    def test_wrong_collection_element_types_do_not_crash(self):
        def mutate(e):
            e["sources"] = [None]
            e["claims"] = ["claim"]
            e["turns"] = [17]
        errors = self.errors_for(mutate)
        self.assertTrue(any("sources[0]" in error for error in errors))
        self.assertTrue(any("claims[0]" in error for error in errors))
        self.assertTrue(any("turns[0]" in error for error in errors))

    def test_bool_is_not_schema_version_or_number(self):
        def mutate(e):
            e["schema_version"] = True
            e["target_minutes"] = True
        errors = self.errors_for(mutate)
        self.assertTrue(any("schema_version" in error for error in errors))
        self.assertTrue(any("target_minutes" in error for error in errors))

    def test_schema_version_must_be_an_integer(self):
        errors = self.errors_for(lambda e: e.update(schema_version=1.0))
        self.assertTrue(any("schema_version" in error for error in errors))

    def test_claim_requires_at_least_one_source(self):
        errors = self.errors_for(lambda e: e["claims"][0].update(source_ids=[]))
        self.assertTrue(any("claims[0].source_ids" in error and "at least one" in error for error in errors))

    def test_declared_companion2_is_valid(self):
        def mutate(e):
            e["speakers"]["companion2"] = {"display_name": "Second Companion"}
            e["turns"][0]["speaker"] = "companion2"
        self.assertEqual(self.errors_for(mutate), [])

    def test_companion2_turn_requires_declaration(self):
        def mutate(e):
            e["speakers"].pop("companion2", None)
            e["turns"][0]["speaker"] = "companion2"
        errors = self.errors_for(mutate)
        self.assertTrue(any("turns[0].speaker" in error and "not defined" in error for error in errors))

    def test_legacy_two_speaker_episode_still_validates(self):
        def mutate(e):
            e["speakers"].pop("companion2", None)
            for turn in e["turns"]:
                if turn["speaker"] == "companion2":
                    turn["speaker"] = "companion"
        self.assertEqual(self.errors_for(mutate), [])

    def test_unknown_fourth_speaker_is_rejected(self):
        errors = self.errors_for(lambda e: e["speakers"].update(guest={"display_name": "Guest"}))
        self.assertTrue(any("speakers.guest" in error and "not allowed" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
