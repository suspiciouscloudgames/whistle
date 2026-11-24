# pd4web 오디오

`audio/engine/`의 pd4web 엔진 하나에서 Pd 패치를 실행한다. 편집·플레이·배치한 녹음 소리가 AudioContext를 공유한다.

- 상호작용: `edit.pd`, `player.pd`, `event.pd`
- 지형·환경: `lib/audio/terrain-sources.ts`에서 플레이어 근처 영역을 선택한다. 동시에 최대 6개 영역을 재생한다.
- 연결: `lib/audio/pd-runtime.ts`, `lib/audio/pd-session.ts`, `components/whistle/useGameAudio.ts`
- 편집 메시지: `whistle-edit x z overlap asset action surface`
- 플레이 메시지: `whistle-player position x y z`, `yaw angle`, `stat crouch run grounded falling`, `footed grass water`
- UWB 보드 높이: `whistle-board-height metres` (0–10m)
- 규칙 이벤트: `whistle-event frequency gain pan`

X/Z는 세계 크기로 정규화한다. 음소거는 WebAudio 게인으로 처리하며, 게임이 숨겨지면 AudioContext를 일시정지한다. 소리는 사용자 조작 후 시작한다.

Pd 엔진 하나(AudioContext 하나)에서 장면 패치 `main.pd` 하나가 전체를 관리한다. 사운드스케이프 영역 패치(`environment_grass.pd` 등)는
JS의 켜기·끄기 메시지로 `main.pd`가 "슬롯"에 띄우고, 상호작용 패치(edit·player·event)는 `main.pd` 안에 둔다.
하위 패치(abstraction)도 쓸 수 있다. 역할 나누기·채널·메시지 약속은 [`main-pd.md`](main-pd.md).

개발·미리보기·테스트 서버는 COOP/COEP 헤더를 제공한다. 헤더를 설정할 수 없는 정적 호스팅은 `coi-serviceworker.js`가 교차 출처 격리를 설정한다.

