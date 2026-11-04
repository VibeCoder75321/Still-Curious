// Retired pilot entries from the owner's 16 October 2026 history reset.
// This only archives their listing; owned records and audio remain recoverable.
// Explicit IDs keep subsequent episodes and other users' histories unaffected.
// Owner-requested cleanup on 30 October. These exact attempts are stopped by
// the scheduler as well as hidden from the listing; new episodes are unaffected.
export const RETIRED_ATTEMPT_IDS = [
  "75cb5427-72bc-439c-b89e-92a8e78548e8",
  "bf39bafe-f301-4d6b-ae1e-2fa83e0e409e",
] as const;

export const ARCHIVED_PILOT_EPISODE_IDS = [
  "05161d3b-cdb6-4832-b26f-d93eb94881ae",
  "29085cb6-fb28-4fb0-bdb0-e100e8771426",
  "c6e5be26-39ed-4293-b2ff-e6c864afa04a",
  ...RETIRED_ATTEMPT_IDS,
] as const;
