import { createPdSession, type PdSession } from "./webpd-session.ts";
import { playerSound, type PlayerAudioFrame } from "./game-parameters.ts";
import type { Peer } from "../multiplayer/protocol.ts";
import { createMultiplayerInteraction, interactionSound } from "./multiplayer-interaction.ts";

export function soundPosition(frame: PlayerAudioFrame) {
  return { x: frame.x * 2 - frame.size + 1, y: frame.y + 0.7, z: frame.z * 2 - frame.size + 1 };
}
export function remoteFrequency(frame: PlayerAudioFrame) {
  return 220 + 220 * ((frame.z + 0.5) / frame.size) + 220 * frame.grass + 440 * frame.rough + 110 * frame.water;
}

type Voice = { panner: PannerNode; gain: GainNode; session?: PdSession; cancelled: boolean; last?: PlayerAudioFrame };
export function createRemoteAudio(getContext: () => AudioContext | undefined, report: () => void, onInteraction: (active: boolean) => void) {
  const voices = new Map<string, Voice>();
  const retries = new Map<string, number>();
  let peers: Peer[] = [], self = "", playing = false, paused = false, disposed = false;
  let listener: PlayerAudioFrame | undefined;
  let master: GainNode | undefined;
  let level = 0.65;
  const interaction = createMultiplayerInteraction(report, onInteraction);
  const target = (param: AudioParam, value: number, context: AudioContext, smoothing = 0.04) => param.setTargetAtTime(value, context.currentTime, smoothing);
  const stop = (id: string, voice: Voice) => {
    voices.delete(id); voice.cancelled = true;
    const context = voice.gain.context;
    voice.gain.gain.setTargetAtTime(0, context.currentTime, 0.04);
    setTimeout(() => {
      void voice.session?.close().catch(() => {});
      voice.panner.disconnect(); voice.gain.disconnect();
    }, 200);
  };
  const tick = () => {
    const context = getContext();
    const audible = playing && !paused && !disposed && context?.state === "running";
    if (audible && context && listener && self) interaction.update(context, interactionSound(peers, self, listener));
    else interaction.stop();
    const wanted = new Map(audible ? peers.filter(p => p.id !== self && p.mode === "play" && p.active && p.frame).map(p => [p.id, p]) : []);
    for (const [id, voice] of voices) if (!wanted.has(id)) stop(id, voice);
    if (!audible || !context || !listener) return;
    if (!master || master.context !== context) {
      master?.disconnect();
      master = context.createGain(); master.gain.value = level; master.connect(context.destination);
    }
    const at = soundPosition(listener), pitch = listener.pitch ?? 0, yaw = listener.yaw;
    const ear = context.listener;
    target(ear.positionX, at.x, context); target(ear.positionY, listener.eyeY ?? listener.y + 1.35, context); target(ear.positionZ, at.z, context);
    target(ear.forwardX, Math.sin(yaw) * Math.cos(pitch), context); target(ear.forwardY, Math.sin(pitch), context); target(ear.forwardZ, -Math.cos(yaw) * Math.cos(pitch), context);
    target(ear.upX, -Math.sin(yaw) * Math.sin(pitch), context); target(ear.upY, Math.cos(pitch), context); target(ear.upZ, Math.cos(yaw) * Math.sin(pitch), context);
    for (const [id, peer] of wanted) {
      const frame = peer.frame!;
      let voice = voices.get(id);
      if (!voice) {
        if ((retries.get(id) ?? 0) > performance.now()) continue;
        const panner = context.createPanner();
        // WebPd always exposes two channels, even for dac~ 1. Downmix before
        // spatializing so the unused right channel cannot bias the source left.
        panner.channelCount = 1; panner.channelCountMode = "explicit";
        panner.panningModel = "HRTF"; panner.distanceModel = "inverse";
        panner.refDistance = 2; panner.rolloffFactor = 1; panner.maxDistance = 100;
        const gain = context.createGain(); gain.gain.value = 0;
        panner.connect(gain); gain.connect(master);
        voice = { panner, gain, cancelled: false }; voices.set(id, voice);
        const ownedVoice = voice;
        const base = `${import.meta.env.BASE_URL}audio-test/`;
        void createPdSession(`${base}remote/`, () => {}, { context, destination: panner, runtimeUrl: `${base}webpd-runtime.js` }).then(session => {
          if (ownedVoice.cancelled || disposed) { void session.close(); return; }
          ownedVoice.session = session; session.mute(false);
        }).catch(() => {
          if (ownedVoice.cancelled || disposed) return;
          stop(id, ownedVoice); retries.set(id, performance.now() + 5000); report();
        });
      }
      const position = soundPosition(frame);
      target(voice.panner.positionX, position.x, context, 0.08);
      target(voice.panner.positionY, position.y, context, 0.08);
      target(voice.panner.positionZ, position.z, context, 0.08);
      target(voice.gain.gain, voice.session ? 1 / Math.sqrt(Math.max(1, wanted.size)) : 0, context, 0.06);
      if (voice.session && voice.last !== frame) {
        voice.session.player(playerSound(frame)); voice.last = frame;
      }
    }
  };
  const interval = setInterval(tick, 40);
  return {
    peers(next: Peer[], ownId: string) { peers = next; self = ownId; tick(); },
    listener(frame: PlayerAudioFrame) { listener = frame; },
    play() { playing = true; paused = false; },
    stop() { playing = false; listener = undefined; tick(); },
    pause() { paused = true; tick(); },
    resume() { paused = false; },
    volume(value: number) { level = Math.max(0, Math.min(1, value)); if (master) target(master.gain, level, master.context as AudioContext); },
    dispose() { disposed = true; clearInterval(interval); interaction.stop(); for (const [id, voice] of voices) stop(id, voice); const output = master; setTimeout(() => output?.disconnect(), 250); },
  };
}
