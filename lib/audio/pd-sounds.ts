// 배치한 소리(업로드한 mp3 등)를 Pd로 재생한다.
// - 원본은 지금처럼 맵 데이터 안의 mp3다(새로고침·내보내기와 함께 남는다). 엔진 디스크의 wav는 Pd가 읽을 임시 사본이다.
// - 소리마다 한 번: 브라우저가 풀고(decodeAudioData, 엔진과 같은 샘플레이트) 16비트 wav(모노는 모노, 스테레오는 스테레오)로
//   엔진 디스크에 쓰고, whistle-sound-bank로 "<이름> <경로>"를 보낸다. main.pd 안의 [pd sound_bank]가 [pd sounds]에
//   <이름>-L, <이름>-R 배열을 만들고 한 번 읽는다. 영역을 나갔다 들어와도 다시 읽지 않는다. 다른 필터도 같은 배열을 쓸 수 있다.
// - 재생 하나 = 슬롯 하나(placed_sound.pd): "set <이름>-L <이름>-R"(모노면 -L만)을 보낸다. 어떻게 재생할지는 패치가 정한다
//   (지금은 array_player~로, 가까우면 느리게 멀면 빠르게. paulstretch~ 버전은 placed_sound_paulstretch_example.pd).
// - 메모리가 차면 재생 중이 아닌 오래된 소리의 wav와 Pd 배열을 비운다.
import type { PdEngine, PdMessage } from "./pd-runtime.ts";
import { MAX_RECORDING_SECONDS, validRecording, type Recording } from "./recording.ts";

/**
 * 업로드한 소리가 엔진 메모리에서 쓸 수 있는 양(바이트). 엔진은 256MB로 고정이고(scripts/build-audio-engine.mjs),
 * 넘치면 엔진이 죽는다(OOM). 소리 하나 = wav 사본(16비트) + Pd 배열(32비트) = 샘플당 6바이트. 1분 스테레오 약 35MB.
 * 시험: 1분 스테레오 7개까지 됐고 8개째에 OOM. 넉넉히 남긴다. 재생 중인 소리는 유지하고 오래된 캐시부터 비운다.
 */
export const SOUND_MEMORY = 200_000_000;

/** 배치한 소리를 재생하는 슬롯 패치(audio/patches/placed_sound.pd) */
export const PLACED_PATCH = "placed_sound";
export type PlacedVoice = {
  /** 슬롯 이름(v17…) */ id: string;
  node: AudioNode;
  /** 소리를 끝까지 한 번 다 재생했을 때(placed_sound.pd가 [s $1-whistle-sound-end]로 알린다. 패치가 늘리거나 빠르게 해도 맞다) */
  onEnd(listener: () => void): void;
  /** 패치에 보낸다(placed_sound.pd의 [r $1-whistle-sound]: distance <타일> <반경>) */
  send(message: PdMessage): void;
  destroy(): void;
};
export type PlaySound = {
  /** 소리를 미리 풀어 main.pd의 [pd sound_bank]에 읽어 둔다(같은 소리는 한 번만) */
  prepare(recording: Recording): Promise<unknown>;
  play(recording: Recording): Promise<PlacedVoice>;
};

/** 16비트 PCM wav. 채널은 1개 또는 2개 */
export function wavFile(channels: Float32Array[], sampleRate: number) {
  const count = channels.length, length = channels[0]?.length ?? 0, size = length * count * 2;
  const bytes = new Uint8Array(44 + size);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i); };
  text(0, "RIFF"); view.setUint32(4, 36 + size, true); text(8, "WAVE");
  text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, count, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * count * 2, true);
  view.setUint16(32, count * 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, size, true);
  // 샘플을 Int16Array에 바로 쓴다(DataView로 하나씩 쓰면 1분 스테레오에 0.5초 넘게 걸린다). wav는 리틀엔디언, 브라우저도 리틀엔디언.
  const samples = new Int16Array(bytes.buffer, 44, length * count);
  for (let c = 0; c < count; c++) {
    const channel = channels[c];
    for (let i = 0, k = c; i < length; i++, k += count) {
      const v = channel[i];
      samples[k] = Math.round((v > 1 ? 1 : v < -1 ? -1 : v) * 32767);
    }
  }
  return bytes;
}

