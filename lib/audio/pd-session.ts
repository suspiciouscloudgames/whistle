// 상호작용 패치들의 버스 인터페이스. pd4web 엔진의 슬롯에 하나씩 띄운다(lib/audio/pd-runtime.ts).
// - edit.pd   : whistle-edit           (에디터 편집음)
// - player.pd : whistle-player, whistle-board-height (3D 이동음, UWB 보드 높이)
//   whistle-player는 메시지 네 개로 보낸다(Pd에서 [route position yaw stat footed]):
//   position x y z · yaw a · stat crouch run grounded falling · footed grass water
// - event.pd  : whistle-event          (시뮬레이션 규칙 이벤트음)
// 켜고 끄기는 Pd 메시지(whistle-gate, whistle-player-stop) 대신 WebAudio 게인 fade로 한다.
import type { PdMessage, PatchInstance, PdEngine } from "./pd-runtime.ts";

export type { PdMessage };
export const INTERACTION_PATCHES = { edit: "edit", player: "player", event: "event" } as const;

/** 음소거·이동음 정지 fade 길이(초) */
const FADE = 0.03;

export type EditSound = {
  x: number; z: number; overlap: number;
  asset?: string; action?: string; surface?: string;
};
export type PlayerSound = {
  x: number; y: number; z: number; yaw?: number;
  crouch?: boolean; run?: boolean; grounded?: boolean; falling?: boolean;
  /** 발밑 풀 농도 0~1, 발이 물속이면 1 */
  grass: number; water?: number;
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

type Sender = Pick<PatchInstance, "send">;

/** 버스별 메시지를 값 검사와 함께 해당 패치로 보낸다. */
export function interactionMessages(patches: { edit: Sender; player: Sender; event: Sender }) {
  return {
    edit({ x, z, overlap, asset, action, surface }: EditSound) {
      patches.edit.send("whistle-edit", [bounded(x, 0, 1), bounded(z, 0, 1), bounded(overlap, 0, 1),
        ...(asset === undefined ? [] : [asset, action ?? "paint", surface ?? "plain"])]);
    },
    player({ x, y, z, yaw = 0, crouch, run, grounded, falling, grass, water = 0 }: PlayerSound) {
      const send = (message: PdMessage) => patches.player.send("whistle-player", message);
      send(["position", bounded(x, 0, 1), bounded(y, -1000, 1000), bounded(z, 0, 1)]);
      send(["yaw", bounded(yaw, -1e6, 1e6)]);
      send(["stat", Number(!!crouch), Number(!!run), Number(!!grounded), Number(!!falling)]);
      send(["footed", bounded(grass, 0, 1), bounded(water, 0, 1)]);
    },
    boardHeight(height: number) { patches.player.send("whistle-board-height", [validateBoardHeight(height)]); },
    event(frequency: number, gain: number, pan: number) {
      patches.event.send("whistle-event", [bounded(frequency, 20, 20000), bounded(gain, 0, 0.12), bounded(pan, -1, 1)]);
    },
    meteor(on: boolean) { patches.event.send("whistle-event", ["fallingstar", Number(on)]); },
  };
}

function fadeTo(param: AudioParam, target: number, context: BaseAudioContext) {
  const now = context.currentTime;
  const current = param.value;
  param.cancelScheduledValues(now);
  param.setValueAtTime(current, now);
  param.linearRampToValueAtTime(target, now + FADE);
}

/**
 * 상호작용 패치 세 개를 엔진에 띄운다.
 * receive: Pd에 보낸 메시지(버스, 값)를 보낸 직후 알려준다(실험 페이지의 "Pd가 수신한 값" 표시용).
 * 출력: edit/event → 세션 출력 게인, player → 이동음 게인 → 세션 출력 게인 → output(없으면 destination).
 * close()는 패치만 내린다(엔진·AudioContext는 페이지와 함께 계속 산다).
 */
export async function createInteractionSession(
  engine: Pick<PdEngine, "context" | "start">,
  receive?: (bus: string, message: PdMessage) => void,
  destination?: AudioNode,
) {
  const context = engine.context;
  const started: PatchInstance[] = [];
  try {
    await context.resume();
    for (const name of [INTERACTION_PATCHES.edit, INTERACTION_PATCHES.player, INTERACTION_PATCHES.event]) {
      started.push(await engine.start(name));
    }
    // 선택자가 있는 메시지는 "버스 선택자"로 알려 준다(예: "whistle-player position" → [x, y, z]).
    const echo = (patch: PatchInstance): Sender => ({
      send(bus, message) {
        patch.send(bus, message);
        if (typeof message[0] === "string") receive?.(`${bus} ${message[0]}`, message.slice(1));
        else receive?.(bus, message);
      },
    });
    const [edit, player, event] = started.map(echo);
    const output = context.createGain();
    const playerGain = context.createGain();
    output.connect(destination ?? context.destination);
    started[0].node.connect(output);
    started[2].node.connect(output);
    started[1].node.connect(playerGain).connect(output);
    const messages = interactionMessages({ edit, player, event });
    let playerOn = true;
    let closed = false;
    return {
      context,
      /** 세션 전체 출력(측정·연결용) */
      node: output,
      ...messages,
      player(sound: PlayerSound) {
        messages.player(sound);
        if (!playerOn) { playerOn = true; fadeTo(playerGain.gain, 1, context); }
      },
      /** 3D 이동음만 끈다. 다음 player() 때 다시 켠다. */
      stopPlayer() {
        if (!playerOn) return;
        playerOn = false;
        fadeTo(playerGain.gain, 0, context);
      },
      /** 세션 전체 음소거(편집음·이동음·이벤트음) */
      mute(muted: boolean) { fadeTo(output.gain, muted ? 0 : 1, context); },
      async close() {
        if (closed) return;
        closed = true;
        for (const patch of started) patch.destroy();
        output.disconnect();
      },
    };
  } catch (error) {
    for (const patch of started) patch.destroy();
    throw error;
  }
}

export type InteractionSession = Awaited<ReturnType<typeof createInteractionSession>>;
