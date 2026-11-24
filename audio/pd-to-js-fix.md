# pd4web 받기(on…Received) 고친 것: 자세한 기록

쓰는 법은 [`pd-to-js.md`](pd-to-js.md). 이 파일은 왜, 무엇을 고쳤는지의 기록이다(2026-11-24, pd4web 3.4.1).
코드 위치는 엔진 빌드 캐시 `output/pd4web-engine/out/Pd4Web/` 기준.

## 증상

JS에서 같은 이름을 두 번 등록하면, Pd가 한 번 보낼 때 **마지막에 등록한 함수가 두 번** 불리고 앞의 함수는 불리지 않았다.

- `onFloatReceived("b", f1)` 다음 `onFloatReceived("b", f2)` → `0.5` 한 번 보내면 f2가 두 번, f1은 0번.
- 한 이름에 다섯 종류(bang·float·symbol·list·message)를 다 등록 → 무엇을 보내든 그 종류의 함수가 다섯 번.
- 인자 개수가 틀려 거부된 등록도 이후 겹침의 원인이 된다.

Pd에서는 `[r foot]`이 여러 개면 `[s foot]` 한 번에 각자 한 번씩 받는다. 이것과 다르게 동작했다.

## 원인 (코드)

등록 함수 하나가 Pd 쪽과 JS 쪽에 하나씩 만든다. `pd4web.cpp:747`

```cpp
void Pd4Web::OnFloatReceived(std::string r, emscripten::val func) {
    void *s = libpd_bind(r.c_str());            // ① Pd 쪽: 이름에 받는 객체를 하나 묶는다
    m_BindSymbols.push_back(s);
    ... 함수인지, 인자가 2개인지 검사 (틀리면 return) ...
    FloatReceiverListeners[m_PdInstance][r] = func;   // ② JS 쪽: 이름 → 함수를 표에 적는다
}
```

**① Pd 쪽.** `libpd_bind`(`pure-data/src/z_libpd.c:435`)는 `libpd_receive` 객체를 만들어 `pd_bind`로 이름에 묶는다
(`pure-data/src/x_libpdreceive.c`). Pd의 `[r]`도 같은 `pd_bind`로 이름에 묶인다(`x_connective.c:348`).
다른 점은 패치에 상자로 놓이지 않는 내장 객체라는 것(Pd의 `pd`처럼), 그리고 출구 대신 libpd 훅을 불러 JS 쪽 대기열로 넘긴다는 것.
같은 이름에 여럿이 묶이면 Pd는 목록을 두고 모두에게 전달한다. **등록할 때마다 하나씩 늘어난다.**

**② JS 쪽.** 표의 모양은 `pd4web.hpp:221`

```cpp
using ReceiverMap = std::unordered_map<std::string, emscripten::val>;   // 이름 → 함수 하나
```

대입이라 같은 이름이면 **앞의 함수를 덮어쓴다.**

**어긋남.** 같은 이름을 두 번 등록하면 Pd 쪽 받는 객체는 2개, JS 표의 함수는 1개(마지막 것).
Pd가 한 번 보내면 받는 객체마다 훅이 불려 대기열에 2개가 들어가고, 메인 스레드가 꺼낼 때마다(`ReceivedFloat`, `pd4web.cpp:912`)
표에서 같은 함수를 찾아 부른다. 그래서 마지막 함수가 2번 불린다.

**떼는 방법이 없다.** libpd 원래 설계는 묶을 때 받은 객체를 들고 있다가 그만 받을 때 `libpd_unbind`로 떼는 짝이다.
pd4web은 받은 객체를 `m_BindSymbols`(`pd4web.hpp:308`, 이름 목록이 아니라 받는 객체 목록)에 모아 두기만 하고,
엔진 객체가 없어질 때(`~Pd4Web`, `pd4web.cpp:1348`) 한꺼번에 뗀다. JS에는 떼기가 없다.
우리 엔진은 페이지당 하나라 페이지를 닫을 때까지 아무것도 떼어지지 않는다.

libpd에서 훅은 종류마다 전역 함수 하나뿐이고, 같은 이름을 여러 곳에 나눠 주는 것은 그 위 래퍼의 몫이다.
libpd의 Java 판 `PdDispatcher`는 이름마다 함수 목록을 두고 모두에게 나눠 준다. pd4web은 그 자리에 함수 하나짜리 표를 두었다.

## 고친 것 (`lib/audio/pd-runtime.ts`의 `shareReceivers`)

엔진을 만든 직후 `on…Received` 다섯 개를 감싼다(PdDispatcher와 같은 방식). 함수 이름과 콜백 모양은 pd4web 그대로.

- 처음 보는 이름이면 pd4web 원래 함수를 **한 번만** 부른다(받는 객체 하나). 넘기는 함수는 목록의 함수를 모두 부르는 함수.
- 이미 받는 이름이면 pd4web은 부르지 않고 목록에 더하기만 한다. 같은 함수를 두 번 등록해도 따로 센다(`[r]` 두 개처럼).
- 등록하면 **그만 받기 함수**를 돌려준다(목록에서 그 함수만 뺀다. 받는 객체는 남지만 아무도 부르지 않는다).
  pd4web 원래 함수는 아무것도 돌려주지 않으므로, 돌려준 값을 쓰지 않으면 예전과 같다. 슬롯을 다시 쓸 때 예전 함수를 떼는 데 쓴다.
- pd4web에는 인자 개수를 맞춘 우리 함수를 넘기므로, 쓰는 쪽 콜백은 인자 개수를 맞추지 않아도 된다(`(...args) =>`도 됨).
- 받는 함수 하나가 오류를 내도 나머지는 불린다(콘솔에 오류).

**남는 제약: 한 이름에 종류는 하나.** pd4web은 종류마다 따로 묶게 되어 있어서, 한 이름을 float와 list로 같이 받으면
받는 객체가 둘이 되어 다시 겹친다. 그래서 이미 다른 종류로 받는 이름을 등록하면 오류를 낸다.

## 시험

`tests/browser/pd-to-js.spec.ts`(크로미움·Firefox): 같은 이름 두 함수가 각자 한 번씩, 그만 받기 뒤에는 남은 것만,
`(...args) =>` 콜백, 다른 종류 등록은 오류, 다섯 종류의 받는 모양. 고치기 전 런타임에서는 실패한다.
