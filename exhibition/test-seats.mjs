import { chromium } from "playwright";
import { expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import assert from "node:assert/strict";

const app = resolve(process.argv[2]);
const {createServer} = await import("node:net");
const probe = createServer().listen(0,"127.0.0.1");
await once(probe,"listening");
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const relay = spawn(process.execPath, [join(app, "scripts/run.mjs")], {
  cwd: app, env: {...process.env, PORT:String(port), HOST:"127.0.0.1"}, stdio:["pipe","pipe","inherit"],
});
const profiles = await mkdtemp(join(tmpdir(),"whistle-seats-"));
const contexts = [];
const url = 'http://127.0.0.1:' + port + '/?meeting=exhibition';
const ready = createInterface({input:relay.stdout});
const exited = once(relay,"exit");
try {
  assert.match((await Promise.race([once(ready,"line"),exited]))[0],/^Whistle:/);
  const script = await readFile(join(app,"seat.js"),"utf8");
  const launch = async name => {
    const context = await chromium.launchPersistentContext(join(profiles,name),{
      locale:"ko-KR",headless:true,viewport:{width:1024,height:768},args:["--enable-unsafe-swiftshader"]
    });
    contexts.push(context);
    context.setDefaultTimeout(20000);
    await context.addInitScript({content:
      'window.chrome ??= {}; window.chrome.webview = new EventTarget(); window.chrome.webview.postMessage = () => {};\n' + script
    });
    const page = context.pages()[0];
    page.on("pageerror",err => console.error("PAGE",err.message));
    await page.goto(url);
    await expect(page.locator("main")).toHaveAttribute("data-meeting-status","online",{timeout:30000});
    return page;
  };
  console.log("Local exhibition relay ready");
  const [a,b] = await Promise.all(["a","b"].map(launch));
  await Promise.all([a,b].map(p => expect(p.locator(".presence-number")).toHaveText("2")));
  assert.notEqual(await a.locator("main").getAttribute("data-meeting-id"),await b.locator("main").getAttribute("data-meeting-id"));
  console.log("Two independent players joined");
  const write = async (page, keys, result) => {
    await page.getByRole("button",{name:/^장면 제목 (입력|편집)$/}).click();
    const text = page.getByRole("textbox",{name:"텍스트 입력",exact:true});
    await page.getByLabel("글자 색",{exact:true}).click();
    const picker = page.getByRole("dialog",{name:"색 선택",exact:true});
    await picker.getByRole("slider").first().click({position:{x:40,y:5}});
    await picker.getByRole("button",{name:"적용",exact:true}).click();
    await text.click();
    for (const name of keys) await page.locator('[aria-label="화면 키보드"]').getByRole("button",{name,exact:true}).click();
    await expect(text).toHaveValue(result);
    await page.locator('[aria-label="화면 키보드"]').getByRole("button",{name:"닫기",exact:true}).click();
    await page.getByRole("dialog").getByRole("button",{name:"저장",exact:true}).click();
  };
  await Promise.all([write(a,["ㄱ","ㅏ","ㅇ"],"강"),write(b,["ㅂ","ㅏ","ㄷ","ㅏ"],"바다")]);
  for (const [page,text] of [[a,"바다"],[b,"강"]]) {
    await expect(page.getByRole("button",{name:"배치: "+text,exact:true})).toBeVisible({timeout:75000});
  }
  console.log("Two isolated seats composed Korean and exchanged materials in both directions.");
  await Promise.all([a,b].map(p=>p.getByRole("button",{name:"플레이",exact:true}).click()));
  await Promise.all([a,b].map(p=>expect(p.locator(".play-shell canvas")).toHaveAttribute("data-ready","true",{timeout:45000})));
  async function holdStick(p,dx) {
    const stick = p.locator(".stick");
    const box = await stick.boundingBox();
    await p.mouse.move(box.x + box.width / 2,box.y + box.height / 2);
    await p.mouse.down();
    await p.mouse.move(box.x + box.width / 2 + dx,box.y + 16,{steps:3});
    await expect(stick.locator("span")).not.toHaveCSS("transform","matrix(1, 0, 0, 1, 0, 0)");
  }
  await Promise.all([holdStick(a,8),holdStick(b,-8)]);
  await a.mouse.up();
  assert.notEqual(await b.locator(".stick-knob").evaluate(el=>getComputedStyle(el).transform),"matrix(1, 0, 0, 1, 0, 0)");
  await b.mouse.up();
  console.log("Both 3D scenes rendered; releasing one drag preserved the other seat's held stick.");
  await Promise.all(contexts.splice(0).map(c=>c.close()));
  const restored = await Promise.all(["a","b"].map(launch));
  for (const [i,title] of ["강","바다"].entries()) {
    await restored[i].getByRole("button",{name:"장면 제목 편집",exact:true}).click();
    await expect(restored[i].getByRole("textbox",{name:"텍스트 입력",exact:true})).toHaveValue(title);
  }
  console.log("Seat worlds survived browser restart.");
} finally {
  await Promise.allSettled(contexts.map(c=>c.close()));
  ready.close();
  relay.stdin.end();
  await exited;
  await rm(profiles,{recursive:true,force:true});
}
