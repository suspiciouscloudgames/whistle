import { createPdSession, type PdSession, type InteractionSound } from "./webpd-session.ts";
import type { PlayerAudioFrame } from "./game-parameters.ts";
import type { Peer } from "../multiplayer/protocol.ts";

export function interactionSound(peers: Peer[], self: string, listener: PlayerAudioFrame): InteractionSound {
  const others = peers.filter(peer => peer.id !== self && peer.mode === "play" && peer.active && peer.frame);
  const nearest = others.reduce((distance, peer) => {
    const frame = peer.frame!;
    return Math.min(distance, Math.hypot(frame.x - listener.x, frame.z - listener.z, (frame.y - listener.y) / 2));
  }, Infinity);
  return { players: others.length + 1, proximity: Math.max(0, 1 - nearest / 8) };
}

type Voice = { gain: GainNode; session?: PdSession; cancelled: boolean; values: InteractionSound; sent?: string };

// Transport/lifecycle only. All count-to-harmony and rhythm design lives in Pd.
export function createMultiplayerInteraction(report: () => void, onActive: (active: boolean) => void) {
  let voice: Voice | undefined, retryAt = 0;
  const stop = () => {
    if (!voice) return;
    const previous = voice; voice = undefined; previous.cancelled = true;
    previous.gain.gain.setTargetAtTime(0, previous.gain.context.currentTime, 0.04);
    onActive(false);
    setTimeout(() => {
      void previous.session?.close().catch(() => {});
      previous.gain.disconnect();
    }, 200);
  };
  const apply = (current: Voice) => {
    const signature = JSON.stringify(current.values);
    if (current.session && current.sent !== signature) {
      current.session.interaction(current.values);
      current.sent = signature;
    }
  };
  return {
    update(context: AudioContext, values: InteractionSound) {
      if (voice && voice.gain.context !== context) stop();
      if (!voice) {
        if (performance.now() < retryAt) return;
        const gain = context.createGain(); gain.gain.value = 0; gain.connect(context.destination);
        const current: Voice = { gain, values, cancelled: false }; voice = current;
        const base = `${import.meta.env.BASE_URL}audio-test/`;
        void createPdSession(`${base}multiplayer-interaction/`, () => {}, {
          context, destination: gain, runtimeUrl: `${base}webpd-runtime.js`,
        }).then(session => {
          if (current.cancelled) { void session.close().catch(() => {}); return; }
          current.session = session;
          apply(current);
          session.mute(false);
          onActive(true);
          gain.gain.setTargetAtTime(1, context.currentTime, 0.06);
        }).catch(() => {
          if (current.cancelled) return;
          stop(); retryAt = performance.now() + 5000; report();
        });
      }
      voice.values = values;
      apply(voice);
    },
    stop,
  };
}
