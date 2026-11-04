import {
  guestSpeakerSchema, transcriptSchema,
  type ArtifactRef, type ConversationState, type EpisodeV2Job, type GuestSpeaker, type Step, type Transcript,
} from "./contracts.ts";
import {
  contributionRequestSchema, guestContributionSchema, hostActionSchema,
  type ContributionRequest, type GuestContribution, type HostAction,
} from "./roles/contracts.ts";
import { allowanceUsed } from "./usage.ts";

export type ConversationData = Transcript["data"];
export type ConversationAcceptance = { data: ConversationData; next: Step };
const GUESTS = ["expert1", "expert2", "expert3"] as const;
const hostStep: Step = { stage: "conversation", substep: "host" };
const guestStep = (speaker: GuestSpeaker): Step => ({ stage: "conversation", substep: speaker });
const requestStep = (speaker: GuestSpeaker): Step => ({ stage: "conversation", substep: `request_${speaker}` });
const spokenSeconds = (data: ConversationData) => data.turns.reduce((sum, turn) => sum + turn.text.trim().split(/\s+/u).length, 0) * 60 / 145;

/** The estimate guides the host; accepted speech is never cut to meet a word quota. */
export function conversationRemaining(data: ConversationData, job: EpisodeV2Job): ConversationState["remaining"] {
  const ledger = job.state.usageLedger;
  return {
    approximateSeconds: Math.max(0, job.config.targetDurationSeconds - spokenSeconds(data)),
    turns: Math.max(0, job.config.limits.maxConversationTurns - data.turns.length),
    providerOperations: Math.max(0, job.config.limits.maxProviderOperations - (ledger?.records.length ?? 0)),
    textAllowanceUsd: ledger ? Math.max(0, ledger.allocations.text - allowanceUsed(ledger, "text")) : 0,
    bidRounds: Math.max(0, job.config.limits.maxContributionRequestRounds - (data.conversation?.bidRounds ?? 0)),
  };
}

export function createConversationData(job: EpisodeV2Job, inputs: {
  evidencePack: ArtifactRef; cast: ArtifactRef; currentTopic: string; openQuestions: string[];
}): ConversationData {
  if (inputs.evidencePack.kind !== "evidence_pack" || inputs.cast.kind !== "cast") throw new Error("Conversation needs the saved cast and evidence pack");
  const data: ConversationData = {
    evidencePack: { ...inputs.evidencePack, kind: "evidence_pack" }, cast: { ...inputs.cast, kind: "cast" },
    turns: [], stanceUpdates: [], hostDecisions: [],
    showState: { currentTopic: inputs.currentTopic, unresolvedQuestions: [...inputs.openQuestions], detourReturnPoint: null,
      nextSpeaker: "host", estimatedSpokenSeconds: 0 },
    conversation: { version: 1, operationCount: 0, bidRounds: 0, bidQueue: [], refreshRequestId: null, requests: [],
      responseDue: null, responseQueue: [], invitation: null, closed: false,
      remaining: { approximateSeconds: 0, turns: 0, providerOperations: 0, textAllowanceUsd: 0, bidRounds: 0 } },
  };
  data.conversation!.remaining = conversationRemaining(data, job);
  return transcriptSchema.shape.data.parse(data);
}

function editable(input: ConversationData): ConversationData & { conversation: ConversationState } {
  const data = structuredClone(transcriptSchema.shape.data.parse(input));
  if (!data.conversation) throw new Error("The saved transcript has no durable conversation state");
  if (data.conversation.closed) throw new Error("The conversation has already closed");
  return data as ConversationData & { conversation: ConversationState };
}

function append(data: ConversationData, speaker: "host" | GuestSpeaker, text: string, job: EpisodeV2Job): string {
  if (data.turns.length >= job.config.limits.maxConversationTurns) throw new Error("Conversation turn allowance exhausted");
  const id = `turn-${data.turns.length + 1}`;
  if (data.turns.some(turn => turn.id === id)) throw new Error("The saved transcript's turn sequence needs review");
  data.turns.push({ id, speaker, text });
  return id;
}

function accepted(data: ConversationData & { conversation: ConversationState }, job: EpisodeV2Job, next: Step): ConversationAcceptance {
  data.conversation.operationCount++;
  data.showState.estimatedSpokenSeconds = spokenSeconds(data);
  data.conversation.remaining = conversationRemaining(data, job);
  return { data: transcriptSchema.shape.data.parse(data), next };
}

