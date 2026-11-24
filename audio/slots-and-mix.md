# 슬롯과 믹스: 패치 소리가 스피커까지 가는 길

Pd 패치는 소리만 만든다. 그 소리가 어디서 얼마나 크게 들리는지는 Web Audio 쪽이 정한다.
앞부분(슬롯)은 `lib/audio/pd-runtime.ts`, 뒷부분(믹스)은 `lib/audio/soundscape.ts`·`components/whistle/useGameAudio.ts`.

## 1. 슬롯

엔진 출력은 32채널이다. 1–2는 믹스다운(공간화 없음), 3–32는 슬롯 15개의 스테레오(슬롯 N → 2N+3, 2N+4).
영역 패치를 슬롯에 띄우고 지우는 것은 장면 패치 `main.pd`가 한다(약속은 [`main-pd.md`](main-pd.md)). JS는 아래만 한다.

### 엔진을 열고 `main.pd`를 연다

```ts
const files = untar(archive, ...);   // 패치 폴더를 엔진 디스크(/)에 먼저 푼다
pd.openPatch("main.pd", { channelCountOut: CHANNELS, renderGui: false, ... });  // 32채널. loadbang도 온다
```

### 32채널을 나눈다 (Web Audio)

```ts
worklet.disconnect();                                      // pd4web이 스피커에 바로 꽂아 둔 것을 뺀다
const splitter = context.createChannelSplitter(CHANNELS);  // 32채널을 낱개로
const mixdown = context.createChannelMerger(2);
splitter.connect(mixdown, 0, 0);                           // 1 → 왼쪽
splitter.connect(mixdown, 1, 1);                           // 2 → 오른쪽
```

### 영역 하나 띄우기 = 슬롯 하나 쓰기 (`start`)

```ts
let index = 0;
while (used.has(index)) index++;   // 비어 있는 가장 작은 번호
const id = `v${++count}`;          // 새 이름: 패치의 $1
message("whistle-slot", "on", [index, name, id, 2 * index + 3, 2 * index + 4]);  // on 3 environment_water v17 9 10
const merger = context.createChannelMerger(2);
splitter.connect(merger, 2 * index + 2, 0);   // 9번 채널(0부터 세면 8) → 왼쪽
splitter.connect(merger, 2 * index + 3, 1);   // 10번 채널 → 오른쪽
return { name, id, node: merger, send, destroy };
```

`merger`가 이 영역만의 스테레오 소리다. 사운드스케이프가 이것을 받아 믹스한다(아래 2).

### 보내기

- 영역: `instance.send("whistle-region", …)` → `v17-whistle-region` → 패치의 `[r $1-whistle-region]`.
- 전역: `engine.send("whistle-player", …)` → `main.pd` 안의 `[r whistle-player]`.

### 닫기 (`destroy`)

```ts
message("whistle-slot", "off", [index]);   // main.pd가 [pd slot3]을 비운다
splitter.disconnect(merger);
used.delete(index);                        // 다음 start가 이 번호를 쓴다(이름은 새것)
```

## 2. 믹스

슬롯의 `merger`는 사운드스케이프 영역마다 이 줄기를 지난다.

```
[슬롯 N의 merger] ─→ gain(볼륨·페이드) ─┬─→ panner(방향) ─→ dry ─┐
   (patch.node)                           ├─→ wet(가운데) ──────────┤
                                          └─→ wetDiffuse ─→ diffuser ┤ (선택)
                                                                     ↓
                                           soundscape master ─→ 앱 master ─→ limiter ─→ 스피커
```

믹스다운(채널 1–2: `main.pd` 안의 상호작용 패치 등)은 이 줄기 없이 앱 master로 바로 간다(공간화 없음).

### 노드를 만들고 잇는다 (`soundscape.ts`의 `load`)