- 엔진: [pd4web](https://github.com/charlesneimog/pd4web) 3.4.1(libpd, Pd 0.56의 vanilla 객체 전체를 C에서 wasm으로).
  빈 host 패치만 들어 있는 엔진을 한 번 빌드해 `audio/engine/`에 커밋해 둔다(pd4web.js·wasm·data, 약 2MB).
  **pdlua(GPL-2.0-or-later)는 빼고 빌드한다.** pd4web 3.4.1은 pdlua를 항상 링크하므로 빌드 스크립트가 CLI가 만든 빌드 폴더에서
  pdlua 링크·호출·패키징(pd.lua 등)을 잘라 내고 다시 빌드한다. Lua 객체와 GUI는 쓸 수 없다.
  남은 구성 요소는 Pd·libpd·pd4web(BSD), ThorVG·Emscripten·musl(MIT), LLVM libc++(Apache-2.0 + LLVM 예외)이다.
  저작권·라이선스 고지는 `public/THIRD_PARTY_LICENSES.txt`(배포물 `/whistle/THIRD_PARTY_LICENSES.txt`). 엔진을 다시 빌드해 버전이 바뀌면 함께 고친다.
  **패치는 엔진에 넣어 빌드하지 않는다.** 브라우저의 Pd는 서버 디스크가 아니라 브라우저 메모리 안의 가상 디스크를 본다.
  엔진이 켜질 때 패치 폴더 `audio/patches/`를 하위 폴더째 그 가상 디스크(`/`)에 복사하고, 패치는 동적 패칭으로 만든다.
  abstraction은 Pd가 가상 디스크에서 알아서 찾는다. 하위 폴더도 Pd와 같다(`[폴더/패치]`, 그 패치 안에서는 그 폴더 기준).
  HTTP로는 폴더를 통째로 받을 수 없어서, 패치 폴더를 tar.gz 하나(`audio/patches.tar.gz`)로 묶어 보내고 브라우저가 푼다.
  묶는 건 Vite가 한다: 개발 서버는 요청 때마다 지금 폴더를 묶고, `npm run build`는 결과물에 넣는다(엔진 `audio/engine/`도 함께).
  안을 보려면 `tar tzf patches.tar.gz`. gzip은 `.pd` 같은 텍스트는 크게 줄이지만 wav는 거의 줄이지 못한다(실측 약 14%). 관리할 목록은 없다. 개발 서버는 패치 폴더가 바뀌면 새로고침하지 않고 바뀐 파일만 엔진 디스크에 다시 쓴다.
  그 파일을 쓰는(안쪽 abstraction까지) 떠 있는 슬롯은 다시 만들고, 그 슬롯에 마지막으로 보낸 값을 다시 보낸다.
  새로 뜨는 슬롯은 Pd가 만들 때마다 파일을 새로 읽으므로 저절로 새 버전이다. 다시 만들 때 소리가 한 번 끊기고 패치 상태는 처음부터다.
  앱이 여는 패치(`KIND_PATCHES`, `main`)가 폴더에 없으면 `npm run build`도 `npm run dev`도 그 이름을 보여 주고 멈춘다.
  그래서 패치를 고치면 Pd에서 저장만 하면 된다. 개발 PC에 pd4web·Emscripten이 없어도 된다.
  파일은 매번 서버에 바뀌었는지 묻고 받는다(`cache: "no-cache"`). 페이지를 열 때 폴더 전체(지금 약 0.7MB)를 받는다.
- 엔진을 다시 빌드할 때(pd4web 버전업, 외부 객체 추가 등)만 `npm run audio:engine`.
  pd4web CLI(파이썬 `pip install pd4web`, Python 3.12+)가 필요하다. `PD4WEB=/경로/pd4web npm run audio:engine`.
  첫 빌드는 Emscripten 등을 받아 수 분, 이후는 `output/pd4web-engine/` 캐시로 약 4~5분(CLI 빌드 + pdlua 제외 재빌드).
  pd4web 버전을 바꿔 잘라 낼 코드가 달라지면 빌드가 멈춘다(pdlua가 조용히 남지 않도록). 그때 스크립트의 `stripPdlua`를 맞춘다.
- 런타임 `lib/audio/pd-runtime.ts`: `openEngine(baseUrl, { latencyHint })`가 페이지당 엔진 하나를 연다(AudioContext도 엔진의 것).
  패치 폴더를 푼 뒤 `main.pd`를 바로 연다. `engine.start(이름)` → 빈 슬롯 번호와 새 이름(`v17`)으로 `whistle-slot`에
  `on 번호 패치 이름 L R`을 보내고, 그 슬롯의 채널 쌍을 스테레오 노드로 돌려준다. `destroy()`는 `off 번호`.
  1–2는 믹스다운(`engine.mixdown`), 슬롯은 15개(채널 3–32). `engine.send(버스, 값)`은 전역 버스로 보낸다.
  소리가 어떻게 믹스되는지는 [`slots-and-mix.md`](slots-and-mix.md).
- 서버 없이 Pd에서 main.pd를 들어 보려면 `audio/simulator/simulator.pd`([`simulator/README.md`](simulator/README.md)).
- 교차 출처 격리(COOP/COEP)가 필요하다(SharedArrayBuffer). 개발·미리보기 서버는 `vite.config.ts`의 헤더로,
  GitHub Pages는 `public/coi-serviceworker.js`(pd4web에 포함된 coi-serviceworker, MIT)로 건다. 첫 방문 때 페이지가 한 번 새로고침된다.
- Pd → JS 메시지(`[s 이름]`을 JS가 받기)는 된다. 단 출력이 연결된 슬롯이 하나라도 떠 있어야 엔진이 돈다. 아직 앱에서는 쓰지 않는다.
  쓰는 법과 주의점은 [`pd-to-js.md`](pd-to-js.md). 실험 페이지의 "Pd가 수신한 값"은 JS가 Pd에 보낸 값을 보여 준다.

### 패치 규칙 (pd4web 전환 때 바뀜)

- **출력은 최상위 `[outlet~]` 두 개**(왼쪽 L, 오른쪽 R. 화면에서 왼쪽에 있는 것이 L). `[dac~]`를 쓰면 모든 소리가 한 채널에 섞여
  소리별 패닝을 할 수 없다. 기존 패치는 `dac~`의 L/R 입력을 그대로 두 `outlet~`로 옮겼다.
  Pd에서 단독으로 들어 보려면 그 패치를 객체로 넣고 `[dac~]`에 연결한 시험용 패치를 연다.
- 영역 패치의 `$1`은 영역 이름(`v17`…, 띄울 때마다 새것). 같은 패치가 여러 영역에 동시에 뜨므로
  **영역마다 따로 받을 버스는 `[r $1-whistle-region]`**(JS가 `v17-whistle-region`으로 보낸다).
  상호작용 패치(edit·player·event)는 `main.pd` 안에 하나씩 있으므로 `whistle-player` 같은 전역 이름 그대로.
- 받는 객체가 없는 버스로 보내도 Pd가 조용히 버린다.
- **어디에 어떤 소리(영역)가 생기는지는 [`sound-layers.md`](sound-layers.md)에 정리했다(예: 바람은 골짜기).**
- **패치에서 받을 수 있는 값(버스·순서·범위)은 [`pd-receive.md`](pd-receive.md)에 정리했다.** 전역 이름은 어느 패치에서나 받을 수 있다(예: 영역 패치에서 `[r whistle-player]`).
- 전역 이름(`[delwrite~ b]`, `[s 이름]`, `[table 이름]`)은 같은 패치가 여러 번 뜨면 겹친다. 패치 안에서만 쓰는 이름은 `$0-`.
- `whistle-ready`는 더 이상 쓰지 않는다(남아 있어도 무해).

## 게임 연결

- `useGameAudio`가 게임의 오디오 세션 하나를 관리한다. 첫 유효한 격자 편집 또는
  플레이 버튼 클릭으로 시작한다. 초기 로드·무변경 칠하기·시작점 지정·실행 취소는 편집음을 내지 않는다.
- `paint` 처리 전후 문서를 비교해 실제 변경된 셀만 판별한다. 드래그 콜백마다
  마지막 변경 셀 하나를 대표해 전송한다. 누적 셀의 ID만 다시 생성된 경우에는 재생하지 않는다.
- `WorldDerivation`의 기존 환경·구조 캐시를 재사용한다. 겹침 강도는 풀, 물,
  안개, 그늘, 바위 지면, 생성 구조의 결과로 정한다. 물리적 오브젝트 중첩 개수와는 다르다.
- `Scene.onAudioFrame`이 발 X/Y/Z, 풀·바위·물,
  접지·낙하·방향을 보낸다. 80ms 간격으로 전달한다.
- 이동·충돌·점프·카메라 계산은 유지한다. 카메라 흔들림이 아닌 발 높이를 사용하고,
  접근성 설정의 동작 줄이기 여부와 보행음의 접지 판정을 분리한다.
- 3D 상태를 수신하면 고정 크기의 연속 시험음을 재생한다. 제자리나 점프 중에도
  위치·재질 상태를 전달하며, 이동 속도로 음량을 조절하지 않는다.
- 편집 화면 복귀·문서 교체·blur·탭 숨김 시 보행 상태와 대기 입력을 비우고 음소거한다.
  다시 키나 포인터를 조작하면 재개한다. 세션은 재사용하고 컴포넌트 해제 시 닫는다.
- 패치 로딩 중 편집은 마지막 한 건, 이동은 최신 상태만 보존한다. 모드 전환 시
  대기 입력을 취소한다. 로딩 실패는 편집·이동을 막지 않으며 다음 클릭에서 재시도한다.
- 게임 이벤트는 `whistle-event <이름> 1/0`으로 보낸다(`fallingstar`: 디버그 화면에서 1 키로 켜고 끔. `rain`: 날씨가 비이면 1).

좌표는 어댑터에서 `(gridCoordinate + 0.5) / world.size`로 정규화한다.
높이는 장면의 발 높이다. 3D 오디오는 연속 시험음으로 연결했으며,
최종 발걸음 샘플·착지 소리·개별 바위 오브젝트 접촉음은 아직 구현하지 않았다.
현재 아이콘 ID, 추가/삭제, 지면 종류는 패치로 전달되지만 개별 아이콘 음색은 아직 지정하지 않았다.

### 믹스 구조와 지형 사운드스케이프 (`components/whistle/useGameAudio.ts`)

```text
edit.pd · player.pd(→ 이동음 게인) · event.pd ─┐
층별 영역 패치들(패닝 + 가운데 경로) ────────────┼─→ 마스터 게인 → 리미터 → 출력   (AudioContext 1개)
배치한 녹음 사운드(Pd 슬롯 placed_sound) ─────────┘
```

- 상호작용 패치는 `edit`(whistle-edit), `player`(whistle-player·whistle-board-height),
  `event`(whistle-event) 세 개로 나뉜다. 받는 값은 [`pd-receive.md`](pd-receive.md).
- 음소거(편집 화면 복귀·blur·탭 숨김)는 `whistle-gate` 대신 마스터 게인 fade로 한다. 3D 이동음 정지는 `whistle-player-stop`(bang)을
  보낸다(상호작용 패치가 믹스다운 한 쌍에 섞여 JS가 이동음만 따로 끌 수 없으므로). 다시 켜는 것은 다음 `whistle-player` 메시지로 패치가 한다.
- 소리의 단위는 **층별 영역**이다. 입력은 `world-derivation`의 결과(지형 타일 + `environment` + `structures`)이고,
  층마다 같은 종류끼리 이어진 칸을 묶는다(위에서 내려다본 섬). 한 칸이 여러 층에 동시에 속할 수 있다
  (예: 번짐 칸 위에 풀과 안개가 있으면 surface·grass·fog 세 영역에 모두 속해 각각 소리가 난다).

  | 층 | 속하는 칸 | 농도(whistle-region으로 보냄) |
  |---|---|---|
  | surface | 구멍이 아닌 칸. 종류(빈 타일·거침·흐름·번짐)별로 묶음 | 1 |
  | water | `cell.water !== null` | 1 |
  | grass | `cell.grass > 0` | grass |
  | tree | `cell.tree`(대각선도 이어서 숲 하나) | 1 |
  | fog | `cell.fog > 0` | fog |
  | wind | 바람 세기 > 0 | 바람 세기 |
  | structure | 계단·다리·캐노피. 하나하나가 따로 소스, 높이는 구조물 높이 | 1 |

  같은 종류라도 떨어진 섬은 각각 소스가 되고, 구멍은 surface 영역을 끊는다. 높이는 영역을 나누지 않는다.
  맵(지형·환경·구조물 객체)이 바뀔 때만 다시 나눈다(`terrainRegions`).
- 3D 플레이 중 오디오 프레임(80ms)마다 `lib/audio/game-soundscape.ts`가
  - 리스너를 발 높이 + 1.35m(눈높이), yaw 방향으로 옮기고,
  - 칸을 한 변 1인 정사각형으로 보고, 플레이어에서 각 영역 외곽까지 유클리드 거리 d를 잰다(영역 안이면 0).
  - 모든 층에서 d ≤ 3타일인 영역을 모아 **층을 가리지 않고 가까운 순**으로 최대 6개 켠다(fade in/out).
  - 음원 위치: 영역 외곽에서 플레이어에게 가장 가까운 점(안이면 플레이어 위치). 높이는 그 칸의 높이.
  - 음량: 1 − d/3(반경에서 0, 외곽·안에서 1). 패너의 거리 감쇠는 쓰지 않는다(`rolloff: 0`).
  - 패닝: width = 1 − d/2(`blend` 2타일). 0이면 패닝만, 1이면 방향 없이 좌우 모두 1.
    다가갈수록 양쪽이 강해지며 패닝 차이가 줄어 외곽에 닿으면 좌우 1, 안에서는 계속 좌우 1.
  - 농도(풀·안개·바람 세기)는 음량·위치에 쓰지 않는다. 가장 가까운 칸의 값을 영역 패치로 보낸다:
    **`whistle-region`의 `amount` [농도 0~1]** (나머지 층은 1)와 `distance` [타일]. 값이 바뀔 때만 보낸다(받는 법은 `pd-receive.md`).
  - 이미 켜진 영역은 d ≤ 3.5까지 유지하고, 거리 순위에서 0.5타일 가깝게 쳐서 경계에서 깜빡이지 않는다.
  - 여러 소리가 더해진 음량은 마지막 리미터가 받는다.
- 편집 화면 복귀·일시정지 시 켜진 영역을 모두 fade out한다. fade가 끝난 노드는 오디오 시계 기준으로 정리된다.
- 좌표: 격자 (x, z) → 장면 `n × 2 − size + 1`(타일 한 칸 2m), 높이 `tile.height × LEVEL`.
  종류 → 패치 매핑(`KIND_PATCHES`: plain·rough·slick·soft·water·grass·tree·fog·wind·stairs·bridge·canopy)은 지금 모두 `terrain_clock`.
- 콘솔 로그(`[Whistle:Audio]`): 오디오 시작(준비까지 걸린 시간), 소리 영역 등록 개수(종류별),
  영역별 켜짐/꺼짐, 로드 실패(warn).
- 엔진은 메인 스레드에서 로드되므로 무거운 3D 렌더링 중에는 늦다(GPU 없는 headless UWB 페이지에서 약 18초, 실험 페이지 0.4초).

게임 화면 연결은 단위 테스트(`tests/game-soundscape.test.ts`, `tests/terrain-sources.test.ts`)와
실제 브라우저에서의 청취로 확인한다. GPU 없는 headless 브라우저에서는 3D 장면이 너무 느려
게임 화면 브라우저 테스트가 클릭 단계에서 멈추므로 자동화하지 않았다.

## 최소 테스트 구현

- 원본: `audio/patches/uwb-player.pd` (`player3.pd`를 불러옴)
- 엔진: pd4web(위 "Pd 엔진" 참고)
- 브리지: `lib/audio/pd-runtime.ts`(엔진·슬롯) · `lib/audio/pd-session.ts`(상호작용 패치의 버스 인터페이스)
- 게임 연결: `components/whistle/useGameAudio.ts`, `lib/audio/game-audio.ts`, `lib/audio/game-parameters.ts`
- 수동 테스트: `audio-lab/index.html`
- 다중 패치 실험: `audio-lab/soundscape.html`, 회귀 테스트 `tests/browser/soundscape-lab.spec.ts`

패치가 받는 버스와 값의 순서·범위·뜻은 [`pd-receive.md`](pd-receive.md)에 정리했다(`whistle-gate`, `whistle-ready`는 더 이상 쓰지 않는다).

UWB 테스트의 보드 높이는 현실 바닥 기준 미터 값이며, 가상 지면/발 높이 `y`와 별개다.
`InteractionSession.boardHeight()`로 별도 버스에 보내며 유한하지 않거나 0~10m 범위 밖이면 거부한다.
UWB 페이지에서 숫자 또는 JSON의 `boardHeight`로 시험한다. 높이만 바뀌어도 시험음에 반영된다.
일반 게임은 이 버스를 보내지 않으므로 기존 시험음과 동작을 유지한다.

X/Z·겹침·풀·바위 값은 0–1로 제한한다.
유한하지 않은 숫자는 전송하지 않는다. 테스트 음은 최종 사운드 디자인이 아니며,
X에 따른 좌우 출력도 실제 플레이어 방향을 고려한 3D 공간음향은 아니다.

오디오는 클릭으로 시작한다. 세션 `close()`는 출력만 떼고 엔진·`main.pd`·AudioContext는 페이지와 함께 계속 산다(게임은 suspend).
테스트 페이지가 숨겨지면 음소거하며 사용자가 해제한다. 마이크 입력은 사용하지 않는다.

## 실행

```sh
npm ci
npm run dev:audio
```

Vite에 표시된 주소 뒤에 `audio-lab/index.html`을 붙여 연다.
기본 주소는 `http://127.0.0.1:5173/whistle/audio-lab/index.html`이다.
`오디오 시작`을 클릭하고 두 입력 그룹을 조작한다. `오디오 종료`로 정지한다.

```sh
npm run test:audio
npm test
npm run build
```

빌드 결과에도 `/whistle/audio-lab/index.html` 테스트 페이지가 포함된다.

### 사운드스케이프 엔진

```text
패치 노드 → 게인(fade·음량) ─┬→ PannerNode(3D) → 패닝 게인 ──────────────┬→ 마스터 → 출력   (AudioContext 1개)
                             └→ 가운데 게인 ─(diffuse면 → 공유 확산 버스)─┘
```

- width(0~1): 패닝 경로(PannerNode)와 가운데 경로를 섞는다.
  - 기본(필터 없음): 가운데 경로는 같은 신호를 좌우에 그대로 보낸다(모노 → 좌우 1). 같은 신호끼리라 직선으로 섞는다
    (패닝 1 − width, 가운데 width). 측정(오른쪽 옆 소스): width 0 → L 0 / R 1, 0.5 → 0.5 / 1, 1 → 1 / 1.
  - `diffuse: true`(게임에서는 주소에 `?diffuse`, 실행 중에는 **F 키**로 켜고 끔. `setDiffuse()`): 가운데 경로를 공유 확산 버스로 보낸다. 모노로 모은 뒤
    왼쪽·오른쪽에 서로 다른 all-pass 필터 4개씩을 걸어 좌우를 다르게(비상관) 만들고 equal-power로 섞는다.
    필터가 소리를 바꿀 수 있어 기본은 끔. 측정(정면, 잡음): 좌우 상관 width 0 → 1.00, 0.5 → 0.56, 1 → 0.31.
- `messages`: 소스마다 패치로 보낼 메시지(버스 → 값). 값이 바뀔 때만 보낸다. 패치에 없는 버스는 건너뛴다.

- `lib/audio/pd-runtime.ts`: 엔진은 페이지당 1개. 패치 폴더는 엔진이 켜질 때 한 번 통째로 넣는다.
  만든 노드는 연결하지 않고 돌려준다.
- `lib/audio/soundscape.ts`: 소스 등록(`set`)만으로는 노드를 만들지 않는다.
  `activate`에서 로드·연결하고 fade in, `deactivate`에서 fade out 후
  `update()`(매 프레임)가 오디오 시계 기준으로 노드를 정리한다. 타이머는 쓰지 않는다.
  로딩 중 끄기, fade out 중 다시 켜기(같은 노드로 현재 값에서 복귀), 로드 실패 후 재시도를 처리한다.
- 좌표는 3D 장면 좌표(미터). 리스너는 위치와 바라보는 방향 벡터로 설정한다.
  타일 좌표 변환과 yaw → 방향 벡터 변환은 게임 연결 쪽 책임이다.
- 패닝 기본값은 equalpower(가벼움, 좌우 뚜렷, 앞뒤 구분 없음). HRTF(앞뒤·높이 단서,
  더 무거움)는 `panning: "HRTF"` 옵션. 성능을 확인한 뒤 HRTF로 옮기는 것이 목표다.
  HRTF에서 저음은 좌우 음량차가 작고 방향감은 주로 도달 시간차로 생긴다.
- 실험 페이지: `audio-lab/soundscape.html` (`?panning=hrtf`로 비교).
  평면도를 클릭해 패치를 놓고 리스너 방향을 돌린다.

게임 화면(`/whistle/`)에서는 격자를 편집하거나 플레이를 시작하면 연결된다.
실험 페이지에서는 같은 패치에 직접 입력한 파라미터를 보내 비교할 수 있다.
비주얼과 플레이어 이동 로직은 유지했다. 기존 이벤트음은 Pd 합성으로 교체되어 감쇠 특성이 다를 수 있다.

## 검증 범위

upstream의 사인파 시험 패치(`interaction-test.pd`)와 그 브라우저 테스트
(`audio.spec.ts`, `game-audio.spec.ts`)는 현재 패치와 맞지 않아 폐기했다.
위 버스 표의 주파수 설명은 그 시험 패치 기준이며, 기존 엔진 교체 시 함께 정리한다.

`tests/soundscape.test.ts`는 가짜 AudioContext로 엔진의 연결 순서, fade 램프 값,
오디오 시계 기준 정리, 로딩 중 끄기·다시 켜기, 실패 후 재시도, dispose를 확인한다.

`tests/browser/soundscape-lab.spec.ts`는 실험 페이지에서 Chromium과 Firefox로 다음을 확인한다
(`npm run test:audio`가 둘 다 실행. Firefox는 AudioListener의 AudioParam이 없어 예전 API로 설정한다).

- equalpower(기본): 리스너 정확히 왼쪽의 소리는 R 채널 무음, 뒤로 돌면 L 채널 무음(기하 검증)
- HRTF(옵션): AudioContext 1개에서 엔진 생성 1회, 패치 인스턴스 2개 동시 실행,
  끄면 fade 후 노드 정리·무음, 다시 켜기, 종료, 콘솔 오류 없음

HRTF의 공간감(앞뒤·거리감)은 귀로 확인한다.

## 참고

- [pd4web](https://github.com/charlesneimog/pd4web): 엔진, CLI, JS API(`pd4web.d.ts`).
- 성능(2026-11-21, i5-7200U 3.1GHz 고정, headless Chromium, 코어 하나 기준): grass 1개 WebPd 11.1% / pd4web 8.7%,
  grass 6개 WebPd 51%(노드 6개)·48%(패치 하나에 6개) / pd4web 23%(엔진 하나).
