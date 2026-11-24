// 테스트에서만 pd4web 엔진 스크립트를 감싸 계측한다(앱 코드에는 계측을 넣지 않는다).
// - modules: 엔진(Pd4WebModule) 생성 횟수
// - starts : 슬롯에 띄운 패치 이름(띄운 순서대로)
// - pdOutputRms(): 엔진 전체 출력(모든 슬롯)의 RMS
import type { Page } from "@playwright/test";

export type PdProbe = { modules: number; starts: string[]; messages: { bus: string; value: (string | number)[] }[] };
export const ENGINE_SCRIPT = /\/audio\/engine\/pd4web\.js(\?|$)/;

export async function probePd(page: Page) {
  await page.addInitScript(() => { (window as unknown as { pdProbe: PdProbe }).pdProbe = { modules: 0, starts: [], messages: [] }; });
  await page.route(ENGINE_SCRIPT, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
;(() => {
  const original = Pd4WebModule;
  Pd4WebModule = async (...args) => {
    window.pdProbe.modules++;
    const module = await original(...args);
    const proto = module.Pd4Web.prototype, send = proto.sendMessage;
    proto.sendMessage = function (target, selector, list) {
      if (target === "whistle-slot" && selector === "on") window.pdProbe.starts.push(list[1]); // on 번호 패치 이름 L R
      if (/^whistle-/.test(target)) window.pdProbe.messages.push({bus: target + " " + selector, value: list});
      return send.call(this, target, selector, list);
    };
    const sendList = proto.sendList;
    proto.sendList = function (target, list) {
      if (/^whistle-/.test(target)) window.pdProbe.messages.push({bus: target, value: list});
      return sendList.call(this, target, list);
    };
    return module;
  };
})();
` });
  });
}

export const pdProbe = (page: Page) => page.evaluate(() => {
  const p = (window as unknown as { pdProbe: PdProbe }).pdProbe;
  return { modules: p.modules, starts: [...p.starts] };
});

export const pdMessages = (page: Page, bus: string) => page.evaluate(bus =>
  (window as unknown as { pdProbe: PdProbe }).pdProbe.messages.filter(m => m.bus === bus).map(m => m.value), bus);

export const pdOutputRms = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { Pd4WebAudioWorkletNode?: AudioWorkletNode; pdAnalyser?: AnalyserNode };
  const node = w.Pd4WebAudioWorkletNode;
  if (!node) return 0;
  if (!w.pdAnalyser) {
    // 엔진 출력은 슬롯 수×2 채널이라 채널마다 나눠 모노로 합친다(분석기의 다채널 다운믹스는 앞 채널만 볼 수 있다).
    const context = node.context;
    const split = context.createChannelSplitter(node.channelCount > 2 ? node.channelCount : 32);
    const sum = new GainNode(context, { channelCount: 1, channelCountMode: "explicit" });
    node.connect(split);
    for (let i = 0; i < split.numberOfOutputs; i++) split.connect(sum, i);
    w.pdAnalyser = new AnalyserNode(context, { fftSize: 4096, smoothingTimeConstant: 0 });
    sum.connect(w.pdAnalyser);
  }
  const wave = new Float32Array(4096);
  w.pdAnalyser.getFloatTimeDomainData(wave);
  return Math.sqrt(wave.reduce((sum, n) => sum + n * n, 0) / wave.length);
});

export async function probeOutputGain(page: Page) {
  await page.addInitScript(() => {
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (this: AudioNode, ...args: unknown[]) {
      if (args[0] instanceof AudioDestinationNode && this instanceof GainNode) {
        (window as unknown as { outputProbe: GainNode }).outputProbe = this;
      }
      return Reflect.apply(connect, this, args);
    } as typeof connect;
  });
}
export const outputGain = (page: Page) => page.evaluate(() =>
  (window as unknown as { outputProbe?: GainNode }).outputProbe?.gain.value);
