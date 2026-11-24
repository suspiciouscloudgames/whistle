# Pd → JS 메시지

패치가 `[s 이름]`으로 보낸 것을 JS가 받을 수 있다. 엔진(pd4web 3.4.1)을 다시 빌드하지 않아도 된다.
**아직 앱에서는 쓰지 않는다**(받는 코드가 없음). 아래는 시험으로 확인한 동작과 쓰는 법이다(2026-11-24, 크로미움·Firefox).

## 확인한 것

- 오디오 랩에서 `[r probe-in]`을 받아 `[s probe-out]`, `[s probe-bang]`, `[s probe-list]`로 다시 내보내는 패치를 만들고,
  JS에서 `onFloatReceived`, `onBangReceived`, `onListReceived`로 받아 보니 모두 들어왔다.
- 엔진은 출력이 스피커 쪽에 연결된 패치가 하나라도 있을 때만 돈다. 브라우저는 출력이 아무 데도 이어지지 않은 오디오 노드는 돌리지 않는다.
  슬롯을 하나도 안 띄운 상태에서는 Pd가 멈춰 있고, JS가 보낸 메시지도 대기열에 쌓여만 있다.
  게임에서는 소리가 나는 동안 항상 슬롯이 떠 있으니 문제가 안 된다.

## 메시지가 오는 길 (pd4web C++ 소스로 확인)

- Pd는 오디오 스레드에서 돈다. `[s 이름]`이 JS가 등록한 이름으로 나가면 libpd의 대기열(링버퍼)에 들어간다.
- 메인 스레드가 1ms 간격 타이머로 그 대기열을 비우면서 JS 콜백을 부른다. 그래서 콜백은 메인 스레드에서 안전하게 불린다.
- 몇 ms 늦게 온다. 탭이 뒤로 가면 브라우저가 타이머를 늦춰 더 늦다. 게임 이벤트(발소리가 났다, 끝났다)에는 충분하고,
  샘플 단위로 맞춰야 하는 데는 맞지 않는다.
- 대기열 크기가 정해져 있어 넘치면 버려진다. 매 블록마다 보내지 말고 값이 바뀔 때만 보낸다.

## 쓰는 법

Pd 쪽은 따로 할 일이 없다. 평소처럼 `[s 이름]`(또는 메시지 박스 `[; 이름 값(`)으로 보낸다.
JS 쪽은 그 이름을 받겠다고 엔진에 알린다(등록). libpd를 쓰는 다른 환경(Android·iOS의 `PdBase.subscribe`,
C의 `libpd_bind`)과 같은 방식이다.

**이름마다 보내는 종류를 하나로 정하고, JS는 그 종류에 맞는 함수로 등록한다.** 종류마다 함수가 따로 있다.

| Pd 쪽 (예: `[s foot]`에 들어가는 것) | 등록 함수 | 콜백 모양 | 받는 값 |
| --- | --- | --- | --- |
| `bang` | `onBangReceived` | `(이름) => …` | `"foot"` |
| `0.5` | `onFloatReceived` | `(이름, 값) => …` | `"foot"`, `0.5` |
| `symbol grass` | `onSymbolReceived` | `(이름, 값) => …` | `"foot"`, `"grass"` |
| `1 2 x` (숫자로 시작하는 리스트) | `onListReceived` | `(이름, 값들) => …` | `"foot"`, `[1, 2, "x"]` |
| `step grass 0.5` (글자로 시작하는 메시지) | `onMessageReceived` | `(이름, 선택자, 값들) => …` | `"foot"`, `"step"`, `["grass", 0.5]` |

```js
const pd = window.Pd4Web;
pd.onFloatReceived("foot", (name, value) => console.log(name, value));        // [0.5( → [s foot]
pd.onMessageReceived("step", (name, selector, values) => {                     // [grass 0.5( → [s step] 이면 selector "grass"
  console.log("발소리", selector, values[0]);
});
```

종류가 맞지 않으면 오지 않는다. `onFloatReceived`로 등록한 이름에 Pd가 `symbol grass`를 보내면 콘솔에
"Callback not found or not a function"만 찍힌다.

pd4web은 같은 이름을 두 번 등록하면 겹쳐 불렸다. 런타임에서 고쳐, Pd의 `[r]`처럼 같은 이름을 여럿이 받는다([`pd-to-js-fix.md`](pd-to-js-fix.md)).
