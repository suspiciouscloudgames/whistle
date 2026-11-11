import type { EditSound, PlayerSound, PdSession } from "./webpd-session.ts";

type Session = Pick<PdSession, "context" | "edit" | "player" | "stopPlayer" | "event" | "mute" | "close">;
export function createGameAudio(load: () => Promise<Session>, onError: (error: unknown) => void) {
  let session: Session | undefined;
  let loading: Promise<void> | undefined;
  let disposed = false, paused = false, playing = false;
  let pendingEdit: EditSound | undefined;
  let latestPlayer: PlayerSound | undefined;
  let pendingEvent: [number, number, number] | undefined;
  const safely = (action: () => void) => {
    try { action(); } catch (error) { onError(error); }
  };
  const flush = () => {
    if (!session || paused || disposed || (!playing && !pendingEdit)) return;
    session.mute(false);
    if (playing) {
      if (latestPlayer) session.player(latestPlayer);
      if (pendingEvent) { session.event(...pendingEvent); pendingEvent = undefined; }
    }
    else if (pendingEdit) { session.edit(pendingEdit); pendingEdit = undefined; }
  };
  const activate = () => {
    if (disposed) return;
    paused = false;
    if (session) {
      void session.context.resume().then(() => safely(flush)).catch(onError);
    } else if (!loading) {
      loading = load().then(async (created) => {
        if (disposed) { await created.close(); return; }
        session = created;
        safely(flush);
      }).catch((error) => {
        pendingEdit = undefined;
        if (!disposed) onError(error);
      }).finally(() => { loading = undefined; });
    }
  };
  const reset = () => {
    pendingEdit = undefined;
    latestPlayer = undefined;
    pendingEvent = undefined;
    safely(() => { session?.stopPlayer(); session?.mute(true); });
  };
  return {
    edit(sound: EditSound) {
      if (disposed) return;
      playing = false;
      pendingEdit = sound;
      activate();
    },
    play() { reset(); playing = true; activate(); },
    stop() { playing = false; reset(); },
    reset,
    movement(sound: PlayerSound) {
      if (!playing || paused || disposed) return;
      latestPlayer = sound;
      safely(() => session?.player(sound));
    },
    event(frequency: number, gain: number, pan: number) {
      if (!playing || paused || disposed) return;
      if (session) safely(() => session?.event(frequency, gain, pan));
      else pendingEvent = [frequency, gain, pan];
    },
    pause() { paused = true; reset(); },
    resume() { if (paused && (session || loading)) activate(); },
    dispose() {
      disposed = true;
      reset();
      void session?.close().catch(onError);
      session = undefined;
    },
  };
}
