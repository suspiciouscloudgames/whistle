export type PdMessage = (string | number)[];
type Port = { nodeId: string; portletId: string };
type Manifest = { inputs: Record<string, Port>; outputs: Record<string, Port> };
type PdNode = AudioWorkletNode & { destroy(): void };
type Runtime = {
  initialize(context: AudioContext): Promise<void>;
  run(context: AudioContext, patch: ArrayBuffer, settings: {
    messageHandler(node: PdNode, event: MessageEvent): void;
  }): Promise<PdNode>;
};

declare global {
  interface Window { WebPdRuntime: Runtime }
}

let runtimeLoading: Promise<void> | undefined;
function loadRuntime(url: string) {
  return runtimeLoading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      runtimeLoading = undefined;
      reject(new Error("WebPd 런타임을 불러오지 못했습니다."));
    };
    document.head.append(script);
  });
}

export type EditSound = {
  x: number; z: number; overlap: number;
  asset?: string; action?: string; surface?: string;
};
export type PlayerSound = {
  x: number; y: number; z: number; grass: number; rough: number;
  grounded?: boolean; falling?: boolean; yaw?: number; water?: number;
};

export function validateBoardHeight(height: number) {
  if (!Number.isFinite(height) || height < 0 || height > 10) {
    throw new Error("보드 높이는 0~10m 사이의 유한한 숫자여야 합니다.");
  }
  return height;
}

const bounded = (value: number, min: number, max: number) => {
  if (!Number.isFinite(value)) throw new Error("오디오 파라미터는 유한한 숫자여야 합니다.");
  return Math.max(min, Math.min(max, value));
};

export async function createPdSession(
  baseUrl: string,
  receive: (bus: string, message: PdMessage) => void,
) {
  const context = new AudioContext();
  let node: PdNode | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await context.resume();
    const [patchResponse, ioResponse] = await Promise.all([
      fetch(`${baseUrl}patch.wasm`), fetch(`${baseUrl}io.json`),
    ]);
    if (!patchResponse.ok || !ioResponse.ok) throw new Error("Pd 패치를 불러오지 못했습니다.");
    const [patch, manifest]: [ArrayBuffer, Manifest] = await Promise.all([
      patchResponse.arrayBuffer(), ioResponse.json(),
    ]);
    await loadRuntime(`${baseUrl}webpd-runtime.js`);
    await window.WebPdRuntime.initialize(context);
    let markReady!: () => void;
    let failReady!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
      markReady = resolve;
      failReady = reject;
      timer = setTimeout(() => reject(new Error("Pd 패치 시작 응답이 없습니다.")), 8000);
    });
    node = await window.WebPdRuntime.run(context, patch, {
      messageHandler(_node, event) {
        if (event.data.type !== "io:messageSender") return;
        const { nodeId, portletId, message } = event.data.payload;
        const bus = Object.keys(manifest.outputs).find((name) => {
          const port = manifest.outputs[name];
          return port.nodeId === nodeId && port.portletId === portletId;
        });
        if (bus === "whistle-ready") markReady();
        if (bus) receive(bus, message);
      },
    });
    node.onprocessorerror = () => failReady(new Error("Pd 오디오 프로세서 오류"));
    node.connect(context.destination);
    await ready;
    clearTimeout(timer);
    let closed = false;
    const send = (bus: string, message: PdMessage) => {
      if (closed) throw new Error("종료된 오디오 세션입니다.");
      const port = manifest.inputs[bus];
      if (!port) throw new Error(`Pd 수신 포트가 없습니다: ${bus}`);
      node!.port.postMessage({ type: "io:messageReceiver", payload: { ...port, message } });
    };
    return {
      context,
      node,
      edit({ x, z, overlap, asset, action, surface }: EditSound) {
        send("whistle-edit", [bounded(x, 0, 1), bounded(z, 0, 1), bounded(overlap, 0, 1),
          ...(asset === undefined ? [] : [asset, action ?? "paint", surface ?? "plain"])]);
      },
      player({ x, y, z, grass, rough, grounded, falling, yaw, water }: PlayerSound) {
        send("whistle-player", [
          bounded(x, 0, 1), bounded(y, -1000, 1000), bounded(z, 0, 1),
          bounded(grass, 0, 1), bounded(rough, 0, 1),
          ...(grounded === undefined ? [] : [Number(grounded), Number(!!falling),
            bounded(yaw ?? 0, -1e6, 1e6), bounded(water ?? 0, 0, 1)]),
        ]);
      },
      stopPlayer() { send("whistle-player-stop", ["bang"]); },
      boardHeight(height: number) { send("whistle-board-height", [validateBoardHeight(height)]); },
      event(frequency: number, gain: number, pan: number) {
        send("whistle-event", [bounded(frequency, 20, 20000), bounded(gain, 0, 0.12), bounded(pan, -1, 1)]);
      },
      mute(muted: boolean) { send("whistle-gate", [muted ? 0 : 1]); },
      async close() {
        if (closed) return;
        closed = true;
        node!.destroy();
        node!.disconnect();
        node!.port.close();
        await context.close();
      },
    };
  } catch (error) {
    clearTimeout(timer);
    node?.destroy();
    node?.disconnect();
    node?.port.close();
    await context.close();
    throw error;
  }
}

export type PdSession = Awaited<ReturnType<typeof createPdSession>>;
