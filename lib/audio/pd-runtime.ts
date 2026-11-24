// pd4web 엔진 하나와 장면 패치 main.pd를 여는 최소 계층(약속은 audio/main-pd.md).
// - 엔진(pd4web.js/wasm, Pd 0.56)은 페이지당 하나. AudioContext도 엔진이 만든다(openEngine이 돌려준다).
// - 패치 폴더(audio/patches/)를 엔진이 켜질 때 하위 폴더째 엔진의 가상 디스크(/)에 복사한다. abstraction은 Pd가 알아서 찾는다.
//   폴더는 tar.gz 하나(audio/patches.tar.gz, Vite가 묶어 줌)로 받아 푼다.
// - 패치 폴더를 푼 뒤 main.pd를 바로 연다. 장면(영역 패치를 띄우고 지우기, 상호작용 패치)은 main.pd가 관리한다.
// - 영역 하나 = 슬롯 하나: whistle-slot으로 "on 번호 패치 이름 L R" / "off 번호"를 보낸다. main.pd가 [pd slot번호] 안에
//   [<패치> <이름>] → [dac~ L R]를 만들고 지운다. 이름은 띄울 때마다 새것(v1, v2…), 패치의 $1이다.
// - 출력 32채널: 1–2는 믹스다운(공간화 없음), 3–32는 슬롯 15개의 스테레오(슬롯 N → 2N+3, 2N+4).
//   슬롯별 스테레오 노드와 믹스다운 노드를 돌려준다. 연결·게인·공간화는 호출하는 쪽 책임.

export type PdMessage = (string | number)[];

/** 동시에 띄울 수 있는 영역 수(공간화 채널 3–32) */
export const SLOTS = 15;
/** 엔진 출력 채널 수: 믹스다운 한 쌍(1–2) + 슬롯 15쌍. Web Audio 노드 출력은 최대 32채널. */
const CHANNELS = SLOTS * 2 + 2;
/** 장면 패치(audio/patches/main.pd) */
export const MAIN = "main";

type Pd4Web = {
  openPatch(file: string, options: Record<string, unknown>): void;
  init(): void;
  sendList(name: string, list: PdMessage): boolean;
  sendMessage(name: string, selector: string, list: PdMessage): boolean;
} & { [kind in Receive]: (name: string, listener: (...args: any[]) => void) => (() => void) | void };
const RECEIVES = ["onBangReceived", "onFloatReceived", "onSymbolReceived", "onListReceived", "onMessageReceived"] as const;
type Receive = (typeof RECEIVES)[number];
type Pd4WebGlobals = {
  Pd4WebModule(options: { locateFile(path: string): string }): Promise<{ Pd4Web: new () => Pd4Web; FS: EmscriptenFS }>;
  Pd4Web: Pd4Web | null;
  Pd4WebAudioContext?: AudioContext;
  Pd4WebAudioWorkletNode?: AudioWorkletNode;
};
type EmscriptenFS = {
  mkdirTree(path: string): void;
  writeFile(path: string, data: Uint8Array): void;
  readFile(path: string, options: { encoding: "utf8" }): string;
  unlink(path: string): void;
};
const globals = () => window as unknown as Pd4WebGlobals & typeof globalThis;

export type PatchInstance = {
  name: string;
  /** 이 영역의 이름. Pd 안에서 패치의 $1(v1, v2…) */
  id: string;
  node: AudioNode;
  /** `<id>-<bus>`로 보낸다(패치는 [r $1-<bus>]) */
  send(bus: string, message: PdMessage): void;
  /** 패치가 `[s $1-<bus>]`로 보내는 bang을 받는다(Pd → JS). destroy 때 함께 끊는다 */
  onBang(bus: string, listener: () => void): void;
  destroy(): void;
};

export type PdEngine = {
  context: AudioContext;
  /** 엔진 가상 디스크에 복사한 패치 폴더의 파일(폴더 기준 경로) */
  files: string[];
  /** 영역 패치 하나를 빈 슬롯에 띄운다(main.pd에 on을 보낸다) */
  start(name: string): Promise<PatchInstance>;
  /** 전역 버스로 보낸다(whistle-player 등. main.pd 안의 패치가 받는다) */
  send(bus: string, message: PdMessage, remember?: boolean): void;
  forget(bus: string, message: PdMessage): void;
  /** 믹스다운(채널 1–2): main.pd가 공간화 없이 내보내는 소리 */
  mixdown: AudioNode;
  /** 지금 쓰는 슬롯 수 */
  slotsInUse(): number;
  /** 엔진 가상 디스크(메모리)에 파일을 쓴다/지운다. 경로는 / 기준(예: "uploads/s1.wav"). 패치는 [soundfiler] 등으로 읽는다. */
  writeFile(path: string, data: Uint8Array): void;
  removeFile(path: string): void;
};

