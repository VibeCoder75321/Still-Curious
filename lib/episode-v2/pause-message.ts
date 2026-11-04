import type { EpisodeV2Job } from "./contracts.ts";

/** Public explanations use fixed text, never provider bodies, private inputs or raw error messages. */
export function savedStepFailureMessage(job: EpisodeV2Job): string | null {
  if (job.status !== "paused" || job.pause?.code !== "needs_input") return null;
  const attempt = Object.values(job.state.execution?.steps ?? {})
    .filter(step => step.phase === "failed" && step.step.stage === job.stage && step.step.substep === job.substep)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (!attempt) return null;
  const record = job.state.usageLedger?.records.find(value => value.id === attempt.usageRecordId);
  if (!record) return null;
  const context = job.stage === "research" && job.substep === "read" ? "Reading a research source stopped: " : "This step stopped: ";
  const codes: Record<string, string> = {
    source_not_opened: "the research service did not confirm opening the requested source. The app did not accept it as read.",
    search_not_observed: "the research service did not confirm completing the required search.",
    invalid_output: "the model returned a result that did not match the required data format.",
    incomplete: "the model stopped before completing its response.",
    refusal: "the model declined this request.",
    reservation_exceeded: "the provider reported work above the amount reserved for this request.",
  };
  const categories: Record<string, string> = {
    billing: "the model provider reported a credit or spending-limit problem.",
    rate_limit: "the model provider temporarily limited requests.",
    authentication: "the model provider rejected the configured credentials.",
    configuration: "the model provider rejected the request configuration.",
    output: "the model response could not be accepted.",
    provider: "the model provider could not complete the request.",
    transport: "the model response could not be received reliably.",
    persistence: "the app could not safely save the result.",
  };
  const error = record.error;
  const detail = error ? codes[error.code] ?? categories[error.category] ?? "the saved result needs technical review."
    : record.outcome === "completed" ? "a result was returned, but the app could not validate or save it."
    : "the saved result needs technical review.";
  return context + detail + " Your saved progress is preserved. This request has not been automatically repeated.";
}