function ensureHost(data: ConversationData & { conversation: ConversationState }): void {
  if (data.showState.nextSpeaker !== "host" || data.conversation.invitation || data.conversation.bidQueue.length) {
    throw new Error("The host does not currently hold the floor");
  }
}

/** Accept exactly the host's own words and an explicit, saved floor decision. */
export function acceptHost(input: ConversationData, value: HostAction, job: EpisodeV2Job): ConversationAcceptance {
  const action = hostActionSchema.parse(value), data = editable(input), state = data.conversation;
  ensureHost(data);
  const remaining = conversationRemaining(data, job);
  if (action.action !== "close" && (remaining.turns <= 2 || remaining.approximateSeconds <= 20)) {
    throw new Error("The host must close within the remaining conversation allowance");
  }
  if (action.action === "close" && action.text === null && data.turns.length === 0) throw new Error("An episode needs accepted spoken text before closing");
  if (state.responseDue && action.action !== "close"
    && !(["ask", "yield"].includes(action.action) && action.nextSpeaker === state.responseDue.speaker)
    && !(action.action === "ask" && action.clarificationNeeded === true)) {
    throw new Error("Offer the addressed guest a response before moving on, or ask an explicit clarification");
  }
  const decisions = action.requestDecisions ?? [], feedback = action.requestFeedback ?? [];
  if (new Set(decisions.map(decision => decision.requestId)).size !== decisions.length
    || new Set(feedback.map(item => item.requestId)).size !== feedback.length) throw new Error("A request can receive only one decision or feedback update per host operation");
  const acceptances = decisions.filter(decision => decision.decision === "accept");
  if (acceptances.length > 1) throw new Error("Only one contribution request can take the next floor");
  let selected: ConversationState["requests"][number] | undefined;
  let refresh = false;
  const precedingTurnId = data.turns.at(-1)?.id;
  for (const decision of decisions) {
    const request = state.requests.find(request => request.id === decision.requestId);
    if (!request || !["offered", "parked", "accepted"].includes(request.status)) throw new Error("Host decision must name an available saved request");
    if (decision.decision === "accept") {
      if (!["ask", "yield"].includes(action.action) || action.nextSpeaker !== request.speaker) {
        throw new Error("Accepting a request must invite its guest to address that point");
      }
      selected = request;
      refresh = request.status === "parked" || request.offeredAfterTurnId !== precedingTurnId;
      if (refresh && (remaining.bidRounds < 1 || remaining.approximateSeconds <= 20 || remaining.providerOperations < 4)) {
        throw new Error("The stale contribution request cannot be refreshed within the remaining allowance");
      }
      request.status = refresh ? "parked" : "accepted";
    } else request.status = decision.decision === "park" ? "parked" : "declined";
  }
  for (const item of feedback) {
    const request = state.requests.find(request => request.id === item.requestId);
    if (!request || request.status !== "used") throw new Error("Usefulness feedback belongs to a saved contribution that was actually spoken");
    request.feedback = { useful: item.useful, reason: item.reason };
  }
  if (action.action === "request_contributions") {
    const previous = data.turns.at(-1);
    if (!previous || previous.speaker === "host") throw new Error("Collect listening requests after a guest contribution");
    const queue = GUESTS.filter(speaker => speaker !== previous.speaker);
    if (remaining.bidRounds < 1 || remaining.turns < 3 || remaining.providerOperations < queue.length + 3) {
      throw new Error("There is insufficient allowance for another contribution-request round");
    }
    state.bidRounds++;
    state.bidQueue = queue;
  }
  const afterTurnId = action.text === null ? data.turns.at(-1)?.id ?? null : append(data, "host", action.text, job);
  data.hostDecisions.push({ afterTurnId, action: action.action, nextSpeaker: action.nextSpeaker, purpose: action.purpose,
    pointToAddress: action.pointToAddress, clarificationNeeded: action.clarificationNeeded ?? false });
  data.showState.currentTopic = action.currentTopic;
  data.showState.unresolvedQuestions = [...action.unresolvedQuestions];
  data.showState.detourReturnPoint = action.detourReturnPoint;
  if (action.action === "close") {
    state.closed = true; state.bidQueue = []; state.refreshRequestId = null; state.invitation = null;
    data.showState.nextSpeaker = null;
    return accepted(data, job, { stage: "editing", substep: "edit" });
  }
  if (refresh && selected) {
    state.bidRounds++; state.bidQueue = [selected.speaker]; state.refreshRequestId = selected.id;
    data.showState.nextSpeaker = "host";
    return accepted(data, job, requestStep(selected.speaker));
  }
  if (state.bidQueue.length) {
    data.showState.nextSpeaker = "host";
    return accepted(data, job, requestStep(state.bidQueue[0]));
  }
  if (action.action === "ask" || action.action === "yield") {
    const speaker = guestSpeakerSchema.parse(action.nextSpeaker);
    state.invitation = { speaker, point: action.pointToAddress ?? selected?.point ?? null, requestId: selected?.id ?? null };
    data.showState.nextSpeaker = speaker;
    return accepted(data, job, guestStep(speaker));
  }
  data.showState.nextSpeaker = "host";
  return accepted(data, job, hostStep);
}

