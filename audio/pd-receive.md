# 패치에서 받을 수 있는 값

모든 패치는 Pd 엔진 하나 안에서 같이 돈다. 그래서 **전역 이름은 어느 패치에서나 그대로 받을 수 있다.**
`environment_*.pd`에서 플레이어 상태가 필요하면 `[r whistle-player]`를 놓으면 된다. `player.pd`가 받는 것과 같은 값이 동시에 들어온다.

`whistle-player`와 `whistle-region`은 Pd 메시지 상자처럼 이름이 앞에 붙어 온다(`position 0.5 0 0.5`). `[route]`로 나눈다.
나머지는 숫자 리스트라 `[unpack]`으로 나눈다(글자가 섞이면 `s`: `[unpack f f f s s s]`).

| 받는 이름 | 나누기 | 언제 오나 |
|---|---|---|
| `whistle-player` | `[route position yaw stat footed speed]` | 3D 플레이 중 약 0.08초마다(다섯 가지 모두) |
| `$1-whistle-region` | `[route amount distance]` | 영역 패치만. 켜질 때와 값이 바뀔 때 |
| `whistle-edit` | `[unpack f f f s s s]` | 편집 화면에서 칸을 바꿀 때 |
| `whistle-event` | `[route fallingstar rain]` | 게임 이벤트 켬 1 / 끔 0(3D 플레이 중) |
| `whistle-board-height` | 숫자 하나 | UWB 테스트 페이지에서만 |
| `whistle-player-stop` | bang | 3D 이동음을 끌 때(UWB 테스트 페이지 등). 다음 `whistle-player`부터 다시 소리를 내는 것은 패치가 한다 |
| `whistle-sound-bank` | `<이름> <경로>` | `main.pd`의 `[pd sound_bank]` 전용. 업로드한 소리를 `[pd sounds]`의 `<이름>-L`·`<이름>-R` 배열로 읽는다(맵의 소리마다 한 번) |
| `$1-whistle-sound` | `[route set distance]` | `placed_sound.pd` 전용. `set <이름>-L [<이름>-R]`(모노면 -L만, 열 때 한 번) · `distance <타일> <반경>` 플레이어까지 거리와 들리는 반경(열 때와 그 뒤 매 프레임). 지금 패치는 거리/반경을 `[moving_average 10]`으로 고른 뒤 재생 빠르기로 쓴다(가까우면 0.5배, 반쯤이면 1배, 가장자리 2배) |
| `whistle-slot` | `[route on off]` | `main.pd` 전용. 영역 켜기 `on 번호 패치 이름 L R`, 끄기 `off 번호`([`main-pd.md`](main-pd.md)) |

## whistle-player (플레이어 상태)

```
[r whistle-player]
|
[route position yaw stat footed]
```

| route | 값 | 뜻 |
|---|---|---|
| `position` | `x y z` | `x` 0~1 지도 위 동서 위치(0 서쪽 끝, 1 동쪽 끝) · `y` 발 높이(미터, 가상 지면 기준) · `z` 0~1 남북 위치(0 북쪽 끝, 1 남쪽 끝) |
| `yaw` | `a` | 바라보는 방향(라디안). 0 = 북(−z), π/2 = 동(+x). 한 바퀴 돌아도 0으로 돌아가지 않고 계속 커지거나 작아진다 |
| `stat` | `crouch run grounded falling` | 모두 0/1. 웅크림 · 달리기(지금은 켤 방법이 없어 늘 0) · 땅에 서 있음(점프·낙하·비행 중 0) · 구멍에 떨어지는 중 |
| `footed` | `grass water` | 발밑. `grass` 0~1 발밑 풀 농도(칸 사이를 매끄럽게 섞은 값) · `water` 0/1 발이 물속(수면 아래)이면 1 |
| `speed` | `v` | 땅 위에서 움직이는 빠르기(칸/초, 수평). 0.08초마다 위치 변화로 재고, 튀지 않게 앞 값과 절반씩 섞는다. 걷기 약 1.5, 서 있으면 0. 지금 쓰는 패치는 없다(paulstretch~ 시험 때 배율에 썼다) |

