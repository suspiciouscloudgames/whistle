# 시뮬레이터: 서버 없이 main.pd 듣기

`simulator.pd`를 Pd(vanilla 0.56)로 열면 브라우저가 하는 일을 Pd가 대신한다.

- `[pd~]` 하위 프로세스에서 `../patches/main.pd`를 돌린다(32채널).
- 1–2번 채널은 그대로, 3–32번(영역 15개)은 영역마다 볼륨·방향(equal-power)·둘러싼 정도(dry/wet)를 거친다.
  모두 합쳐 볼륨 → 리미터(−3 dB, 20:1) → `dac~ 1 2`.
- 열면 DSP가 켜지고 main.pd가 시작된다. main.pd를 고쳐 저장했으면 `pd~ start …` 상자를 눌러 다시 시작한다
  (영역은 모두 꺼짐으로 돌아간다).

## 넣는 값

보내는 메시지는 게임과 같다([`../pd-receive.md`](../pd-receive.md), [`../main-pd.md`](../main-pd.md)).

| 패널 | 보내는 것 |
| --- | --- |
| player | `play`를 켜면 80ms마다 `whistle-player position x y z`, `yaw`, `stat`, `footed`. `stop` → `whistle-player-stop bang` |
| edit | `send` → `whistle-edit x z overlap asset action surface` |
| event | `send` → `whistle-event frequency gain pan` (옛 형식. 지금 게임은 `whistle-event fallingstar 1/0`, `rain 1/0`) |
| board | 숫자를 바꾸면 `whistle-board-height` |
| 영역 0–14 (`sim-slot~`) | 패치 이름을 적고 `on` → `whistle-slot on N 패치 vK L R`, 끄면 `off N`. `amount`·`dist` → `vK-whistle-region`(켜져 있을 때만, 켤 때 다시 보냄) |

영역 줄의 `gain`·`pan`·`width`는 브라우저가 거리와 방향으로 정하는 값을 손으로 넣는 것이다(Pd로는 가지 않는다).
`width` 0 = 한 점에서(패닝), 1 = 둘러싸는 소리(패치의 스테레오 그대로).
