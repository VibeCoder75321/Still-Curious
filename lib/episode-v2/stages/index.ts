import type { StepRegistry } from "../runner.ts";
import { createProducerPlan } from "./producer.ts";
import { createSourceDiscoveryPlan } from "./source-discovery.ts";
import { createSourceReadingPlan } from "./source-reading.ts";
import { createEvidencePlan } from "./evidence.ts";
import { createCastingPlan } from "./casting.ts";
import { createGuestPreparationPlan, createHostPreparationPlan } from "./preparation.ts";
import { createConversationPlan } from "../conversation.ts";
import { createEditingPlan } from "./editing.ts";
import { createReviewPlan } from "./review.ts";
import { createRepairPlan } from "./local-repair.ts";
import { createReviewLookupPlan } from "./review-lookup.ts";

/** Register only implemented handlers. New v2 job creation remains Task 13 work. */
export const V2_STAGES: StepRegistry = {
  "commission.produce": createProducerPlan,
  "research.discover": createSourceDiscoveryPlan,
  "research.read": createSourceReadingPlan,
  "research.synthesize": createEvidencePlan,
  "casting.cast": createCastingPlan,
  "preparation.expert1": createGuestPreparationPlan,
  "preparation.expert2": createGuestPreparationPlan,
  "preparation.expert3": createGuestPreparationPlan,
  "preparation.host": createHostPreparationPlan,
  "conversation.host": createConversationPlan,
  "conversation.expert1": createConversationPlan,
  "conversation.expert2": createConversationPlan,
  "conversation.expert3": createConversationPlan,
  "conversation.request_expert1": createConversationPlan,
  "conversation.request_expert2": createConversationPlan,
  "conversation.request_expert3": createConversationPlan,
  "editing.edit": createEditingPlan,
  "review.assess": createReviewPlan,
  "review.lookup": createReviewLookupPlan,
  "review.local_edit": createRepairPlan,
  "review.section_revision": createRepairPlan,
  "review.recheck": createReviewPlan,
};
