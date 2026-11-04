import {
  assertJobTransition, episodeV2JobSchema, type ArtifactRef, type EpisodeArtifact, type EpisodeV2Job, type Step, type StepAttempt,
} from "./contracts.ts";
import { createModelPolicy } from "./model-policy.ts";
import { StageBlockedError } from "./stage-helpers.ts";
import { V2_STAGES } from "./stages/index.ts";
import { createProviderAdapter, InputAllowanceError, ProviderOperationError, type ProviderRequest, type ProviderResult, type PersistUsage } from "./providers.ts";
import {
  canonicalJson, createD1EpisodeStore, readArtifact, saveArtifact, sha256, StaleEpisodeError,
  type ArtifactBucket, type EpisodeDatabase, type EpisodeStore,
} from "./persistence.ts";

export const POLL_INTERVAL_MS = 2_000;
class StepUnavailableError extends Error {}
type WithoutIdentity<T> = T extends unknown ? Omit<T, "id"> : never;
export type StepCompletion = {
  artifacts: EpisodeArtifact[]; next: Step;
  pause?: EpisodeV2Job["pause"];
  finalScript?: NonNullable<EpisodeV2Job["state"]["finalScript"]>;
  title?: string; progress?: Record<string, unknown>;
};
/** One plan is one paid operation, including each individual guest or contribution request. */
export type StepPlan<T = unknown> = {
  key: string; step: Step; inputs: ArtifactRef[];
  prompt: { id: string; version: string }; editorialVersion: string;
  request: WithoutIdentity<ProviderRequest<T>>;
  finish(result: ProviderResult<T>, job: EpisodeV2Job): StepCompletion | Promise<StepCompletion>;
};
export type StepFactory<T = unknown> = (job: EpisodeV2Job, read: (ref: ArtifactRef) => Promise<EpisodeArtifact>) => StepPlan<T> | Promise<StepPlan<T>>;
export type StepRegistry = Partial<Record<string, StepFactory>>;
export type AdvanceResult = { job: EpisodeV2Job | null; disposition: "saved" | "cached" | "busy" | "stale" | "waiting" };
const pause = (job: EpisodeV2Job, code: NonNullable<EpisodeV2Job["pause"]>["code"], reason: string) => {
  job.status = "paused"; job.pause = { code, reason };
};

