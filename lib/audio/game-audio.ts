import type { EditSound, PlayerSound, InteractionSession } from "./pd-session.ts";

/** pause 후 이만큼(ms) 지나도 그대로면 AudioContext를 멈춘다(음소거 fade가 끝난 뒤). */
const SUSPEND_DELAY_MS = 150;

type Session = Pick<InteractionSession, "context" | "edit" | "player" | "stopPlayer" | "event" | "meteor" | "mute" | "close">;
export function createGameAudio(load: () => Promise<Session>, onError: (error: unknown) => void) {
  let session: Session | undefined;
  let loading: Promise<void> | undefined;
  let disposed = false, paused = false, playing = false;
  let pendingEdit: EditSound | undefined;
  let latestPlayer: PlayerSound | undefined;
  let pendingEvent: [number, number, number] | undefined;
  let latestMeteor = false, sentMeteor: boolean | undefined;
  const flushMeteor = () => {
    if (!session || sentMeteor === latestMeteor) return;
    session.meteor(latestMeteor);
    sentMeteor = latestMeteor;
  };
  // 탭을 보지 않을 때(blur·숨김)는 음소거만으로는 부족하다: 패치 wasm이 오디오 스레드에서 계속 돈다.
  // AudioContext를 suspend해 모든 패치(상호작용·사운드스케이프)의 처리를 멈추고, activate()의 resume()으로 다시 켠다.
  let suspendTimer: ReturnType<typeof setTimeout> | undefined;
  const cancelSuspend = () => { clearTimeout(suspendTimer); suspendTimer = undefined; };
  const scheduleSuspend = () => {
    cancelSuspend();
    suspendTimer = setTimeout(() => {
      suspendTimer = undefined;
      if (paused && session && !disposed) void session.context.suspend?.().catch(onError);
    }, SUSPEND_DELAY_MS);
  };
  const safely = (action: () => void) => {
    try { action(); } catch (error) { onError(error); }
  };
  const flush = () => {
    if (!session || paused || disposed || (!playing && !pendingEdit)) return;
    session.mute(false);
    if (playing) {
      flushMeteor();
      if (latestPlayer) session.player(latestPlayer);
      if (pendingEvent) { session.event(...pendingEvent); pendingEvent = undefined; }
    }
    else if (pendingEdit) { session.edit(pendingEdit); pendingEdit = undefined; }
  };
  const activate = () => {
    if (disposed) return;
    paused = false;
    cancelSuspend();
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
    latestMeteor = false;
    safely(flushMeteor);
    safely(() => { session?.stopPlayer(); session?.mute(true); });
  };
  return {
    edit(sound: EditSound) {
      if (disposed) return;
      playing = false;
      latestMeteor = false;
      safely(flushMeteor);
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
    meteor(on: boolean) {
      if (!playing || paused || disposed) return;
      latestMeteor = on;
      safely(flushMeteor);
    },
    pause() { paused = true; reset(); scheduleSuspend(); },
    resume() { if (paused && (session || loading)) activate(); },
    dispose() {
      disposed = true;
      cancelSuspend();
      reset();
      void session?.close().catch(onError);
      session = undefined;
    },
  };
}
