if (process.env.ELEVENLABS_API_KEY !== 'offline-fixture-only') throw new Error('The offline audio CLI fixture must never load a live credential');
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (init?.method === 'POST') throw new Error('The offline CLI preflight must never submit synthesis');
  if (url.pathname === '/v1/user/subscription') return Response.json({ tier: 'payg', character_count: 9053, character_limit: 37472 });
  if (url.pathname === '/v1/models') {
    if (process.env.AUDIO_FIXTURE_SCENARIO === 'denied') return Response.json({ detail: { status: 'missing_permissions' } }, { status: 401 });
    return Response.json([{ model_id: 'eleven_v4', name: 'Authored model fixture', can_do_text_to_speech: true,
      token_cost_factor: 1 }]);
  }
  if (url.pathname.startsWith('/v1/voices/')) return Response.json({ voice_id: url.pathname.split('/').at(-1), name: 'Authored default voice', category: 'premade', sharing: null });
  throw new Error('Unexpected offline provider metadata read');
};
