import type { EditSound, GameEvent, PlayerSound, InteractionSession } from "./pd-session.ts";

/** pause 후 이만큼(ms) 지나도 그대로면 AudioContext를 멈춘다(음소거 fade가 끝난 뒤). */
const SUSPEND_DELAY_MS = 150;

type Session = Pick<InteractionSession, "context" | "edit" | "player" | "stopPlayer" | "event" | "whistle" | "mute" | "close">;
export function createGameAudio(load: () => Promise<Session>, onError: (error: unknown) => void) {
  let session: Session | undefined;
  let loading: Promise<void> | undefined;
  let disposed = false, paused = false, playing = false;
  let pendingEdit: EditSound | undefined;
  let latestPlayer: PlayerSound | undefined;
  /** 플레이 중 켜고 끈 이벤트의 마지막 값. 엔진이 늦게 열리거나 다시 켜질 때(resume) 다시 보낸다. */
  const latestEvents = new Map<GameEvent, boolean>();
  const sentEvents = new Map<GameEvent, boolean>();
  let pendingWhistle: { gain: number; pan: number; at: number } | undefined;
  const sendEvent = (name: GameEvent, on: boolean) => {
    if (!session || sentEvents.get(name) === on) return;
    session.event(name, on);
    sentEvents.set(name, on);
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
      if (latestPlayer) session.player(latestPlayer);
      for (const [name, on] of latestEvents) sendEvent(name, on);
      if (pendingWhistle && performance.now() - pendingWhistle.at < 1500) session.whistle(pendingWhistle.gain, pendingWhistle.pan);
      pendingWhistle = undefined;
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
        if (paused || (!playing && !pendingEdit)) session.mute(true);
        if (paused) scheduleSuspend();
        safely(flush);
      }).catch((error) => {
        pendingEdit = undefined;
        if (!disposed) onError(error);
      }).finally(() => { loading = undefined; });
    }
  };
  const reset = (keepEvents = false) => {
    pendingEdit = undefined;
    latestPlayer = undefined;
    pendingWhistle = undefined;
    safely(() => { for (const name of sentEvents.keys()) sendEvent(name, false); });
    if (!keepEvents) latestEvents.clear();
    else if (latestEvents.has("fallingstar")) latestEvents.set("fallingstar", false);
    safely(() => { session?.stopPlayer(); session?.mute(true); });
  };
  return {
    edit(sound: EditSound) {
      if (disposed) return;
      if (playing) reset();
      playing = false;
      pendingEdit = sound;
      activate();
    },
    play() { reset(); latestEvents.clear(); playing = true; activate(); },
    stop() { playing = false; reset(); latestEvents.clear(); },
    reset,
    movement(sound: PlayerSound) {
      if (!playing || paused || disposed) return;
      latestPlayer = sound;
      safely(() => session?.player(sound));
    },
    event(name: GameEvent, on: boolean) {
      if (!playing || disposed) return;
      latestEvents.set(name, on);
      if (!paused) safely(() => sendEvent(name, on));
    },
    whistle(gain: number, pan: number) {
      if (!playing || paused || disposed) return;
      if (session) safely(() => session?.whistle(gain, pan));
      else pendingWhistle = { gain, pan, at: performance.now() };
    },
    pause() { paused = true; reset(true); scheduleSuspend(); },
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
