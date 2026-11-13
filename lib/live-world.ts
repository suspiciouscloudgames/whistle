export const LIVE_WORLD_QUERY = "uwbSession";

export function liveWorldChannel(session: string | null) {
  return session && /^[a-zA-Z0-9-]{1,80}$/.test(session)
    ? `whistle.live-world.v1.${session}` : null;
}
