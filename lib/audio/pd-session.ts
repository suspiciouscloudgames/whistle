// 상호작용 패치들의 버스 인터페이스. 패치는 main.pd 안에 있다(audio/main-pd.md). JS는 전역 버스로 보내기만 한다.
// - edit.pd   : whistle-edit           (에디터 편집음)
// - player.pd : whistle-player, whistle-board-height (3D 이동음, UWB 보드 높이)
//   whistle-player는 메시지 네 개로 보낸다(Pd에서 [route position yaw stat footed]):
//   position x y z · yaw a · stat crouch run grounded falling · footed grass water · speed v(칸/초)
// - event.pd  : whistle-event          (게임 이벤트: fallingstar 0/1, rain 0/1. Pd에서 [route fallingstar rain])
// - 3D 이동음 정지: whistle-player-stop (bang). 다음 whistle-player 메시지부터 다시 소리를 내는 것은 패치가 한다.
// 출력은 main.pd의 믹스다운(채널 1–2). 음소거는 그 게인 fade로 한다.
import type { PdMessage, PdEngine } from "./pd-runtime.ts";

export type { PdMessage };

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
  /** 땅 위에서 움직이는 빠르기(칸/초, 수평). 있으면 whistle-player speed로 보낸다 */
  speed?: number;
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

type Sender = { send(bus: string, message: PdMessage): void };

/** whistle-event로 보내는 이벤트 이름 */
export type GameEvent = "fallingstar" | "rain";

/** 버스별 메시지를 값 검사와 함께 해당 패치로 보낸다. */
export function interactionMessages(patches: { edit: Sender; player: Sender; event: Sender }) {
  return {
    edit({ x, z, overlap, asset, action, surface }: EditSound) {
      patches.edit.send("whistle-edit", [bounded(x, 0, 1), bounded(z, 0, 1), bounded(overlap, 0, 1),
        ...(asset === undefined ? [] : [asset, action ?? "paint", surface ?? "plain"])]);
    },
    player({ x, y, z, yaw = 0, crouch, run, grounded, falling, grass, water = 0, speed }: PlayerSound) {
      const send = (message: PdMessage) => patches.player.send("whistle-player", message);
      send(["position", bounded(x, 0, 1), bounded(y, -1000, 1000), bounded(z, 0, 1)]);
      send(["yaw", bounded(yaw, -1e6, 1e6)]);
      send(["stat", Number(!!crouch), Number(!!run), Number(!!grounded), Number(!!falling)]);
      send(["footed", bounded(grass, 0, 1), bounded(water, 0, 1)]);
      if (speed !== undefined) send(["speed", bounded(speed, 0, 1000)]);
    },
    boardHeight(height: number) { patches.player.send("whistle-board-height", [validateBoardHeight(height)]); },
    /** 게임 이벤트 켬(1)/끔(0). fallingstar: 디버그 화면의 1 키(누를 때마다 번갈아). rain: 날씨가 비이면 1, 아니면 0. */
    event(name: GameEvent, on: boolean) { patches.event.send("whistle-event", [name, on ? 1 : 0]); },
    whistle(gain: number, pan: number) { patches.event.send("whistle-blow", [bounded(gain, 0, 1), bounded(pan, -1, 1)]); },
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
 * 상호작용 패치(main.pd 안)에 보내는 세션.
 * receive: Pd에 보낸 메시지(버스, 값)를 보낸 직후 알려준다(실험 페이지의 "Pd가 수신한 값" 표시용).
 * 출력: 엔진 믹스다운 → 세션 출력 게인 → destination(없으면 스피커).
 * close()는 출력만 뗀다(엔진·main.pd·AudioContext는 페이지와 함께 계속 산다).
 */
export async function createInteractionSession(
  engine: Pick<PdEngine, "context" | "send" | "mixdown">,
  receive?: (bus: string, message: PdMessage) => void,
  destination?: AudioNode,
) {
  const context = engine.context;
  await context.resume();
  // 선택자가 있는 메시지는 "버스 선택자"로 알려 준다(예: "whistle-player position" → [x, y, z]).
  const sender: Sender = {
    send(bus, message) {
      engine.send(bus, message);
      if (typeof message[0] === "string") receive?.(`${bus} ${message[0]}`, message.slice(1));
      else receive?.(bus, message);
    },
  };
  const output = context.createGain();
  output.connect(destination ?? context.destination);
  engine.mixdown.connect(output);
  const messages = interactionMessages({ edit: sender, player: sender, event: sender });
  let closed = false;
  return {
    context,
    /** 세션 전체 출력(측정·연결용) */
    node: output,
    ...messages,
    /** 3D 이동음만 끈다(whistle-player-stop). 다음 player() 때 다시 켜는 것은 패치가 한다. */
    stopPlayer() { sender.send("whistle-player-stop", ["bang"]); },
    /** 세션 전체 음소거(믹스다운: 편집음·이동음·이벤트음) */
    mute(muted: boolean) { fadeTo(output.gain, muted ? 0 : 1, context); },
    async close() {
      if (closed) return;
      closed = true;
      engine.mixdown.disconnect(output);
      output.disconnect();
    },
  };
}

export type InteractionSession = Awaited<ReturnType<typeof createInteractionSession>>;
