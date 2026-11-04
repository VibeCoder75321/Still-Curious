import { env } from "cloudflare:workers";
import { json, userIdFrom } from "../_episodes";
import { audioConfigured } from "../../../lib/episode-v2/audio";
import { backgroundSchedulerActive } from "../../../lib/episode-v2/scheduler";

export async function GET(request: Request) {
  const voices = {
    host: Boolean(env.ELEVEN_VOICE_HOST),
    expert1: Boolean(env.ELEVEN_VOICE_EXPERT1),
    expert2: Boolean(env.ELEVEN_VOICE_EXPERT2),
    expert3: Boolean(env.ELEVEN_VOICE_EXPERT3),
  };
  const configured = Boolean(
    env.OPENAI_API_KEY &&
      env.ELEVENLABS_API_KEY &&
      voices.host &&
      voices.expert1 &&
      voices.expert2 &&
      voices.expert3,
  );
  const configuredText = Boolean(env.V2_TEXT_PILOT_ENABLED === "true" && env.OPENAI_API_KEY && env.DB && env.BUCKET);
  const textPilot = Boolean(userIdFrom(request) && configuredText);
  return json({ custom_generation: configured, text_pilot: textPilot, podcast_generation: textPilot && audioConfigured(env),
    background_processing: await backgroundSchedulerActive(env.DB),
    supported_lengths: configuredText ? [5, 15] : [5], voices, audio_engine: { mode: "dialogue", model: env.ELEVEN_DIALOGUE_MODEL || "eleven_v4", enabled: audioConfigured(env) } });
}