type SoundBankEngine = Pick<PdEngine, "context" | "start" | "send" | "forget" | "writeFile" | "removeFile">;
type SoundEntry = {
  ready: Promise<void>; name: string; path: string; stereo: boolean; size: number; users: number; touched: number;
};

export function createPdSounds(engine: SoundBankEngine, memoryLimit = SOUND_MEMORY): PlaySound {
  const sounds = new Map<string, SoundEntry>();
  let count = 0, used = 0, clock = 0;
  let queue: Promise<unknown> = Promise.resolve();
  const discard = (data: string, entry: SoundEntry) => {
    engine.send(`${entry.name}-L`, ["resize", 0], false);
    engine.send(`${entry.name}-R`, ["resize", 0], false);
    engine.forget("whistle-sound-bank", [entry.name]);
    engine.removeFile(entry.path);
    used -= entry.size;
    sounds.delete(data);
  };
  const get = (recording: Recording) => {
    const data = recording.data;
    let entry = sounds.get(data);
    if (!entry) {
      const name = `sound${++count}`;
      entry = { name, path: `uploads/${name}.wav`, stereo: false, size: 0, users: 0, touched: ++clock, ready: Promise.resolve() };
      const current = entry;
      current.ready = queue.then(async () => {
        if (!validRecording(recording)) throw new Error("사운드 파일을 읽을 수 없습니다.");
        const encoded = data.slice(data.indexOf(",") + 1);
        const fromBase64 = (Uint8Array as unknown as { fromBase64?: (text: string) => Uint8Array }).fromBase64;
        const bytes = fromBase64 ? fromBase64(encoded) : Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
        const buffer = await engine.context.decodeAudioData(bytes.buffer as ArrayBuffer);
        if (!Number.isFinite(buffer.duration) || buffer.duration < 0.01 || buffer.duration > MAX_RECORDING_SECONDS + 0.1 ||
            buffer.numberOfChannels < 1 || buffer.numberOfChannels > 2)
          throw new Error("사운드 길이 또는 채널 수가 지원 범위를 벗어났습니다.");
        const size = buffer.length * buffer.numberOfChannels * 6 + 44;
        if (size > memoryLimit) throw new Error("사운드를 재생할 메모리가 부족합니다.");
        for (const [key, old] of [...sounds].filter(([, item]) => item.size && !item.users).sort((a, b) => a[1].touched - b[1].touched)) {
          if (used + size <= memoryLimit) break;
          discard(key, old);
        }
        if (used + size > memoryLimit) throw new Error("사운드를 재생할 메모리가 부족합니다.");
        const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
        try {
          engine.writeFile(current.path, wavFile(channels, buffer.sampleRate));
          engine.send("whistle-sound-bank", [name, `/${current.path}`]);
        } catch (error) {
          engine.removeFile(current.path);
          throw error;
        }
        current.stereo = channels.length === 2;
        current.size = size;
        used += size;
      }).catch(error => {
        if (sounds.get(data) === current) sounds.delete(data);
        throw error;
      });
      queue = current.ready.catch(() => {});
      sounds.set(data, current);
    }
    entry.touched = ++clock;
    return entry;
  };
  return {
    prepare: recording => get(recording).ready,
    async play(recording) {
      const entry = get(recording);
      entry.users++;
      try {
        await entry.ready;
        const voice = await engine.start(PLACED_PATCH);
        try {
          voice.send("whistle-sound", entry.stereo ? ["set", `${entry.name}-L`, `${entry.name}-R`] : ["set", `${entry.name}-L`]);
        } catch (error) { voice.destroy(); throw error; }
        let destroyed = false;
        return { id: voice.id, node: voice.node, onEnd: (listener) => voice.onBang("whistle-sound-end", listener),
          send: (message) => voice.send("whistle-sound", message), destroy() {
            if (destroyed) return;
            destroyed = true;
            try { voice.destroy(); } finally { entry.users--; entry.touched = ++clock; }
          } };
      } catch (error) { entry.users--; throw error; }
    },
  };
}
