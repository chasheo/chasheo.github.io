// A pages.dev entry point for networks that cannot reach workers.dev.
// The existing Worker remains the sole authority for route and origin checks.
export default {
  fetch(request, env) {
    return env.GAME_GATEWAY.fetch(request);
  }
};
