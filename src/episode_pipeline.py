"""Cost-bounded, auditable staged episode generation using OpenAI Responses API.

No work runs at import time. The API key is read only from the environment and
is never written into episode state, logs, or cache files.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from .episode_prompts import PROMPT_VERSION, PROMPTS, STYLE

LENGTHS = (15, 30, 45)
STAGES = ("outline", "research", "draft", "review", "speech")
_FRAMING = re.compile(r"\b(welcome|thanks?|thank you|good evening|good night|goodnight|let'?s begin|let'?s get started|in this episode|you'?re listening|we'?ll be back|goodbye|until next time)\b", re.I)


class PipelineError(RuntimeError):
    pass


@dataclass
class EpisodeState:
    topic: str
    target_minutes: int
    episode_id: str
    status: str = "new"
    stages: dict[str, dict[str, Any]] = field(default_factory=dict)
    outline: dict[str, Any] | None = None
    dossier: dict[str, Any] | None = None
    draft_sections: list[dict[str, Any]] = field(default_factory=list)
    review: dict[str, Any] | None = None
    speech_plan: dict[str, Any] | None = None
    calls_used: int = 0
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def save(self, path: str | Path) -> None:
        dest = Path(path)
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(dest.suffix + ".tmp")
        tmp.write_text(json.dumps(asdict(self), indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(dest)

    @classmethod
    def load(cls, path: str | Path) -> "EpisodeState":
        return cls(**json.loads(Path(path).read_text(encoding="utf-8")))


class ResponsesClient:
    """Small stdlib HTTP client; inject transport for tests if desired."""
    def __init__(self, api_key: str | None = None, model: str | None = None,
                 timeout: int = 120, opener: Callable[..., Any] = urllib.request.urlopen):
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY")
        if not self.api_key:
            raise PipelineError("OPENAI_API_KEY is required for live generation")
        self.model = model or os.environ.get("EPISODE_MODEL", "gpt-4.1-mini")
        self.timeout = timeout
        self.opener = opener

    def generate(self, prompt: str, *, research: bool = False, max_output_tokens: int = 3000) -> tuple[dict[str, Any], dict[str, Any]]:
        body: dict[str, Any] = {"model": self.model, "input": prompt,
            "max_output_tokens": max_output_tokens,
            "text": {"format": {"type": "json_object"}}}
        if research:
            # Current Responses integrations should use web_search. The preview
            # name remains supported only for legacy integrations.
            body["tools"] = [{"type": "web_search", "search_context_size": "medium"}]
        request = urllib.request.Request("https://api.openai.com/v1/responses",
            data=json.dumps(body).encode(), headers={"Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"}, method="POST")
        try:
            with self.opener(request, timeout=self.timeout) as response:
                payload = json.loads(response.read())
        except urllib.error.HTTPError as exc:
            raise PipelineError(f"Responses API HTTP {exc.code}") from None
        except (urllib.error.URLError, TimeoutError) as exc:
            raise PipelineError(f"Responses API connection failed: {type(exc).__name__}") from None
        text = payload.get("output_text")
        if not text:
            texts = [c.get("text", "") for item in payload.get("output", [])
                     for c in item.get("content", []) if c.get("type") == "output_text"]
            text = "\n".join(texts)
        try:
            result = json.loads(text)
        except (TypeError, json.JSONDecodeError):
            raise PipelineError("Model returned invalid JSON") from None
        if not isinstance(result, dict):
            raise PipelineError("Model response must be a JSON object")
        usage = payload.get("usage", {})
        meta = {"response_id": payload.get("id"), "model": payload.get("model", self.model),
                "usage": {k: usage.get(k) for k in ("input_tokens", "output_tokens", "total_tokens")}}
        return result, meta


class EpisodePipeline:
    def __init__(self, client: Any, *, cache_dir: str | Path = ".episode-cache",
                 max_calls: int = 12, max_output_tokens: int = 3000,
                 state_path: str | Path | None = None):
        if max_calls < 1:
            raise ValueError("max_calls must be positive")
        self.client = client
        self.cache_dir = Path(cache_dir)
        self.max_calls = max_calls
        self.max_output_tokens = max_output_tokens
        self.state_path = Path(state_path) if state_path else None

    def _save(self, state: EpisodeState) -> None:
        if self.state_path:
            state.save(self.state_path)

    @staticmethod
    def _validate_outline(state: EpisodeState, outline: dict[str, Any]) -> list[dict[str, Any]]:
        segments = outline.get("segments")
        if not isinstance(segments, list) or not segments:
            raise PipelineError("outline must include non-empty segments with duration_minutes")
        total = 0.0
        for index, segment in enumerate(segments):
            duration = segment.get("duration_minutes") if isinstance(segment, dict) else None
            if not isinstance(duration, (int, float)) or isinstance(duration, bool) or duration <= 0:
                raise PipelineError(f"outline segment {index} has invalid duration_minutes")
            segment["id"] = str(segment.get("id") or f"segment-{index + 1}")
            segment["word_budget"] = round(duration * 130)
            total += duration
        if abs(total - state.target_minutes) > 0.05:
            raise PipelineError(f"outline segment durations total {total:g} minutes; expected {state.target_minutes}")
        return segments

    @staticmethod
    def _validate_dossier(dossier: dict[str, Any]) -> tuple[set[str], set[str]]:
        sources = dossier.get("sources")
        if not isinstance(sources, list) or not sources:
            raise PipelineError("research dossier must contain at least one inspected source")
        ids = {source.get("id") for source in sources if isinstance(source, dict) and isinstance(source.get("id"), str) and source.get("id")}
        if len(ids) != len(sources):
            raise PipelineError("every dossier source must have a unique non-empty id")
        findings = dossier.get("findings", [])
        if not isinstance(findings, list) or not findings:
            raise PipelineError("research dossier must contain cited findings")
        finding_ids: set[str] = set()
        for finding in findings:
            refs = finding.get("source_ids") if isinstance(finding, dict) else None
            fid = finding.get("id") if isinstance(finding, dict) else None
            if not isinstance(fid, str) or not fid or fid in finding_ids:
                raise PipelineError("each dossier finding must have a unique non-empty id")
            finding_ids.add(fid)
            if not isinstance(refs, list) or not refs or any(ref not in ids for ref in refs):
                raise PipelineError("each research finding must cite dossier source IDs")
        return ids, finding_ids

    @staticmethod
    def _validate_turn_citations(turn: dict[str, Any], claim_ids: set[str]) -> None:
        refs = turn.get("claim_ids")
        text = turn.get("text", "")
        if not isinstance(text, str) or not text.strip():
            raise PipelineError("draft contains an empty turn")
        if refs is None:
            refs = []
            turn["claim_ids"] = refs
        if not isinstance(refs, list) or any(ref not in claim_ids for ref in refs) or (not refs and not _FRAMING.search(text)):
            raise PipelineError("draft contains an unsupported or empty citation")

    @staticmethod
    def new_state(topic: str, minutes: int) -> EpisodeState:
        topic = topic.strip()
        if not topic:
            raise ValueError("topic must not be empty")
        if minutes not in LENGTHS:
            raise ValueError("target length must be 15, 30, or 45 minutes")
        slug = re.sub(r"[^a-z0-9]+", "-", topic.lower()).strip("-")[:32] or "episode"
        return EpisodeState(topic, minutes, f"{slug}-{minutes}-{hashlib.sha256(topic.encode()).hexdigest()[:6]}")

    def _invoke(self, state: EpisodeState, stage: str, prompt: str, *, research: bool = False) -> dict[str, Any]:
        key = hashlib.sha256(f"{PROMPT_VERSION}\0{self.client.model}\0{stage}\0{prompt}".encode()).hexdigest()
        cache_path = self.cache_dir / f"{key}.json"
        if cache_path.exists():
            record = json.loads(cache_path.read_text(encoding="utf-8"))
            state.stages[stage] = {**record["meta"], "cache_hit": True, "cached_at": record["cached_at"]}
            return record["result"]
        if state.calls_used >= self.max_calls:
            raise PipelineError(f"Call budget exhausted ({self.max_calls})")
        result, meta = self.client.generate(prompt, research=research, max_output_tokens=self.max_output_tokens)
        state.calls_used += 1
        meta.update({"cache_hit": False, "completed_at": datetime.now(timezone.utc).isoformat()})
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps({"result": result, "meta": meta,
                                          "cached_at": meta["completed_at"]}, indent=2), encoding="utf-8")
        state.stages[stage] = meta
        return result

    def outline(self, state: EpisodeState) -> dict[str, Any]:
        p = PROMPTS["outline"].format(topic=state.topic, minutes=state.target_minutes,
                                      total_words=state.target_minutes * 130)
        state.outline = self._invoke(state, "outline", p)
        self._validate_outline(state, state.outline)
        state.status = "outlined"
        self._save(state)
        return state.outline

    def research(self, state: EpisodeState) -> dict[str, Any]:
        if state.outline is None:
            raise PipelineError("outline stage must finish before research")
        p = PROMPTS["research"].format(outline=json.dumps(state.outline, ensure_ascii=False))
        state.dossier = self._invoke(state, "research", p, research=True)
        self._validate_dossier(state.dossier)
        state.status = "researched"
        self._save(state)
        return state.dossier

    def draft(self, state: EpisodeState, sections: list[str]) -> list[dict[str, Any]]:
        if state.outline is None or state.dossier is None:
            raise PipelineError("outline and research stages are required before drafting")
        if not sections:
            raise ValueError("at least one draft section is required")
        segments = self._validate_outline(state, state.outline)
        source_ids, claim_ids = self._validate_dossier(state.dossier)
        if len(sections) != len(segments):
            raise ValueError("provide one section label per outlined segment")
        continuity = "Beginning of episode."
        existing = {part.get("segment_id"): part for part in state.draft_sections}
        for i, (section, segment) in enumerate(zip(sections, segments), 1):
            if segment["id"] in existing:
                continuity = str(existing[segment["id"]].get("section_summary", continuity))[:1500]
                continue
            words = segment["word_budget"]
            prompt = PROMPTS["draft"].format(minutes=state.target_minutes, style=STYLE,
                sections=f"{section}; segment_id={segment['id']}; duration={segment['duration_minutes']} minutes; target about {words} spoken words (130 wpm)", continuity=continuity,
                dossier=json.dumps(state.dossier, ensure_ascii=False))
            output_cap = min(self.max_output_tokens, max(500, round(words * 1.7 + 500)))
            # Keep per-segment requests bounded so long episodes are never
            # squeezed into a single short response.
            old_cap = self.max_output_tokens
            self.max_output_tokens = output_cap
            try:
                data = self._invoke(state, f"draft-{segment['id']}", prompt)
            finally:
                self.max_output_tokens = old_cap
            turns = data.get("turns")
            if not isinstance(turns, list) or not turns:
                raise PipelineError(f"draft segment {segment['id']} has no turns")
            for turn in turns:
                try:
                    self._validate_turn_citations(turn, claim_ids)
                except PipelineError as exc:
                    raise PipelineError(f"draft segment {segment['id']}: {exc}") from None
            data["segment_id"] = segment["id"]
            data["target_words"] = words
            state.draft_sections.append(data)
            continuity = str(data.get("section_summary", ""))[:1500]
            self._save(state)
        state.draft_sections.sort(key=lambda part: next(i for i, segment in enumerate(segments) if segment["id"] == part["segment_id"]))
        total_words = sum(len(turn.get("text", "").split()) for part in state.draft_sections for turn in part["turns"])
        actual_minutes = total_words / 130
        if abs(actual_minutes - state.target_minutes) > max(1.0, state.target_minutes * 0.08):
            raise PipelineError(f"draft length estimates {actual_minutes:.1f} minutes; target {state.target_minutes} minutes")
        self._validate_intro(state.draft_sections)
        state.status = "drafted"
        self._save(state)
        return state.draft_sections

    def review(self, state: EpisodeState) -> dict[str, Any]:
        if not state.draft_sections or state.dossier is None:
            raise PipelineError("draft and research stages are required before factual review")
        p = PROMPTS["review"].format(draft=json.dumps(state.draft_sections, ensure_ascii=False),
                                     dossier=json.dumps(state.dossier, ensure_ascii=False))
        state.review = self._invoke(state, "review", p)
        source_ids, _ = self._validate_dossier(state.dossier or {})
        turns = {turn["id"]: turn for part in state.draft_sections for turn in part["turns"]}
        for finding in state.review.get("findings", []):
            tid = finding.get("turn_id")
            refs = finding.get("source_ids", [])
            if tid not in turns or not refs or any(ref not in source_ids for ref in refs):
                raise PipelineError("review contains a finding with an unsupported turn or source citation")
        state.status = "reviewed" if not state.review.get("unresolved_questions") else "review-needed"
        self._save(state)
        return state.review

    def speech_plan(self, state: EpisodeState) -> dict[str, Any]:
        if state.review is None or state.status != "reviewed":
            raise PipelineError("resolve factual review questions before speech planning")
        source_ids, claim_ids = self._validate_dossier(state.dossier or {})
        reviewed = json.loads(json.dumps(state.draft_sections))
        by_id = {turn["id"]: turn for part in reviewed for turn in part["turns"]}
        for finding in state.review.get("findings", []):
            replacement = finding.get("minimal_replacement")
            if replacement:
                if finding["turn_id"] not in by_id:
                    raise PipelineError("review replacement references an unknown turn")
                by_id[finding["turn_id"]]["text"] = replacement
        # Speech formatting is deterministic: long scripts never require a
        # second large generation or risk response truncation.
        assets: list[dict[str, Any]] = []
        for section in reviewed:
            for turn in section["turns"]:
                refs = turn.get("claim_ids", [])
                if any(ref not in claim_ids for ref in refs):
                    raise PipelineError("speech script has an unsupported claim reference")
                text = turn["text"]
                assets.append({"turn_id": turn["id"], "speaker": turn["speaker"],
                    "text": text, "claim_ids": refs, "delivery": turn.get("delivery", "conversational"),
                    "estimated_seconds": round(len(text.split()) / 130 * 60, 1),
                    "voice_requirement": turn["speaker"]})
        state.speech_plan = {"turns": [dict(turn) for part in reviewed for turn in part["turns"]],
                             "pronunciation_notes": [], "audio_assets": assets,
                             "estimated_duration_seconds": round(sum(a["estimated_seconds"] for a in assets), 1)}
        state.status = "speech-planned"
        self._save(state)
        return state.speech_plan

    @staticmethod
    def _validate_intro(sections: list[dict[str, Any]]) -> None:
        turns = [turn for section in sections for turn in section.get("turns", [])]
        words_before_question = 0
        for turn in turns:
            words = turn.get("text", "").split()
            text = turn.get("text", "")
            if "?" in text:
                prefix = text.split("?", 1)[0]
                words_before_question += len(prefix.split())
                if words_before_question < 100:
                    raise PipelineError("opening needs about one minute before the first question")
                return
            words_before_question += len(words)


class TTSAdapter:
    """Typed integration boundary; deliberately does not fabricate voice output."""
    def synthesize(self, assets: list[dict[str, Any]]) -> list[dict[str, Any]]:
        raise NotImplementedError("Configure a TTS provider, credentials, voice IDs, and licensing before synthesis")
