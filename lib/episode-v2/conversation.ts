import { transcriptSchema, type EpisodeV2Job, type GuestSpeaker } from "./contracts.ts";
import { acceptGuest, acceptHost, acceptRequest, conversationRemaining, createConversationData } from "./conversation-state.ts";
import { createModelPolicy, type Role } from "./model-policy.ts";
import { quoteOperation } from "./providers.ts";
import { createContributionRequestPlan } from "./roles/contribution-request.ts";
import { contributionRequestSchema, guestContributionSchema, hostActionSchema } from "./roles/contracts.ts";
import { createGuestRolePlan } from "./roles/guest.ts";
import { createHostRolePlan } from "./roles/host.ts";
import type { StepPlan } from "./runner.ts";
import { artifactEnvelope, artifactRef, latestArtifactRef, requireLatestArtifact, StageBlockedError, type ArtifactReader } from "./stage-helpers.ts";
import { reserveUsage } from "./usage.ts";

/** Rebuild the original preflight during response-ID reconciliation, preserving the request hash. */
export function beforeConversationAttempt(job: EpisodeV2Job, key: string): EpisodeV2Job {
  const before = structuredClone(job), attempt = before.state.execution?.steps[key];
  if (attempt && ["submitted", "pending", "uncertain"].includes(attempt.phase) && before.state.usageLedger) {
    before.state.usageLedger.records = before.state.usageLedger.records.filter(record => record.id !== attempt.usageRecordId);
  }
  return before;
}

/** Worst-case sequential reservations, including a final host operation, without spending. */
function canReserve(job: EpisodeV2Job, roles: Role[]): boolean {
  const ledger = structuredClone(job.state.usageLedger), policy = job.state.modelPolicy ?? createModelPolicy();
  if (!ledger) return false;
  try {
    for (const [index, role] of roles.entries()) {
      const record = quoteOperation({ id: `conversation-probe-${index}`, role, kind: "structured" }, policy.roles[role]!, new Date(0).toISOString());
      reserveUsage(ledger, record);
      // Hold the full maximum for the following hypothetical operation.
      record.outcome = "completed";
    }
    return true;
  } catch { return false; }
}

export async function createConversationPlan(job: EpisodeV2Job, read: ArtifactReader): Promise<StepPlan> {
  if (job.stage !== "conversation") throw new StageBlockedError("The saved conversation stage is not ready.");
  const previousRef = latestArtifactRef(job, "transcript");
  const previous = previousRef ? transcriptSchema.parse(await read(previousRef)) : undefined;
  const evidence = await requireLatestArtifact(job, read, "evidence_pack");
  const cast = await requireLatestArtifact(job, read, "cast");
  const data = previous?.data ?? createConversationData(job, {
    evidencePack: artifactRef(evidence), cast: artifactRef(cast), currentTopic: evidence.data.coverageDecision.centralQuestion,
    openQuestions: evidence.data.openQuestions,
  });
  if (!data.conversation || data.conversation.closed) throw new StageBlockedError("Review the saved conversation state before continuing; it is missing or already closed.");
  const state = data.conversation, substep = job.substep;
  const kind = substep === "host" ? "host" : substep.startsWith("request_") ? "bid" : "guest";
  const speaker = (kind === "bid" ? substep.slice("request_".length) : substep) as GuestSpeaker;
  if ((kind === "host" && (state.bidQueue.length || data.showState.nextSpeaker !== "host"))
    || (kind === "guest" && (state.bidQueue.length || data.showState.nextSpeaker !== speaker || state.invitation?.speaker !== speaker))
    || (kind === "bid" && state.bidQueue[0] !== speaker)) {
    throw new StageBlockedError("The saved next speaker and conversation substep disagree. Reconcile the floor before recording.");
  }
  const key = `conversation.${substep}:${state.operationCount + 1}`, before = beforeConversationAttempt(job, key);
  const remaining = conversationRemaining(data, before);
  const closeNow = remaining.approximateSeconds <= 20 || remaining.turns <= 2 || remaining.providerOperations <= 2 || !canReserve(before, ["guest", "host"]);
  const contributionRequestsAllowed = !closeNow && remaining.bidRounds > 0 && remaining.turns >= 3
    && canReserve(before, ["contribution_request", "contribution_request", "host", "guest", "host"]);
  if (kind === "host" ? !canReserve(before, ["host"])
    : kind === "guest" ? remaining.turns <= 1 || !canReserve(before, ["guest", "host"])
    : !canReserve(before, [...state.bidQueue.map(() => "contribution_request" as const), "host"])) {
    throw new StageBlockedError("The remaining conversation allowance cannot safely complete this step and return to the host. The exact exchange and next speaker are saved.", "budget");
  }
  const role = kind === "host" ? await createHostRolePlan(job, read)
    : kind === "guest" ? await createGuestRolePlan(job, read, speaker) : await createContributionRequestPlan(job, read, speaker);
  const input = JSON.parse(role.request.input);
  input.conversationConstraints = { closeNow, contributionRequestsAllowed, remaining,
    responseOpportunity: state.responseDue, bidRoundsUsed: state.bidRounds };
  const parse = (value: unknown) => {
    if (kind === "host") {
      const action = hostActionSchema.parse(value);
      if (closeNow && action.action !== "close") throw new Error("The remaining allowance requires a closing host action");
      if (!contributionRequestsAllowed && action.action === "request_contributions") throw new Error("Contribution requests are unavailable at this transition");
      return action;
    }
    return kind === "guest" ? guestContributionSchema.parse(value) : contributionRequestSchema.parse(value);
  };
  return {
    key, step: { stage: "conversation", substep: substep as "host" | GuestSpeaker | `request_${GuestSpeaker}` },
    inputs: role.inputs, prompt: role.prompt, editorialVersion: role.editorialVersion,
    request: { ...role.request, input: JSON.stringify(input), parse },
    finish(result, savedJob) {
      const output = parse(result.value);
      const accepted = kind === "host" ? acceptHost(data, hostActionSchema.parse(output), savedJob)
        : kind === "guest" ? acceptGuest(data, speaker, guestContributionSchema.parse(output), savedJob)
          : acceptRequest(data, speaker, contributionRequestSchema.parse(output), savedJob);
      const transcript = transcriptSchema.parse({ ...artifactEnvelope(result, savedJob, "transcript", (previous?.version ?? 0) + 1), data: accepted.data });
      return {
        artifacts: [transcript], next: accepted.next,
        progress: { message: accepted.data.conversation!.closed ? "Accepted conversation saved for editing" : "Conversation and next floor holder saved",
          acceptedTurns: transcript.data.turns.length, estimatedSpokenSeconds: transcript.data.showState.estimatedSpokenSeconds,
          bidRounds: transcript.data.conversation!.bidRounds,
          requestsUsed: transcript.data.conversation!.requests.filter(request => request.status === "used").length },
      };
    },
  };
}
