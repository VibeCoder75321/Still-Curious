declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    OPENAI_API_KEY?: string;
    EPISODE_OWNER_USER_ID?: string;
    CLOUDFLARE_SETUP_KEY?: string;
    BACKGROUND_RUN_SECRET?: string;
    BACKGROUND_PROVISION_SECRET?: string;
    SITE_SERVICE_TOKEN?: string;
    V2_TEXT_PILOT_ENABLED?: string;
    V2_AUDIO_ENABLED?: string;
    V2_AUDIO_PRICE_SNAPSHOT?: string;
    ELEVENLABS_API_KEY?: string;
    ELEVEN_VOICE_HOST?: string;
    ELEVEN_VOICE_EXPERT1?: string;
    ELEVEN_VOICE_EXPERT2?: string;
    ELEVEN_VOICE_EXPERT3?: string;
    OPENAI_MODEL?: string;
    OPENAI_SCRIPT_MODEL?: string;
    ELEVEN_DIALOGUE_MODEL?: string;
    ELEVEN_MODEL?: string;
  }
}

declare module "*.html?raw" {
  const html: string;
  export default html;
}