/** Only the invited guest contributes; every earlier accepted turn remains exact. */
export function acceptGuest(input: ConversationData, speaker: GuestSpeaker, value: GuestContribution, job: EpisodeV2Job): ConversationAcceptance {
  guestSpeakerSchema.parse(speaker);
  const contribution = guestContributionSchema.parse(value), data = editable(input), state = data.conversation;
  if (state.bidQueue.length || state.invitation?.speaker !== speaker || data.showState.nextSpeaker !== speaker) {
    throw new Error("Only the invited guest can supply the next contribution");
  }
  if (contribution.addressedGuest?.speaker === speaker) throw new Error("A guest cannot reserve a response opportunity for themselves");
  const turnId = append(data, speaker, contribution.text, job);
  if (contribution.stanceUpdate !== null) data.stanceUpdates.push({ speaker, afterTurnId: turnId, update: contribution.stanceUpdate });
  if (state.invitation.requestId) {
    const request = state.requests.find(request => request.id === state.invitation!.requestId);
    if (!request || request.status !== "accepted" || request.speaker !== speaker) throw new Error("The invited contribution request is no longer available");
    request.status = "used"; request.usedAtTurnId = turnId;
  }
  state.invitation = null;
  state.responseQueue = state.responseQueue.filter(response => response.speaker !== speaker);
  if (state.responseDue?.speaker === speaker) state.responseDue = state.responseQueue.shift() ?? null;
  if (contribution.addressedGuest) {
    const response = { ...contribution.addressedGuest, afterTurnId: turnId };
    if (!state.responseDue) state.responseDue = response;
    else if (state.responseDue.speaker !== response.speaker && !state.responseQueue.some(queued => queued.speaker === response.speaker)) {
      state.responseQueue.push(response);
    }
  }
  data.showState.nextSpeaker = "host";
  return accepted(data, job, hostStep);
}

/** Listening is a saved one-point offer or pass, never an unaccepted speech. */
export function acceptRequest(input: ConversationData, speaker: GuestSpeaker, value: ContributionRequest, job: EpisodeV2Job): ConversationAcceptance {
  guestSpeakerSchema.parse(speaker);
  const bid = contributionRequestSchema.parse(value), data = editable(input), state = data.conversation;
  if (state.bidQueue[0] !== speaker || state.invitation || data.showState.nextSpeaker !== "host") {
    throw new Error("This guest does not have a pending listening request");
  }
  const afterTurnId = data.turns.at(-1)?.id;
  if (!afterTurnId) throw new Error("Listening requests need preceding accepted speech");
  if (state.refreshRequestId) {
    const request = state.requests.find(request => request.id === state.refreshRequestId && request.speaker === speaker);
    if (!request || state.bidQueue.length !== 1) throw new Error("The saved contribution refresh is inconsistent");
    request.point = bid.point; request.offeredAfterTurnId = afterTurnId;
    request.status = bid.decision === "pass" ? "passed" : "offered";
    request.usedAtTurnId = null; request.feedback = null;
    state.refreshRequestId = null;
  } else {
    const id = `request-${state.bidRounds}-${speaker}`;
    if (state.requests.some(request => request.id === id)) throw new Error("This listening request was already accepted");
    state.requests.push({ id, speaker, point: bid.point, offeredAfterTurnId: afterTurnId,
      status: bid.decision === "pass" ? "passed" : "offered", usedAtTurnId: null, feedback: null });
  }
  state.bidQueue.shift();
  return accepted(data, job, state.bidQueue.length ? requestStep(state.bidQueue[0]) : hostStep);
}
