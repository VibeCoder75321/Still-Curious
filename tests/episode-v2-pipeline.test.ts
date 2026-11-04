import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import type { EpisodeV2Job, SourceRecords } from "../lib/episode-v2/contracts.ts";
import { createD1EpisodeStore, type EpisodeDatabase } from "../lib/episode-v2/persistence.ts";
import { runDurableStep } from "../lib/episode-v2/runner.ts";
import { V2_STAGES } from "../lib/episode-v2/stages/index.ts";
import { latestArtifactRef } from "../lib/episode-v2/stage-helpers.ts";
import { requireFrozenEvidence } from "../lib/episode-v2/evidence-foundation.ts";
import { researchJob, discoveryFixture, readingFixture, researchUrls, researchAt } from "./fixtures/research.ts";
import { producerFixtures } from "./fixtures/producer.ts";
import { evidenceOutputFixture } from "./fixtures/evidence.ts";
import { castingFixture } from "./fixtures/casting.ts";

/** Full stage registration test: every output is consumed by the next real handler. */
test("registered pipeline runs producer through host with saved provenance and bounded research", async () => {
  const initial = researchJob(); initial.stage = "commission"; initial.substep = "produce"; initial.state.artifacts = {};
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("CREATE TABLE episodes (id TEXT PRIMARY KEY, user_id TEXT, active_user_id TEXT UNIQUE, status TEXT, job_json TEXT, lock_token TEXT, lock_until INTEGER, created_at INTEGER, updated_at INTEGER)");
  sqlite.prepare("INSERT INTO episodes VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)").run(initial.id, initial.userId, initial.userId, initial.status, JSON.stringify(initial), researchAt, researchAt);
  const db: EpisodeDatabase = { prepare(sql) {
    let values: (string | number | null)[] = [];
    const statement = { bind(...bound: (string | number | null)[]) { values = bound; return statement; },
      async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }; },
      async first<T>() { return (sqlite.prepare(sql).get(...values) ?? null) as T | null; },
    }; return statement;
  } };
  const store = createD1EpisodeStore(db, { now: () => researchAt });
  const operations: string[] = [], speakers: string[] = [];
  const fetchMock: typeof fetch = async (_url, init) => {
    assert.equal(init?.method, "POST");
    const body = JSON.parse(String(init?.body)), schema = body.text.format.name;
    const input = JSON.parse(body.input.split("\n\nOpen and read this source URL:")[0]);
    operations.push(schema);
    let value: unknown, output: unknown[] = [];
    switch (schema) {
      case "still_curious_producer_v1": value = producerFixtures[1].output; break;
      case "still_curious_source_discovery_v1":
        value = discoveryFixture;
        output = [{ type: "web_search_call", status: "completed", action: { type: "search", sources: researchUrls.map(url => ({ url, title: "Authored fixture" })) } }]; break;
      case "still_curious_source_reading_v1": {
        const index = researchUrls.indexOf(input.selectedSource.url); assert.ok(index >= 0);
        value = readingFixture(index, index === 3);
        output = [{ type: "web_search_call", status: index === 3 ? "failed" : "completed", action: { type: "open_page", url: input.selectedSource.url } }]; break;
      }
      case "still_curious_evidence_v1": {
        const sources = input.sourceRecords as SourceRecords;
        const refs = sources.data.sources.slice(0, 3).map(source => ({ sourceId: source.id, passageId: source.passages.find(p => p.coverage === "body")!.id }));
        const evidence = structuredClone(evidenceOutputFixture);
        evidence.claims = [{ ...evidence.claims[0], passages: [refs[0]] }];
        evidence.specialistExtracts.forEach(extract => { extract.claimIds = ["c1"]; });
        evidence.interpretations[0].passages = [refs[0]];
        evidence.stories[0].passages = [refs[0], refs[2]];
        value = evidence; break;
      }
      case "still_curious_casting_v1": value = castingFixture; break;
      case "still_curious_guest_preparation_v1": {
        assert.equal(body.tools, undefined);
        const speaker = input.ownProfile.speaker; speakers.push(speaker);
        assert.equal(input.cast, undefined); assert.equal(input.guestPreparationSummaries, undefined);
        value = { thesis: `Independent ${speaker} emphasis on the recorded pattern.`, supportingClaims: ["c1"], qualifications: ["One setting and a corrected magnitude."], strongestCounterargument: "A common external influence remains possible.", examplesOrStories: ["story1"], unresolved: ["Which mechanism fits further observations?"], whatWouldChangeMyView: "A discriminating intervention.", possibleOveremphasis: "My preferred method can miss variation." }; break;
      }
      case "still_curious_host_preparation_v1":
        assert.equal(body.tools, undefined); assert.equal(input.guestPreparationSummaries.length, 3);
        value = { priorities: ["Clarify what was measured before proposing mechanisms."], questions: castingFixture.guests.map((guest, index) => ({ question: `How would ${guest.trustedMethods[0]} help distinguish the pattern from its explanation?`, intendedGuest: `expert${index + 1}`, possibleFollowUps: ["What result would change that assessment?"] })), possibleDetours: ["Measurement conditions if an answer raises them."], returnPoint: "Return to what the shared pattern establishes.", endingAim: "Clarify the supported observation and the mechanism still in question." }; break;
      default: throw new Error(`Unexpected stage ${schema}`);
    }
    return new Response(JSON.stringify({ id: `resp_pipeline_${operations.length}`, status: "completed", model: body.model, service_tier: "default", output, output_text: JSON.stringify(value),
      usage: { input_tokens: 1200, output_tokens: 350, total_tokens: 1550, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 100 } },
    }));
  };
  let job: EpisodeV2Job = initial;
  for (let step = 0; step < 20 && job.stage !== "conversation"; step++) {
    const factory = V2_STAGES[`${job.stage}.${job.substep}`]; assert.ok(factory);
    const result = await runDurableStep({ id: job.id, userId: job.userId, store, plan: factory, apiKey: "mock-only", fetch: fetchMock, now: () => researchAt });
    job = result.job!;
    assert.equal(job.status, "running", JSON.stringify(job.pause));
    assert.equal(result.disposition, "saved");
  }
  assert.equal(job.stage, "conversation"); assert.equal(job.substep, "host");
  assert.equal(typeof V2_STAGES["conversation.host"], "function");
  assert.equal(typeof V2_STAGES["editing.edit"], "function");
  assert.equal(V2_STAGES["tts.synthesize"], undefined, "Audio is dispatched to its separate ElevenLabs runner, never the OpenAI editorial stage registry");
  assert.deepEqual(speakers, ["expert1", "expert2", "expert3"]);
  assert.equal(operations.length, 12);
  assert.equal(job.state.usageLedger!.records.length, 12);
  assert.equal(Object.values(job.state.execution!.steps).filter(step => step.phase === "completed").length, 12);
  const sources = job.state.artifacts[latestArtifactRef(job, "source_records")!.id];
  assert.equal(sources.kind, "source_records");
  if (sources.kind !== "source_records") throw new Error("Unexpected sources");
  assert.equal(sources.data.sources.length, 4, "The old exactly-three-sources rule is gone");
  assert.equal(sources.data.sources[0].publicationStatus, "corrected");
  assert.equal(sources.data.sources[3].readingCoverage, "inaccessible");
  const evidence = await requireFrozenEvidence(job, async ref => job.state.artifacts[ref.id]);
  const host = job.state.artifacts["host-plan:1"];
  assert.equal(host.kind, "host_plan");
  if (host.kind !== "host_plan") throw new Error("Unexpected host plan");
  assert.equal(host.data.evidencePack.id, evidence.id);
  assert.equal(host.provenance.inputVersions.filter(ref => ref.kind === "guest_preparation").length, 3);
  assert.ok(Object.values(job.state.artifacts).every(artifact => artifact.provenance.usageRecordIds.length === 1));
  sqlite.close();
});
