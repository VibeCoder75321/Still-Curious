import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
function run(scenario: string) {
  const runtimeName = `audio-cli-test-${scenario}-${crypto.randomUUID()}`;
  const result = spawnSync(process.execPath, ["--import", "./tests/fixtures/audio-cli-preload.mjs", "scripts/run-audio-audition.ts"], {
    cwd: repo, encoding: "utf8", timeout: 20_000,
    env: { PATH: process.env.PATH, NODE_ENV: "test", ELEVENLABS_API_KEY: "offline-fixture-only", AUDIO_FIXTURE_SCENARIO: scenario },
    input: JSON.stringify({ voices: { host: "host-fixture", expert1: "one-fixture", expert2: "two-fixture", expert3: "three-fixture" },
      audioAllowanceUsd: 1.49, topupUsd: 10, topupCredits: 27472, runtimeName,
      apiPricing: { usdPer1kCharacters: scenario === "expensive" ? 0.364 : 0.08, checkedAt: Date.now(),
        sources: ["https://elevenlabs.io/pricing/api", "https://elevenlabs.io/app/subscription/api"] } }),
  });
  const root = resolve(repo, "node_modules/.cache", runtimeName), journal = JSON.parse(readFileSync(resolve(root, "http-journal.json"), "utf8"));
  assert.ok(journal.every((entry: any) => entry.method === "GET"), "No preflight case can submit or reserve a paid audio request");
  assert.equal(existsSync(resolve(root, "run.sqlite")), false);
  return { result, root, journal };
}
test("audio CLI uses the verified API dollar rate even when catalog credit arithmetic differs", () => {
  const { result, root, journal } = run("standard");
  assert.equal(result.status, 0, result.stderr); const output = JSON.parse(result.stdout.trim());
  assert.equal(output.status, "preflight_only"); assert.equal(output.paidAudioRequests, 0); assert.equal(output.auditionSections, 3);
  assert.ok(output.fullPlanReservationUsd < 1.49); assert.equal(output.usdPer1kCharacters, 0.08);
  assert.equal(journal.length, 6); const authorization = JSON.parse(readFileSync(resolve(root, "authorization.json"), "utf8"));
  assert.equal(authorization.fullAudioAcceptanceAuthorized, false); assert.equal(authorization.conservativeMaximumIncludingAudioUsd, 4.990258125);
  const quota = JSON.parse(readFileSync(resolve(root, "quota-preflight.json"), "utf8"));
  assert.equal(quota.existingKeyLimit, 10000); assert.equal(quota.keyLimitChanged, false);
  assert.equal(quota.maximumAuditionCatalogUnits, 5183); assert.equal(quota.fullKeyQuotaVerified, false);
});
test("audio CLI rejects account/model pricing above the unchanged allowance before creating a paid run", () => {
  const { result, root } = run("expensive"); assert.notEqual(result.status, 0); assert.match(result.stderr, /allowance/);
  assert.equal(existsSync(resolve(root, "authorization.json")), false);
});
test("audio CLI stops on metadata permission denial without voice reads, retries or paid requests", () => {
  const { result, journal } = run("denied"); assert.notEqual(result.status, 0); assert.match(result.stderr, /HTTP 401/);
  assert.equal(journal.length, 2); assert.equal(journal[1].status, 401);
});
