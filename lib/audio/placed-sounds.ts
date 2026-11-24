import type { Actor, World } from "../world.ts";
import type { PlayerAudioFrame } from "./game-parameters.ts";
import { MAX_SOUND_VOICES, type Recording } from "./recording.ts";
import type { PlacedVoice, PlaySound } from "./pd-sounds.ts";
import type { Environment } from "../environment.ts";
import { soundRangeAt } from "./sound-range.ts";

type Nearby = { id: string; recording: Recording; radius: number; distance: number; gain: number; pan: number };
type Voice = { sound: PlacedVoice; gain: GainNode; pan: StereoPannerNode; recording: Recording };

export function nearbySounds(world: World, actors: Actor[], player: PlayerAudioFrame, environment?: Environment): Nearby[] {
  return actors.flatMap(actor => {
    const recording = world.assets.find(asset => asset.id === actor.asset)?.sound;
    if (actor.removed || !recording) return [];
    const dx = actor.x - player.x, dz = actor.z - player.z;
    const distance = Math.hypot(dx, dz);
    const angle = Math.atan2(dx, -dz) - player.yaw;
    const radius = soundRangeAt(environment, actor.x, actor.z);
    return [{ id: actor.id, recording, radius, distance,
      gain: recording.volume * Math.max(0, 1 - distance / radius) ** 2 * 0.25,
      pan: Math.sin(angle) }];
  }).sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
}

/**
 * 가까운 배치 소리를 최대 MAX_SOUND_VOICES개 재생한다. 소리는 play(Pd 슬롯, pd-sounds.ts)가 만들고,
 * 거리에 따른 크기(gain)와 좌우(pan)는 여기서 붙인다. "approach"는 한 번 재생하고(패치가 끝을 알린다), 반경을 벗어나야 다시 울린다.
 */
export function createPlacedSounds(context: AudioContext, onError: () => void, output: AudioNode, play: PlaySound) {
  const voices = new Map<string, Voice>();
  const pending = new Map<string, { token: symbol; recording: Recording }>();
  const failed = new Set<string>();
  const played = new Map<string, string>();
  let wanted: Nearby[] = [], generation = 0;
  const stopVoice = (id: string) => {
    const voice = voices.get(id);
    if (!voice) return;
    voice.sound.node.disconnect(); voice.gain.disconnect(); voice.pan.disconnect();
    voice.sound.destroy();
    voices.delete(id);
  };
  const start = (item: Nearby) => {
    if (voices.has(item.id) || pending.has(item.id) || voices.size + pending.size >= MAX_SOUND_VOICES || context.state !== "running") return;
    if (item.recording.mode === "approach" && played.has(item.id)) return;
    const request = generation, token = Symbol();
    pending.set(item.id, { token, recording: item.recording });
    play.play(item.recording).then((sound) => {
      if (pending.get(item.id)?.token !== token) { sound.destroy(); return; }
      pending.delete(item.id);
      const current = wanted.find(next => next.id === item.id && sameRecording(next.recording, item.recording));
      if (generation !== request || !current || voices.has(item.id) || context.state !== "running") { sound.destroy(); return; }
      const gain = context.createGain(), pan = context.createStereoPanner();
      gain.gain.setValueAtTime(0, context.currentTime);
      gain.gain.setTargetAtTime(current.gain, context.currentTime, 0.04);
      pan.pan.value = current.pan;
      sound.node.connect(gain).connect(pan).connect(output);
      const voice: Voice = { sound, gain, pan, recording: item.recording };
      sound.send(["distance", current.distance, current.radius]);
      if (item.recording.mode === "approach") {
        played.set(item.id, item.recording.data);
        sound.onEnd(() => { if (voices.get(item.id) === voice) stopVoice(item.id); });
      }
      voices.set(item.id, voice);
    }, () => {
      if (pending.get(item.id)?.token !== token) return;
      pending.delete(item.id);
      if (generation === request) { failed.add(item.recording.data); onError(); }
    });
  };
  return {
    update(world: World, actors: Actor[], player: PlayerAudioFrame, environment?: Environment) {
      const candidates = nearbySounds(world, actors, player, environment);
      for (const [id, data] of played) {
        const item = candidates.find(item => item.id === id);
        if (!item || item.recording.data !== data || item.recording.mode !== "approach" || item.distance > item.radius + 0.5) played.delete(id);
      }
      wanted = candidates.filter(item => item.gain > 0 && !failed.has(item.recording.data) &&
        (item.recording.mode === "loop" || !played.has(item.id) || voices.has(item.id))).slice(0, MAX_SOUND_VOICES);
      for (const [id, voice] of voices) if (!wanted.some(item => item.id === id && sameRecording(item.recording, voice.recording))) stopVoice(id);
      for (const [id, request] of pending) if (!wanted.some(item => item.id === id && sameRecording(item.recording, request.recording))) pending.delete(id);
      for (const item of wanted) {
        const voice = voices.get(item.id);
        if (voice) {
          voice.gain.gain.setTargetAtTime(item.gain, context.currentTime, 0.06);
          voice.pan.pan.setTargetAtTime(item.pan, context.currentTime, 0.06);
          // 플레이어까지 거리(타일)와 들리는 반경. 패치가 재생 빠르기 등에 쓴다
          voice.sound.send(["distance", item.distance, item.radius]);
        } else start(item);
      }
    },
    /** 디버그용: 지금 고른 소리와 상태(loading: 슬롯 여는 중, playing) */
    snapshot() {
      return wanted.map(item => {
        const voice = voices.get(item.id);
        return { id: item.id, slot: voice?.sound.id ?? "-", distance: item.distance, gain: item.gain, pan: item.pan,
          mode: item.recording.mode, state: voice ? "playing" : pending.has(item.id) ? "loading" : "waiting" };
      });
    },
    stop(reset = true) {
      generation++;
      wanted = [];
      for (const id of voices.keys()) stopVoice(id);
      pending.clear();
      if (reset) { played.clear(); failed.clear(); }
    },
  };
}

function sameRecording(a: Recording, b: Recording) {
  return a.data === b.data && a.mode === b.mode;
}