export async function runDurableStep<T>(options: {
  id: string; userId: string; store: EpisodeStore; bucket?: ArtifactBucket;
  plan: StepFactory<T>; apiKey: string; fetch?: typeof fetch; now?: () => number; attemptId?: () => string;
}): Promise<AdvanceResult> {
  const { id, userId, store, bucket } = options, now = options.now ?? Date.now;
  const lease = await store.claim(id, userId);
  if (!lease) return { job: await store.read(id, userId), disposition: "busy" };
  try {
    let job = structuredClone(lease.job);
    if (job.status === "paused" && job.pause?.code !== "ambiguous_provider_result") return { job, disposition: "waiting" };
    const ledger = job.state.usageLedger;
    if (!ledger) {
      pause(job, "budget", "Configure a spending ceiling and separate allowances before continuing.");
      await store.save(lease, job); return { job, disposition: "saved" };
    }
    job.state.modelPolicy ??= createModelPolicy();
    const plan = await options.plan(structuredClone(job), ref => readArtifact(job, ref, bucket));
    if (!plan.key.trim() || !plan.prompt.id.trim() || !plan.prompt.version.trim() || !plan.editorialVersion.trim()) throw new Error("A step needs stable identities and prompt versions");
    const inputs = await Promise.all(plan.inputs.map(ref => readArtifact(job, ref, bucket)));
    const { parse: _parse, ...requestData } = plan.request;
    const fingerprint = canonicalJson({
      key: plan.key, step: plan.step, inputs: plan.inputs, artifacts: inputs, prompt: plan.prompt,
      editorialVersion: plan.editorialVersion, request: requestData, settings: job.state.modelPolicy.roles[plan.request.role],
      topic: job.topic, config: job.config,
    });
    if (new TextEncoder().encode(fingerprint).length > 2 * 1024 * 1024) throw new Error("Step inputs exceed their bounded storage allowance");
    const inputHash = await sha256(fingerprint);
    job.state.execution ??= { revision: lease.revision, steps: {} };
    let attempt = job.state.execution.steps[plan.key];
    if (attempt && attempt.inputHash !== inputHash) return { job: lease.job, disposition: "stale" };
    if (attempt?.phase === "completed") {
      await Promise.all(attempt.resultRefs.map(ref => readArtifact(job, ref, bucket)));
      return { job: lease.job, disposition: "cached" };
    }
    if (plan.step.stage !== job.stage || plan.step.substep !== job.substep) return { job: lease.job, disposition: "stale" };
    if (attempt?.phase === "failed") return { job: lease.job, disposition: "waiting" };
    if (Object.values(job.state.execution.steps).some(other => other.key !== plan.key && ["submitted", "pending", "uncertain"].includes(other.phase))) {
      pause(job, "ambiguous_provider_result", "Reconcile the saved unfinished step before starting another operation.");
      await store.save(lease, job); return { job, disposition: "saved" };
    }
    if (attempt) {
      const record = ledger.records.find(r => r.id === attempt.usageRecordId)!;
      if (!record.responseId) {
        attempt.phase = "uncertain"; attempt.updatedAt = now();
        pause(job, "ambiguous_provider_result", "The interrupted request has no saved response ID. It cannot safely be repeated automatically.");
        await store.save(lease, job); return { job, disposition: "saved" };
      }
      if ((attempt.nextPollAt ?? 0) > now()) return { job: lease.job, disposition: "waiting" };
    }
    const reconciling = !!attempt;
    if (!attempt) {
      const attemptId = options.attemptId?.() ?? `attempt_${crypto.randomUUID()}`;
      attempt = {
        id: attemptId, key: plan.key, step: plan.step, inputHash, inputs: plan.inputs, prompt: plan.prompt,
        phase: "submitted", usageRecordId: attemptId, resultRefs: [], createdAt: now(), updatedAt: now(),
      };
    }
    const identity = attempt;
    const adapter = createProviderAdapter({ apiKey: options.apiKey, policy: job.state.modelPolicy, fetch: options.fetch, now });
    const persist: PersistUsage = async (updatedLedger, result) => {
      // Build a fresh candidate so a failed CAS cannot contaminate the last accepted snapshot.
      let candidate = structuredClone(job);
      candidate.state.usageLedger = structuredClone(updatedLedger);
      candidate.state.execution ??= { revision: lease.revision, steps: {} };
      const saved: StepAttempt = structuredClone(identity);
      const record = updatedLedger.records.find(r => r.id === identity.id)!;
      saved.updatedAt = now(); delete saved.nextPollAt; delete saved.reason;
      if (result) {
        try {
          const completion = await plan.finish(result as ProviderResult<T>, structuredClone(candidate));
          if (!completion.artifacts.length) throw new Error("A completed step must save its output artifact");
          const refs: ArtifactRef[] = [];
          for (const artifact of completion.artifacts) {
            refs.push(await saveArtifact(candidate, {
              ...artifact,
              provenance: {
                inputVersions: plan.inputs, editorialVersion: plan.editorialVersion, prompt: plan.prompt,
                modelConfiguration: { model: record.actualModel!, reasoningEffort: record.settings.reasoningEffort },
                usageRecordIds: [record.id],
              },
            }, bucket));
          }
          saved.phase = "completed"; saved.resultRefs = refs;
          const resumed = structuredClone(job); resumed.status = "running"; delete resumed.pause;
          candidate.stage = completion.next.stage; candidate.substep = completion.next.substep;
          candidate.status = completion.pause ? "paused" : "running";
          if (completion.pause) candidate.pause = completion.pause; else delete candidate.pause;
          if (completion.finalScript) candidate.state.finalScript = completion.finalScript;
          if (completion.title !== undefined) candidate.title = completion.title;
          if (completion.progress) candidate.progress = completion.progress;
          assertJobTransition(resumed, candidate);
        } catch {
          // Keep a known provider ID even if result conversion/private storage failed. Do not
          // leave partial artifacts or advance the stage, and never pay to regenerate it.
          candidate = structuredClone(job);
          candidate.state.usageLedger = structuredClone(updatedLedger);
          candidate.state.execution ??= { revision: lease.revision, steps: {} };
          candidate.stage = job.stage; candidate.substep = job.substep;
          saved.phase = "failed"; saved.resultRefs = [];
          saved.reason = "The provider result could not be accepted. Its response metadata was saved for review before continuing.";
          pause(candidate, "needs_input", saved.reason);
        }
      } else if (record.outcome === "reserved") {
        saved.phase = "submitted";
      } else if (record.outcome === "pending" && !record.boundExceeded) {
        saved.phase = "pending"; saved.nextPollAt = now() + POLL_INTERVAL_MS;
        candidate.status = "running"; delete candidate.pause;
      } else {
        saved.phase = record.outcome === "uncertain" ? "uncertain" : "failed";
        saved.reason = record.error?.message ?? "The saved result needs review before continuing.";
        pause(candidate, saved.phase === "uncertain" ? "ambiguous_provider_result" : "needs_input", saved.reason);
      }
      candidate.state.execution.steps[plan.key] = saved;
      episodeV2JobSchema.parse(candidate);
      await store.save(lease, candidate);
      job = candidate;
    };
    try {
      const request = { ...plan.request, id: identity.id, background: true } as ProviderRequest<T>;
      if (reconciling) await adapter.retrieve(request, ledger, persist);
      else await adapter.execute(request, ledger, persist);
    } catch (error) {
      if (!(error instanceof ProviderOperationError)) {
        // Preflight failures have not initiated a request. Preserve an existing attempt unchanged.
        if (reconciling) throw error;
        const unchanged = structuredClone(lease.job);
        unchanged.state.modelPolicy = job.state.modelPolicy;
        if (error instanceof InputAllowanceError) pause(unchanged, "needs_input", error.message);
        else pause(unchanged, "budget", "Check the provider configuration, operation limits and spending allowance before continuing.");
        await store.save(lease, unchanged); job = unchanged;
      } else if (error.detail.category === "persistence") {
        // A write may have committed even if its acknowledgement was lost. Never write a fallback
        // over it or resubmit; the next advance must inspect the saved attempt.
        return { job: await store.read(id, userId), disposition: "stale" };
      }
    }
    return { job, disposition: "saved" };
  } catch (error) {
    if (error instanceof StaleEpisodeError) return { job: await store.read(id, userId), disposition: "stale" };
    if (error instanceof StageBlockedError) {
      const job = structuredClone(lease.job);
      pause(job, error.code, error.message);
      await store.save(lease, job); return { job, disposition: "saved" };
    }
    if (error instanceof StepUnavailableError) {
      const job = structuredClone(lease.job);
      pause(job, "needs_input", "This version 2 editorial step is not implemented yet.");
      await store.save(lease, job); return { job, disposition: "saved" };
    }
    throw error;
  } finally { await store.release(lease); }
}

/** Handlers are registered incrementally by Tasks 05–12; creation stays opt-in in Task 13. */
export async function advanceV2Job(id: string, userId: string, env: {
  DB: EpisodeDatabase; BUCKET?: ArtifactBucket; OPENAI_API_KEY?: string;
}, registry: StepRegistry = V2_STAGES): Promise<AdvanceResult> {
  const store = createD1EpisodeStore(env.DB);
  return runDurableStep({ id, userId, store, bucket: env.BUCKET, apiKey: env.OPENAI_API_KEY ?? "", plan: async (job, read) => {
    const factory = registry[`${job.stage}.${job.substep}`];
    if (!factory) throw new StepUnavailableError();
    return factory(job, read);
  } });
}