const loadScript = (url: string) => new Promise<void>((resolve, reject) => {
  const script = document.createElement("script");
  script.src = url;
  script.onload = () => resolve();
  script.onerror = () => { script.remove(); reject(new Error("pd4web 엔진을 불러오지 못했습니다.")); };
  document.head.append(script);
});

async function fetchOk(url: string) {
  // 캐시가 있어도 서버에 바뀌었는지 묻는다(안 바뀌었으면 304).
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) throw new Error(`불러오지 못했습니다: ${url} (${response.status})`);
  return response;
}

/** tar(ustar)를 풀어 일반 파일마다 write(경로, 내용)를 부른다. 푼 경로 목록을 돌려준다. */
function untar(bytes: Uint8Array, write: (path: string, data: Uint8Array) => void) {
  const text = new TextDecoder();
  const field = (header: Uint8Array, offset: number, length: number) =>
    text.decode(header.subarray(offset, offset + length)).split("\0")[0];
  const paths: string[] = [];
  for (let offset = 0; offset + 512 <= bytes.length;) {
    const header = bytes.subarray(offset, offset + 512);
    if (header[0] === 0) break; // 끝 표시(빈 블록)
    const path = [field(header, 345, 155), field(header, 0, 100)].filter(Boolean).join("/");
    const size = parseInt(field(header, 124, 12), 8);
    const type = header[156];
    offset += 512;
    if (type === 48 /* "0" */ || type === 0) {
      write(path, bytes.slice(offset, offset + size));
      paths.push(path);
    }
    offset += Math.ceil(size / 512) * 512;
  }
  return paths;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function createEngine(baseUrl: string, latencyHint: AudioContextLatencyCategory, timeout: number): Promise<PdEngine> {
  const assetUrl = (path: string) => `${baseUrl}${path}?v=${import.meta.env.VITE_AUDIO_REVISION}`;
  if (!globalThis.crossOriginIsolated) {
    throw new Error("pd4web 엔진에는 교차 출처 격리(COOP/COEP)가 필요합니다. 페이지를 새로고침하세요.");
  }
  // 패치 폴더(tar.gz 하나)를 먼저 받는다. 서버에 따라 .gz를 Content-Encoding: gzip으로 보내 브라우저가 먼저 풀어 버리기도 한다.
  // gzip 머리(1f 8b)가 있을 때만 푼다.
  let archive = new Uint8Array(await (await fetchOk(assetUrl("patches.tar.gz"))).arrayBuffer());
  if (archive[0] === 0x1f && archive[1] === 0x8b) {
    archive = new Uint8Array(await new Response(new Blob([archive]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
  }
  const g = globals();
  const engineUrl = assetUrl("engine/pd4web.js");
  if (!g.Pd4WebModule) await loadScript(engineUrl);
  // 엔진은 시작 전에 같은 스크립트로 작업자(Web Worker) 4개를 띄우고, 넷 다 응답해야 시작한다.
  // 폰 Firefox에서는 이 작업자 스크립트 요청이 서비스 워커(coi-serviceworker)에서 자주 실패해, 엔진이 오류 없이 멈췄다.
  // 이미 받은 스크립트로 Blob 주소를 만들어 띄운다: 서비스 워커를 거치지 않고, 교차 출처 격리는 페이지에서 물려받는다.
  // 엔진이 나중에 작업자를 더 띄울 수도 있어 되돌리지 않는다(엔진 스크립트 주소만 바꾼다).
  const source = URL.createObjectURL(new Blob([await (await fetchOk(engineUrl)).text()], { type: "text/javascript" }));
  const engineScript = new URL(engineUrl, location.href).href;
  const OriginalWorker = g.Worker;
  g.Worker = class extends OriginalWorker {
    constructor(url: string | URL, options?: WorkerOptions) {
      super(new URL(url, location.href).href === engineScript ? source : url, options);
    }
  };
  const module = await g.Pd4WebModule({ locateFile: (path) => assetUrl(`engine/${path}`) });
  const pd = new module.Pd4Web();
  shareReceivers(pd);
  // pd4web의 GUI·콜백 코드는 전역 Pd4Web을 찾는다.
  g.Pd4Web = pd;
  // pd4web는 소리 켜기 버튼 id가 없으면 콘솔 오류를 낸다. 누를 일 없는 숨은 요소를 준다(시작은 init()으로).
  const toggle = document.createElement("span");
  toggle.id = "whistle-pd4web-toggle";
  toggle.hidden = true;
  document.body.append(toggle);

  // --- 패치 폴더를 엔진 가상 디스크(/)에 푼다 ---
  const files = untar(archive, (path, data) => {
    const dir = path.slice(0, path.lastIndexOf("/") + 1);
    if (dir) module.FS.mkdirTree(`/${dir}`);
    module.FS.writeFile(`/${path}`, data);
  });

  if (!files.includes(`${MAIN}.pd`)) throw new Error(`audio/patches/${MAIN}.pd가 없습니다.`);
  // 엔진이 디스크의 main.pd를 연다(loadbang도 엔진이 보낸다).
  pd.openPatch(`${MAIN}.pd`, { channelCountOut: CHANNELS, renderGui: false, soundToggleId: toggle.id });

  // pd4web는 latencyHint를 "interactive"로 고정해 AudioContext를 만든다. 만드는 순간에만 생성자를 감싸 지연 설정을 넘긴다.
  const Original = g.AudioContext;
  g.AudioContext = class extends Original {
    constructor(options?: AudioContextOptions) { super({ ...options, latencyHint }); }
  };
  try { pd.init(); } finally { g.AudioContext = Original; }

  // 오디오 워클릿 노드는 비동기로 생긴다. pd4web가 전역에 두고 destination에 바로 연결한다.
  const until = performance.now() + timeout;
  while (!g.Pd4WebAudioWorkletNode || !g.Pd4WebAudioContext) {
    if (performance.now() > until) throw new Error("pd4web 오디오 워클릿이 시작되지 않았습니다.");
    await delay(20);
  }
  const context = g.Pd4WebAudioContext;
  const worklet = g.Pd4WebAudioWorkletNode;
  worklet.disconnect();
  const splitter = context.createChannelSplitter(CHANNELS);
  worklet.connect(splitter);

  // Pd → JS 메시지(onBangReceived 등)는 아직 쓰지 않는다(audio/pd-to-js.md). 시작 확인은 동기 생성으로 충분하다.

  const message = (target: string, selector: string, args: PdMessage) => {
    if (!pd.sendMessage(target, selector, args)) throw new Error(`Pd 메시지 실패: ${target} ${selector} ${args.join(" ")}`);
  };
  /** 버스로 보내고, 다시 보낼 수 있게 함수를 돌려준다. 글자로 시작하면 Pd 메시지 상자처럼 그 글자가 선택자다
   * (`position 0.5 0 0.5` → [route position]). 받는 객체가 없는 버스로 보내도 Pd는 조용히 버린다. */
  const deliver = (target: string, values: PdMessage) => {
    const [head, ...rest] = values;
    const again = () => typeof head === "string" ? pd.sendMessage(target, head, rest) : pd.sendList(target, values);
    if (!again()) throw new Error(`Pd 메시지 실패: ${target}`);
    return again;
  };
  /** 버스(와 선택자)마다 마지막으로 보낸 것. 다시 만든 뒤 다시 보낸다. */
  const key = (target: string, values: PdMessage) => typeof values[0] === "string" ? `${target} ${values[0]}` : target;

  // --- 장면 ---
  const globalLast = new Map<string, () => void>();
  /** main.pd를 닫고 다시 연다(개발 서버의 패치 갱신). 여는 것은 Pd의 [; pd open main.pd .(와 같다. */
  const reopenMain = () => {
    message(`pd-${MAIN}.pd`, "menuclose", [1]);
    message("pd", "open", [`${MAIN}.pd`, "."]);
  };
  const mixdown = context.createChannelMerger(2);
  splitter.connect(mixdown, 0, 0);
  splitter.connect(mixdown, 1, 1);

  // --- 슬롯 ---
  const used = new Set<number>();
  let count = 0;
  /** 떠 있는 슬롯: 패치 이름, 다시 띄우는 함수, 버스마다 마지막으로 보낸 메시지 */
  const live = new Map<number, { name: string; id: string; on(): void; last: Map<string, () => void> }>();

  const start = async (name: string): Promise<PatchInstance> => {
    let index = 0;
    while (used.has(index)) index++;
    if (index >= SLOTS) throw new Error(`Pd 슬롯 ${SLOTS}개를 모두 쓰고 있습니다: ${name}`);
    used.add(index);
    const id = `v${++count}`;
    const merger = context.createChannelMerger(2);
    const last = new Map<string, () => void>();
    const listening: (() => void)[] = [];
    let closed = false;
    const destroy = () => {
      if (closed) return;
      closed = true;
      for (const stop of listening.splice(0)) stop();
      try { message("whistle-slot", "off", [index]); } catch { /* 엔진이 이미 멈춤 */ }
      splitter.disconnect(merger);
      merger.disconnect();
      used.delete(index);
      live.delete(index);
    };
    const on = () => message("whistle-slot", "on", [index, name, id, 2 * index + 3, 2 * index + 4]);
    try {
      on();
      splitter.connect(merger, 2 * index + 2, 0);
      splitter.connect(merger, 2 * index + 3, 1);
      live.set(index, { name, id, on, last });
    } catch (error) {
      destroy();
      throw error;
    }
    return {
      name,
      id,
      node: merger,
      send(bus: string, values: PdMessage) {
        if (closed) throw new Error(`${name}: 종료된 패치입니다.`);
        const target = `${id}-${bus}`;
        last.set(key(target, values), deliver(target, values));
      },
      onBang(bus: string, listener: () => void) {
        // pd4web은 한 번 등록한 이름을 풀지 못한다(audio/pd-to-js.md). 이름(vK)은 다시 쓰지 않으므로 함수만 뗀다.
        const stop = pd.onBangReceived(`${id}-${bus}`, () => { if (!closed) listener(); });
        if (stop) listening.push(stop);
      },
      destroy,
    };
  };
  const send = (bus: string, values: PdMessage, remember = true) => {
    const replay = deliver(bus, values);
    if (remember && bus !== "whistle-blow") globalLast.set(key(bus, values), replay);
  };
  const forget = (bus: string, values: PdMessage) => { globalLast.delete(key(bus, values)); };
  const removeFile = (path: string) => {
    try { module.FS.unlink(`/${path}`); } catch { /* 이미 없음 */ }
  };
  const writeFile = (path: string, data: Uint8Array) => {
    const dir = path.slice(0, path.lastIndexOf("/") + 1);
    if (dir) module.FS.mkdirTree(`/${dir}`);
    // 엔진의 FS.writeFile은 있는 파일을 비우지 않고 뒤에 이어 쓴다. 지우고 쓴다.
    removeFile(path);
    module.FS.writeFile(`/${path}`, data);
  };

  // 개발 서버에서만: 패치 파일을 고치면(vite.config.ts가 알려 줌) 엔진 디스크의 파일을 바꾸고, 그 파일을 쓰는 것을 다시 만든다.
  // main.pd(와 그 안의 패치)가 바뀌면 main.pd를 다시 열고 떠 있는 슬롯을 모두, 영역 패치가 바뀌면 그 슬롯만. 다시 만든 뒤 마지막 값을 다시 보낸다.
  // Pd는 abstraction을 만들 때마다 파일을 새로 읽으므로, 새로 뜨는 슬롯(영역에 다시 들어갈 때)은 저절로 새 버전이다.
  import.meta.hot?.on("whistle:patch", ({ path, data }: { path: string; data?: string }) => {
    if (data === undefined) {
      removeFile(path);
      if (files.includes(path)) files.splice(files.indexOf(path), 1);
      return;
    }
    writeFile(path, Uint8Array.from(atob(data), (c) => c.charCodeAt(0)));
    if (!files.includes(path)) files.push(path);
    if (!path.endsWith(".pd")) return;
    const changed = path.slice(path.lastIndexOf("/") + 1, -3);
    const scene = uses(MAIN, changed, new Set());
    const restarted: string[] = scene ? [MAIN] : [];
    if (scene) {
      reopenMain();
      for (const resend of globalLast.values()) resend();
    }
    for (const slot of live.values()) {
      if (!scene && !uses(slot.name, changed, new Set())) continue;
      slot.on();
      for (const resend of slot.last.values()) resend();
      restarted.push(`${slot.id} ${slot.name}`);
    }
    console.info(`[pd4web] 패치 갱신: ${path}${restarted.length ? ` (다시 만듦: ${restarted.join(", ")})` : ""}`);
  });
  /** 패치 name이 changed를 (안쪽 abstraction까지) 쓰는지. 객체 상자의 낱말 중 하나가 그 이름이면 쓴다고 본다([clone] 인자도). */
  const uses = (name: string, changed: string, seen: Set<string>): boolean => {
    if (name.slice(name.lastIndexOf("/") + 1) === changed) return true;
    if (seen.has(name)) return false;
    seen.add(name);
    let text = "";
    try { text = module.FS.readFile(`/${name}.pd`, { encoding: "utf8" }); } catch { return false; }
    const words = new Set([...text.matchAll(/^#X obj \S+ \S+ ([^;]*)/gm)].flatMap((m) => m[1].split(/\s+/)));
    return [...words].some((word) => word && files.includes(`${word}.pd`) && uses(word, changed, seen));
  };

  return { context, files, start, send, forget, mixdown, slotsInUse: () => used.size, writeFile, removeFile };
}

/** 터치·키 처리 안에서 부른다. 엔진의 AudioContext가 막혀(suspended) 있으면 켠다. 엔진이 아직 없으면 아무것도 안 한다. */
export function unlockAudio() {
  const context = globals().Pd4WebAudioContext;
  if (context?.state === "suspended") void context.resume().catch(() => {});
}

/**
 * pd4web의 on…Received는 같은 이름을 두 번 등록하면 겹쳐 불렸다(audio/pd-to-js-fix.md).
 * Pd의 [r]처럼 같은 이름을 여럿이 받게 고친다: 이름마다 pd4web에는 한 번만 등록하고, 함수는 목록으로 모두 부른다
 * (libpd의 PdDispatcher와 같은 방식). 등록하면 그만 받기 함수를 돌려준다. 한 이름에 종류는 하나.
 */
function shareReceivers(pd: Pd4Web) {
  const names = new Map<string, { kind: Receive; listeners: Set<(...args: unknown[]) => void> }>();
  for (const kind of RECEIVES) {
    const original = pd[kind].bind(pd);
    pd[kind] = (name, listener) => {
      let entry = names.get(name);
      if (entry && entry.kind !== kind) throw new Error(`Pd 이름 "${name}"은 이미 ${entry.kind}로 받고 있습니다(한 이름에 종류는 하나).`);
      if (!entry) {
        const listeners = new Set<(...args: unknown[]) => void>();
        entry = { kind, listeners };
        names.set(name, entry);
        const call = (...args: unknown[]) => {
          for (const each of [...listeners]) {
            try { each(...args); } catch (error) { console.error(`[pd4web] ${name} 받기 오류`, error); }
          }
        };
        // pd4web은 콜백의 인자 개수를 검사한다(bang 1, message 3, 나머지 2).
        original(name, kind === "onBangReceived" ? (r: string) => call(r)
          : kind === "onMessageReceived" ? (r: string, selector: string, values: unknown[]) => call(r, selector, values)
          : (r: string, value: unknown) => call(r, value));
      }
      const own = (...args: unknown[]) => listener(...args); // 같은 함수를 두 번 등록해도 따로 센다([r] 두 개처럼)
      entry.listeners.add(own);
      return () => { entry.listeners.delete(own); };
    };
  }
}

let engine: Promise<PdEngine> | undefined;
/**
 * 페이지의 pd4web 엔진을 연다(처음 한 번만 실제로 만든다. 이후에는 같은 엔진).
 * latencyHint는 처음 열 때만 적용된다. 사용자 조작(클릭·키) 뒤에 부르는 것이 좋다(AudioContext 자동재생 정책).
 */
export function openEngine(baseUrl: string, options: { latencyHint?: AudioContextLatencyCategory; timeout?: number } = {}) {
  engine ??= createEngine(baseUrl, options.latencyHint ?? "interactive", options.timeout ?? 30_000);
  engine.catch(() => { engine = undefined; });
  return engine;
}