```ts
const patch = await start(context, voice.source.patch);   // 슬롯을 하나 띄운다(engine.start)
const gain = context.createGain();
gain.gain.value = 0;                                      // 0에서 시작해 페이드 인
const panner = context.createPanner();
panner.panningModel = panning;                            // 기본 "equalpower"(HRTF도 고를 수 있음)
panner.distanceModel = "inverse";
panner.refDistance = refDistance;
panner.rolloffFactor = rolloff;                           // 게임에서는 0: 패너는 거리 감쇠를 안 함
setPosition(panner, voice.source.position, true);
const dry = context.createGain();
const wet = context.createGain();
patch.node.connect(gain);
gain.connect(panner).connect(dry).connect(master);        // 방향이 있는 소리
gain.connect(wet).connect(master);                        // 방향 없이 가운데로 오는 소리
mix(voice, true);                                         // dry/wet 비율
deliver(voice);                                           // 패치에 첫 메시지(amount, distance)
fadeIn(id, voice);                                        // gain을 목표 볼륨까지
```

- **gain**: 이 영역의 볼륨. 켤 때 0에서 페이드 인, 끌 때 0으로 페이드 아웃(`fade` 기본 0.4초).
  거리에 따른 볼륨은 패너가 아니라 게임(`game-soundscape.ts`)이 영역 외곽까지 거리로 계산해 여기에 넣는다.
- **panner**: Web Audio 3D 패너. 소리가 어느 방향에서 오는지.
- **dry / wet**: 같은 소리를 두 갈래로. dry는 패너를 거쳐 방향이 있고, wet은 패너 없이 머리 가운데에서 들린다.

### 비율 (`mix`)

```ts
const width = voice.source.width ?? 0;   // 0 = 한 점에서, 1 = 사방에서
[voice.dry,        diffuse ? cos(width·π/2) : 1 - width],
[voice.wet,        diffuse ? 0              : width],
[voice.wetDiffuse, diffuse ? sin(width·π/2) : 0],
```

- `width`는 게임이 영역마다 정한다. 영역 멀리 있으면 한 점에서 오는 소리(dry), 영역 안에 서 있으면 둘러싸는 소리(wet).
- **diffuser**(비상관 필터, 기본 꺼짐): 켜면 wet 대신 `wetDiffuse`. 가운데 소리를 좌우가 조금씩 다른 all-pass 필터(`createDiffuser`)에
  통과시켜 머리 가운데가 아니라 넓게 퍼져 들린다.

### 방향 (`toListenerSpace`, `placePanner`)

- 리스너는 그래프에서 원점에 고정(앞 = −Z, `placeListenerAtOrigin`).
- 플레이어가 움직이거나 돌면 리스너를 옮기지 않고, 각 소스 위치를 플레이어 기준 좌표로 바꿔 패너에 넣는다(`toListenerSpace`).
- Firefox는 리스너 위치를 부드럽게 옮길 수 없지만 패너 위치는 AudioParam이라 부드럽게 옮길 수 있기 때문이다(`placePanner`의 `ramp`).

### 마지막 출구 (`useGameAudio.ts`)

```ts
master = context.createGain();
const limiter = context.createDynamicsCompressor();   // -3dB, 비율 20: 사실상 리미터
master.connect(limiter).connect(context.destination);
createInteractionSession(engine, undefined, master);   // 믹스다운(1–2) → master로 바로
createSoundscape({ destination: master, rolloff: 0, ..., start: (_c, name) => engine.start(name) });
```

사운드스케이프에도 자기 master가 하나 있고(`soundscape.ts`), 그것이 앱 master로 간다. 앱 master는 리미터를 거쳐 스피커로.

### 게임이 매 프레임 넣는 값 (`game-soundscape.ts`)

```ts
scape.set({ id, patch, position, gain, width, messages: { [REGION_BUS]: [["amount", amount], ["distance", distance]] } });
```

| 값 | 가는 곳 |
| --- | --- |
| `position` | panner 위치(방향) |
| `gain` | gain 노드(거리에 따른 볼륨) |
| `width` | dry/wet 비율(둘러싼 정도) |
| `messages` | 슬롯의 `[r $1-whistle-region]`으로 `amount`, `distance`(값이 바뀔 때만, `deliver`) |