편집 화면으로 돌아가거나 일시정지하면 보내지 않는다(마지막 값이 그대로 남는다).

### footed와 영역 값의 차이

- `footed grass`는 정확히 발밑 값이다. 풀밭 밖이면 0이고, 칸 경계를 넘을 때 매끄럽게 바뀐다.
  grass 영역의 `amount`는 그 영역에서 플레이어와 가장 가까운 칸의 값이라, 풀밭 근처(밖)에서도 값이 있고 칸 단위로 바뀐다.
- `footed water`는 발이 수면 아래에 있는지다. water 영역의 `amount`는 늘 1이라("여기는 물") 들어갔는지는 알 수 없다.
- 거친 바닥 위인지는 따로 보내지 않는다. `terrain_rough` 영역의 `distance`가 0이면 그 위에 있는 것이다.

## $1-whistle-region (영역 패치 전용)

사운드스케이프 영역 패치(`terrain_*`, `environment_*`, `structure_*`)는 같은 패치가 여러 영역에 동시에 뜬다.
그래서 영역마다 따로 오는 값은 `$1`을 붙여 받는다. `$1`은 영역 이름(`v17`…, 띄울 때마다 새것)이다.

```
[r $1-whistle-region]
|
[route amount distance]
```

| route | 값 | 뜻 |
|---|---|---|
| `amount` | 0~1 | 플레이어에게 가장 가까운 칸의 농도. 풀·안개·바람은 그 세기이고, 나머지 층은 늘 1 |
| `distance` | 타일 | 플레이어에서 영역 가장자리까지 거리. 0이면 영역 안. 움직이는 동안 계속 바뀐다 |

영역의 음량, 위치, 패닝은 브라우저가 이미 처리한다. `distance`는 거리에 따라 음색을 바꾸고 싶을 때 쓰면 된다.

## whistle-edit (편집음)

| 순서 | 이름 | 뜻 |
|---|---|---|
| 1 | `x` | 바꾼 칸의 동서 위치 0~1 |
| 2 | `z` | 바꾼 칸의 남북 위치 0~1 |
| 3 | `overlap` | 그 칸에 겹친 환경의 정도 0~1(풀, 물, 안개, 어둠, 거친 바닥, 구조물 중 가장 큰 값) |
| 4 | `asset` | 놓거나 지운 물체 이름. 물체가 아니라 지형을 바꿨으면 `terrain` |
| 5 | `action` | `add`(놓음) · `remove`(지움) · `paint`(그 밖에 지형 바꿈) |
| 6 | `surface` | 그 칸의 바닥 종류(`plain` 등, 구멍이면 `hole`) |

게임은 여섯 값을 다 보낸다. 실험 페이지(`audio-lab`)는 앞의 세 값만 보낸다.

## whistle-event (게임 이벤트)

이벤트 이름과 값이 온다. `[route fallingstar rain]`을 지나면 1(켬) 또는 0(끔).

| 이벤트 | 언제 오나 |
|---|---|
| `fallingstar` `1`/`0` | 지금은 시험용: 3D 플레이 중 디버그 화면(백틱 키)을 켜고 1 키를 누를 때마다 1, 0, 1, … |
| `rain` `1`/`0` | 날씨가 비(편집 화면의 날씨 버튼)이면 1, 아니면 0. 3D 플레이를 시작할 때 한 번, 그 뒤로는 바뀔 때만 |

## whistle-board-height (UWB 테스트)

`height`: 현실 바닥에서 보드까지의 높이(0~10m). UWB 테스트 페이지에서만 오고, 게임에서는 오지 않는다.

## 참고

- 범위를 벗어난 값은 브라우저가 범위 안으로 잘라서 보낸다(보드 높이만 범위 밖이면 보내지 않는다).
- 받는 객체가 없어도 문제없다(Pd가 버린다).
- 보내는 쪽 코드: `lib/audio/pd-session.ts`(상호작용 버스), `lib/audio/game-soundscape.ts`(`whistle-region`).
  값의 출처: `components/whistle/Scene.tsx`(플레이어 상태), `lib/audio/terrain-sources.ts`(영역의 농도·거리).
