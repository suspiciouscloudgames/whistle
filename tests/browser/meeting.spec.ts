import { savedWorld } from "./world-storage";
import { test, expect, chromium, type Page, type BrowserContext, type Browser } from "@playwright/test";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attachMeetingRelay } from "../../scripts/meeting/relay";
import { createMeetingWorld, type MeetingMessage, type MeetingView } from "../../lib/meeting";
import { createMeetingCodec } from "../../lib/meeting-wire";

test.setTimeout(600_000);
const players:BrowserContext[]=[];
async function newPlayer(browser:Browser,baseURL?:string) {
  const context=await browser.newContext({baseURL,locale:"ko-KR"});players.push(context);
  return context.newPage();
}
test.afterEach(async()=>{await Promise.all(players.splice(0).map(context=>context.close()));});

test("multiplayer is the default and toggles participation without losing the world",async({browser,baseURL},info)=>{
  const a=await newPlayer(browser,baseURL),b=await newPlayer(browser,baseURL),state=observe(a);
  let sockets=0;a.on("websocket",socket=>{if(socket.url().includes("/whistle/meeting?"))sockets++;});
  const url=`?meeting=toggle-${Date.now()}`;
  await a.goto(url);
  const toggle=a.getByRole("button",{name:"멀티플레이",exact:true});
  await expect(toggle).toHaveAttribute("aria-pressed","true");
  await ready(a);
  await expect(a.locator(".presence-number")).toHaveText("1");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed","false");
  await expect(toggle).toHaveAttribute("aria-description","혼자 플레이");
  await expect(a.locator(".presence-number")).toHaveText("1");
  await expect(a.locator(".presence-mark")).toHaveCSS("background-color","rgb(17, 17, 17)");
  expect(await a.locator(".presence-mark").evaluate(mark=>getComputedStyle(mark,"::after").content)).toBe('""');
  await writeTitle(a,"혼자 만든 재료");
  const original=await savedWorld(a);
  await a.screenshot({path:info.outputPath("solo-desktop.png")});
  await a.setViewportSize({width:390,height:844});
  await a.screenshot({path:info.outputPath("solo-mobile.png"),fullPage:true});
  expect(await a.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await a.setViewportSize({width:1280,height:720});
  await b.goto(url);await ready(b);await writeTitle(b,"이웃의 재료");
  await expect(b.locator(".presence-number")).toHaveText("1");
  await expect(b.locator(".received-material")).toHaveCount(0);
  await expect(a.locator(".received-material")).toHaveCount(0);
  expect(sockets).toBe(1);

  await a.bringToFront();await toggle.focus();await a.keyboard.press("Enter");await ready(a);
  await expect(toggle).toHaveAttribute("aria-pressed","true");
  await expect(a.locator(".presence-number")).toHaveText("2");
  await expect(b.locator(".presence-number")).toHaveText("2");
  await waitForGift(a,"이웃의 재료");
  await useText(a,"이웃의 재료");
  await expect(a.locator('[data-connection-online="true"]')).toHaveCount(1);
  await expect.poll(async()=>(await savedWorld(a)).connectionFootings?.some(p=>p.built)).toBe(true);
  await a.screenshot({path:info.outputPath("multiplayer-desktop.png")});
  const identityBefore = state.view().id, partnerBefore = state.view().recipients[0];
  const before=await savedWorld(a);
  expect(before.assets.find(asset=>asset.text==="혼자 만든 재료")).toEqual(original.assets.find(asset=>asset.text==="혼자 만든 재료"));
  await toggle.focus();await a.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-pressed","false");
  await expect(a.locator(".presence-number")).toHaveText("1");
  await expect(a.locator('[data-connection-online="true"], [data-approach-online="true"]')).toHaveCount(0);
  await expect(b.locator(".presence-number")).toHaveText("1");
  await expect.poll(async()=>(await savedWorld(a)).connectionFootings??[]).toEqual([]);
  expect({...await savedWorld(a),connectionFootings:[]}).toEqual({...before,connectionFootings:[]});
  await writeTitle(b,"혼자 모드에서는 받지 않음");
  await expect(a.getByRole("button",{name:"배치: 혼자 모드에서는 받지 않음",exact:true})).toHaveCount(0);
  expect(sockets).toBe(2);
  await writeTitle(a,"혼자 수정한 재료");
  await toggle.click();await ready(a);
  await expect(a.locator(".presence-number")).toHaveText("2");
  await expect.poll(()=>state.view().ownWorld.assets.some(asset=>asset.text==="혼자 수정한 재료")).toBe(true);
  await expect.poll(async()=>(await savedWorld(a)).connectionFootings?.length).toBe(1);
  expect(state.view().id).toBe(identityBefore);
  expect(state.view().recipients).toEqual([partnerBefore]);
  await a.reload();await ready(a);
  await expect(toggle).toHaveAttribute("aria-pressed","true");
  await expect(a.getByRole("button",{name:"배치: 혼자 수정한 재료",exact:true})).toBeVisible();
  expect(sockets).toBe(4);
  expect(state.errors).toEqual([]);
});

test("switching to solo cancels pending connection retries",async({page})=>{
  let attempts=0;
  await page.routeWebSocket(/\/whistle\/meeting\?/,socket=>{attempts++;socket.close();});
  await page.goto(`?meeting=cancel-${Date.now()}`);
  const toggle=page.getByRole("button",{name:"멀티플레이",exact:true});
  await expect.poll(()=>attempts).toBe(1);
  await expect(page.locator("main")).toHaveAttribute("data-meeting-status","offline");
  await toggle.click();
  await page.waitForTimeout(1500);
  expect(attempts).toBe(1);
  await expect(toggle).toHaveAttribute("aria-description","혼자 플레이");
  await expect(page.locator(".presence-mark")).toHaveCSS("background-color","rgb(17, 17, 17)");
  await toggle.click();
  await expect.poll(()=>attempts).toBe(2);
});

test("an unavailable relay keeps the editor usable and recovers when the server returns", async ({ page }) => {
  await page.addInitScript(()=>Object.defineProperty(crypto,"randomUUID",{value:undefined}));
  let attempts=0;
  await page.routeWebSocket(/\/whistle\/meeting\?/,socket=>{
    if(++attempts<3)socket.close();
    else socket.connectToServer();
  });
  await page.goto(`?meeting=retry-${Date.now()}`);
  await expect(page.getByRole("button",{name:"장면 제목 입력",exact:true})).toBeVisible();
  await ready(page);
  expect(attempts).toBe(3);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

function observe(page: Page) {
  let view: MeetingView | undefined;
  const errors: string[] = [];
  const whistles: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("websocket", socket => {
    if (!socket.url().includes("/whistle/meeting?")) return;
    const codec = createMeetingCodec();
    socket.on("framereceived", ({ payload }) => {
      const message = codec.decode<MeetingMessage>(payload.toString());
      if (!message) return;
      if (message.type === "state") view = message.view;
      if (message.type === "whistle") whistles.push(message.whistle.id);
    });
  });
  return { view: () => view!, errors, whistles };
}

test("a dropped connection unlocks both editors and restores the pair and offline edits", async ({browser,baseURL}) => {
  const a = await newPlayer(browser,baseURL), b = await newPlayer(browser,baseURL);
  const first = observe(a), second = observe(b);
  await b.addInitScript(() => {
    const NativeSocket = window.WebSocket;
    window.WebSocket = class extends NativeSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url,protocols);
        if (String(url).includes("/whistle/meeting?"))
          window.addEventListener("drop-meeting-connection",() => this.close(),{once:true});
      }
    };
  });
  const room = `?meeting=network-loss-${Date.now()}`;
  await a.goto(room); await ready(a);
  await b.goto(room); await ready(b);
  await expect(b.locator(".workspace [data-turn]")).toHaveAttribute("data-turn","other");
  const original = second.view().recipients[0];
  await b.context().setOffline(true);
  await b.evaluate(() => window.dispatchEvent(new Event("drop-meeting-connection")));
  for (const page of [a,b]) {
    await expect(page.locator(".presence-number")).toHaveText("1");
    await expect(page.locator(".workspace [data-turn]")).toHaveCount(0);
  }
  const before = (await savedWorld(b)).terrain!.tiles[126].height;
  await b.getByRole("button",{name:"높이기",exact:true}).click();
  await b.locator('[data-cell="126"]').click({position:{x:2,y:2}});
  await expect.poll(async () => (await savedWorld(b)).terrain!.tiles[126].height).toBeGreaterThan(before);
  await b.context().setOffline(false);
  await ready(b);
  await expect.poll(() => second.view().recipients).toEqual([original]);
  await expect.poll(() => second.view().ownWorld.terrain!.tiles[126].height).toBeGreaterThan(before);
  await expect(a.locator(".presence-number")).toHaveText("2");
  await expect(b.locator(".workspace [data-turn]")).toHaveAttribute("data-turn","other");
  expect(first.view().recipients).toEqual([second.view().id]);
  expect([...first.errors,...second.errors]).toEqual([]);
});

test("browser storage restores my world and edited gifts after both the browser and relay restart",async({browser,baseURL})=>{
  const profile=await mkdtemp(join(tmpdir(),"whistle-browser-world-"));
  let port=0;
  const start=async()=>{
    const server=createServer(),relay=attachMeetingRelay(server);
    server.listen(port,"127.0.0.1");await once(server,"listening");port=(server.address() as {port:number}).port;
    return async()=>{await relay.close();await new Promise<void>(resolve=>server.close(()=>resolve()));};
  };
  let stop=await start();
  const direct=async(context:BrowserContext)=>context.addInitScript(port=>{
    localStorage.setItem("whistle.language","ko");
    const Original=WebSocket;
    window.WebSocket=class extends Original {
      constructor(address:string|URL,protocols?:string|string[]) {
        const url=new URL(address,location.href);
        if(url.pathname==="/whistle/meeting")url.port=String(port);
        super(url,protocols);
      }
    };
  },port);
  const launch=async()=>{
    const context=await chromium.launchPersistentContext(profile,{channel:"chromium",headless:true,locale:"ko-KR"});
    await direct(context);return context;
  };
  let local=await launch();const peer=await browser.newContext({locale:"ko-KR"});await direct(peer);
  const url=new URL("?meeting=browser-persistence",baseURL).href;
  try {
    const a=await local.newPage(),b=await peer.newPage();let state=observe(a);
    await b.goto(url);await ready(b);await writeTitle(b,"받은 재료");
    await a.goto(url);await ready(a);await writeTitle(a,"내가 만든 세계");await waitForGift(a,"받은 재료");
    await editMaterial(a,"받은 재료");
    await a.getByRole("textbox",{name:"텍스트 입력",exact:true}).fill("내가 바꾼 재료");
    await a.getByRole("dialog").getByRole("button",{name:"저장",exact:true}).click();
    await useText(a,"내가 바꾼 재료");
    await expect.poll(()=>{
      const world=state.view().ownWorld;
      const gift=world.assets.find(v=>v.text==="내가 바꾼 재료"&&v.received);
      return world.objects.some(o=>o.asset===gift?.id);
    }).toBe(true);
    await expect(a.getByRole("button",{name:"파일 저장",exact:true})).toHaveAttribute("aria-description","이 브라우저에 저장됨");
    const saved=state.view().ownWorld;
    const download=a.waitForEvent("download");await a.getByRole("button",{name:"파일 저장",exact:true}).click();
    await a.getByRole("dialog").getByRole("button",{name:"로컬 저장",exact:true}).click();
    const exported=await download;const stream=await exported.createReadStream();const chunks:Buffer[]=[];
    for await(const chunk of stream!)chunks.push(Buffer.from(chunk));
    const file=JSON.parse(Buffer.concat(chunks).toString());expect(file.assets.some((a:any)=>a.text==="내가 바꾼 재료"&&a.received)).toBe(true);
    await local.close();await peer.close();await stop();stop=await start();
    local=await launch();const reopened=await local.newPage();state=observe(reopened);
    await reopened.goto(url);await ready(reopened);
    await expect.poll(()=>state.view().ownWorld.assets.some(a=>a.text==="내가 바꾼 재료"&&a.received)).toBe(true);
    expect({...state.view().ownWorld,connectionFootings:[]}).toEqual({...saved,connectionFootings:[]});
    await expect(reopened.locator("[data-connection], [data-approach]")).toHaveCount(0);
    await expect(reopened.locator(".received-material")).toHaveCount(1);
    await expect(reopened.locator(".meeting-material-count")).toHaveCount(0);
    expect(state.errors).toEqual([]);
  } finally {
    await peer.close();await local.close();await stop();await rm(profile,{recursive:true,force:true});
  }
});
async function ready(page: Page) {
  await page.bringToFront();
  const toggle=page.getByRole("button",{name:"멀티플레이",exact:true});
  await expect(toggle).toBeVisible();
  if(await toggle.getAttribute("aria-pressed")==="false")await toggle.click();
  await expect(page.locator("[data-meeting-status]")).toHaveAttribute("data-meeting-status", "online", { timeout: 30_000 });
  await expect(page.locator(".live-preview canvas")).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
  await expect(page.getByRole("button",{name:"파일 저장",exact:true})).toHaveAttribute("aria-description","이 브라우저에 저장됨");
}
async function paint(page: Page, points: [number,number][], surface="바닥") {
  await page.bringToFront();
  await page.getByRole("button", { name: surface, exact: true }).click();
  const rows=new Map<number,Set<number>>();
  for(const [x,z] of points){if(!rows.has(z))rows.set(z,new Set());rows.get(z)!.add(x);}
  for(const [z,cells] of rows){
    const xs=[...cells].sort((a,b)=>a-b);
    for(let i=0;i<xs.length;i++){
      const start=xs[i];while(i+1<xs.length&&xs[i+1]===xs[i]+1)i++;
      const first=page.locator(`[data-cell="${z*12+start}"]`),last=page.locator(`[data-cell="${z*12+xs[i]}"]`);
      if(start===xs[i]){await first.click();continue;}
      const a=(await first.boundingBox())!,b=(await last.boundingBox())!;
      await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();
      await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:2});await page.mouse.up();
    }
  }
}
async function play(page: Page) {
  await page.bringToFront(); await page.getByRole("button", { name: "플레이", exact:true }).click();
  await expect(page.locator(".play-shell canvas")).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
  await page.setViewportSize({width:640,height:480});
}
async function walk(page: Page, x:number,z:number) {
  await page.bringToFront();
  const held=new Set<string>();
  const keys=async(next:string[])=>{
    for(const key of [...held])if(!next.includes(key)){await page.keyboard.up(key);held.delete(key);}
    for(const key of next)if(!held.has(key)){await page.keyboard.down(key);held.add(key);}
  };
  const deadline=Date.now()+65_000;
  let position={x:0,z:0,yaw:0};
  try {
    while(Date.now()<deadline){
      position=await page.evaluate(()=>{const el=document.querySelector<HTMLElement>(".play-shell canvas")!;return {x:Number(el.dataset.playerX),z:Number(el.dataset.playerZ),yaw:Number(el.dataset.playerYaw)};});
      const distance=Math.hypot(x-position.x,z-position.z);
      if(distance<.28){await keys([]);return;}
      const goal=Math.atan2(x-position.x,-(z-position.z));
      let error=Math.atan2(Math.sin(goal-position.yaw),Math.cos(goal-position.yaw));
      const backward=Math.abs(error)>Math.PI/2;
      if(backward)error=Math.atan2(Math.sin(error+Math.PI),Math.cos(error+Math.PI));
      const next:string[]=[];
      if(error>.13)next.push("KeyD");if(error<-.13)next.push("KeyA");
      if(Math.abs(error)<.18)next.push(backward?"KeyS":"KeyW");
      await keys(next); await page.waitForTimeout(100);
    }
    throw Error(`Did not reach ${x},${z}; stopped at ${JSON.stringify(position)}`);
  } finally { await keys([]); }
}

async function writeTitle(page:Page,text:string) {
  await page.bringToFront();
  await page.getByRole("button",{name:/^장면 제목 (입력|편집)$/}).click();
  await page.getByRole("textbox",{name:"텍스트 입력",exact:true}).fill(text);
  await page.getByRole("dialog").getByRole("button",{name:"저장",exact:true}).click();
  await expect.poll(async()=>(await savedWorld(page)).title).toBe(text);
}
async function waitForGift(page:Page,text:string,timeout=70_000) {
  await expect(page.getByRole("button",{name:`배치: ${text}`,exact:true})).toBeVisible({timeout});
}
async function editMaterial(page:Page,text:string) {
  await page.bringToFront();
  const item=page.locator(".symbol-library-item").filter({has:page.getByRole("button",{name:`배치: ${text}`,exact:true})});
  await item.getByRole("button",{name:"편집",exact:true}).click();
}
async function useText(page:Page,text:string) {
  await page.bringToFront();
  await page.getByRole("button",{name:`배치: ${text}`,exact:true}).click();
  await page.locator('[data-cell="126"]').click({position:{x:2,y:2}});
}
async function seedWorld(page:Page,world:ReturnType<typeof createMeetingWorld>) {
  await page.addInitScript(world=>{
    if(!localStorage.getItem("meeting-test-seeded")){
      localStorage.setItem("whistle.world.v2",JSON.stringify(world));
      localStorage.setItem("meeting-test-seeded","1");
    }
  },world);
}

test("turn handoff shares only placed materials and a recipient edits one independent copy",async({browser,baseURL})=>{
  const a=await newPlayer(browser,baseURL),b=await newPlayer(browser,baseURL),aa=observe(a),bb=observe(b);
  const url=`?meeting=play-share-${Date.now()}`;
  const world=createMeetingWorld(37);
  world.assets.push({id:"unplaced",name:"목록에만 있는 재료",text:"목록에만 있는 재료",color:"#333333",solid:false,shape:"sphere"});
  await seedWorld(a,world);
  await a.goto(url);await ready(a);await writeTitle(a,"시험 배치");
  await b.goto(url);await ready(b);
  await writeTitle(a,"완성한 재료");
  await expect.poll(()=>aa.view().ownWorld.assets.some(asset=>asset.text==="완성한 재료")).toBe(true);
  await expect(b.locator(".received-material")).toHaveCount(0);
  await waitForGift(b,"완성한 재료");
  await expect(b.locator(".received-material")).toHaveCount(1);
  await expect(b.getByRole("button",{name:"배치: 목록에만 있는 재료",exact:true})).toHaveCount(0);
  const gift=(await savedWorld(b)).assets.find(asset=>asset.received)!;
  await editMaterial(b,"완성한 재료");
  await b.getByRole("textbox",{name:"텍스트 입력",exact:true}).fill("내가 고친 재료");
  await b.getByRole("dialog").getByRole("button",{name:"저장",exact:true}).click();
  const select=b.getByRole("button",{name:"배치: 내가 고친 재료",exact:true});
  await select.click();
  const empty=bb.view().ownWorld.terrain!.tiles.findIndex(tile=>tile.void);
  await b.locator(`[data-cell="${empty}"]`).click();
  await expect(b.locator(`[data-cell="${empty}"] [data-symbol-site]`)).toHaveCount(0);
  expect((await savedWorld(b)).objects.some(o=>o.asset===gift.id)).toBe(false);
  await b.locator('[data-cell="126"]').click({position:{x:2,y:2}});
  await expect.poll(()=>bb.view().connections.length).toBe(1);
  await expect.poll(()=>bb.view().ownWorld.objects.filter(o=>o.asset===gift.id).length).toBe(1);
  await writeTitle(a,"원래 장면 수정");
  await b.reload();await ready(b);
  await expect(b.locator(".received-material")).toHaveCount(1);
  await expect(select).toBeVisible();
  await expect(b.locator(".workspace [data-turn]")).toHaveAttribute("data-turn","own",{timeout:70_000});
  await editMaterial(b,"내가 고친 재료");
  await b.getByRole("button",{name:"텍스트 삭제",exact:true}).click();
  await expect.poll(()=>bb.view().ownWorld.objects.filter(o=>o.asset===gift.id).length).toBe(0);
  await expect(b.locator("[data-connection]")).toHaveCount(1);
  expect(bb.view().ownWorld.terrain!.tiles[126].void).not.toBe(true);
  expect([...aa.errors,...bb.errors]).toEqual([]);
});

test("distant personal footings reveal worlds and return visitors silently after floor deletion or disconnect",async({browser,baseURL},info)=>{
  const a=await newPlayer(browser,baseURL),b=await newPlayer(browser,baseURL),aa=observe(a),bb=observe(b),link=`?meeting=walk-${Date.now()}`;
  const roadA:[number,number][]=[],roadB:[number,number][]=[];
  for(let z=0;z<=10;z++)for(let x=5;x<=7;x++)roadA.push([x,z]);
  for(let z=0;z<=4;z++)for(let x=5;x<=11;x++)roadA.push([x,z]);
  for(let z=0;z<=10;z++)for(let x=0;x<=2;x++)roadB.push([x,z]);
  for(let z=9;z<=11;z++)for(let x=0;x<=7;x++)roadB.push([x,z]);
  await a.goto(link);await ready(a);await paint(a,roadA);
  await expect.poll(() => aa.view().ownWorld.terrain!.tiles[11].void).not.toBe(true);
  await b.goto(link);await ready(b);await writeTitle(b,"B의 재료");
  await expect(a.locator("[data-cell]")).toHaveCount(144);
  await expect(a.getByRole("button",{name:"시작점",exact:true})).toHaveCount(0);
  await expect(a.locator('[data-approach]')).toHaveCount(1);
  await expect(a.locator('.presence-mark')).toHaveCSS("background-color","rgb(243, 239, 145)");
  await expect(a.locator('.presence-number')).toHaveCSS("background-color","rgba(0, 0, 0, 0)");
  await expect(b.locator(".workspace [data-turn]")).toHaveAttribute("data-turn","own",{timeout:70_000});
  await waitForGift(a,"B의 재료");await useText(a,"B의 재료");
  await expect.poll(()=>aa.view().connections.length).toBe(1);
  const gate=aa.view().connections[0];expect(gate.x).toBe(25);expect(gate.z).toBeLessThanOrEqual(4);
  expect(bb.view().connections).toHaveLength(0);await expect(b.locator('[data-approach]')).toHaveCount(1);
  // Keep the neighbor's landing empty until the visitor opens it.
  expect(bb.view().ownWorld.terrain!.tiles[gate.z*12].void).toBe(true);
  await a.reload();await ready(a);expect(aa.view().connections[0].id).toBe(gate.id);
  await play(a);await walk(a,19,gate.z);await walk(a,24,gate.z);await walk(a,25,gate.z);
  await expect.poll(()=>aa.view().joined.length).toBe(2);expect(bb.view().joined).toHaveLength(1);
  await expect.poll(async()=>(await savedWorld(a)).workshop?.lastGate).toBe(gate.id);
  expect((await savedWorld(a)).objects.filter(o=>o.x===11&&o.z===gate.z)).toHaveLength(1);
  await a.keyboard.down("KeyW");await a.waitForTimeout(600);await a.keyboard.up("KeyW");
  expect(Number(await a.locator('.play-shell canvas').getAttribute('data-player-x'))).toBeLessThan(25.6);
  await paint(b,roadB);await expect.poll(()=>aa.view().world.terrain!.tiles[gate.z*38+26].void).not.toBe(true);
  await walk(a,27,gate.z);await play(b);
  await a.bringToFront();await a.getByRole("button",{name:"휘슬",exact:true}).click();
  await expect.poll(()=>bb.whistles.length).toBe(1);
  await b.bringToFront();await b.getByRole("button",{name:"휘슬",exact:true}).click();await expect.poll(()=>aa.whistles.length).toBe(2);
  await b.keyboard.press("Escape");await b.setViewportSize({width:1280,height:720});
  await paint(b,roadB.filter(([x,z])=>x<=2&&Math.abs(z-gate.z)<=1),"타일 지우기");
  await expect.poll(()=>aa.view().reset.reason).toBe("floor");
  await a.bringToFront();await expect(a.locator('.play-shell canvas')).toHaveAttribute('data-ready','true');
  await expect.poll(async()=>Number(await a.locator('.play-shell canvas').getAttribute('data-player-x'))).toBeCloseTo(25,0);
  expect(aa.view().joined).toHaveLength(2);expect(aa.view().connections[0].online).toBe(true);
  await expect(a.getByText(/돌아왔어요|연결이 끊겼어요/)).toHaveCount(0);
  await a.screenshot({path:info.outputPath("lemon-return.png")});
  await paint(b,roadB);await walk(a,27,gate.z);
  await b.close();await expect.poll(()=>aa.view().reset.reason).toBe("disconnect");
  await a.bringToFront();await expect.poll(async()=>Number(await a.locator('.play-shell canvas').getAttribute('data-player-x'))).toBeCloseTo(25,0);
  expect(aa.view().joined).toHaveLength(1);expect(aa.view().connections[0].online).toBe(false);
  await a.screenshot({path:info.outputPath("black-return.png")});
  await a.keyboard.press("Escape");await a.setViewportSize({width:1280,height:720});
  await expect(a.locator('[data-connection]')).toHaveCSS("background-color","rgb(17, 17, 17)");
  expect([...aa.errors,...bb.errors]).toEqual([]);
});

test("three original editors retain tools, undo, distinct documents after reload and a mobile layout",async({browser,baseURL},info)=>{
  const a=await newPlayer(browser,baseURL),b=await newPlayer(browser,baseURL),c=await newPlayer(browser,baseURL);
  const aa=observe(a),bb=observe(b),cc=observe(c),link=`?meeting=three-${Date.now()}`;
  await a.goto(link);await ready(a);await b.goto(link);await ready(b);await c.goto(link);await ready(c);
  expect([aa.view().slot,bb.view().slot,cc.view().slot]).toEqual([0,0,0]);
  for(const name of ["장면 제목 입력","바닥","번짐","거침","높이기","낮추기"])
    await expect(a.getByRole("button",{name,exact:true})).toBeVisible();
  const cell=aa.view().ownWorld.terrain!.tiles.findIndex(tile=>tile.void);
  const original=aa.view().ownWorld.terrain!.tiles[cell];
  const tile=()=>aa.view().ownWorld.terrain!.tiles[cell];
  await expect(a.locator(".workspace [data-turn]")).toHaveAttribute("data-turn","own",{timeout:70_000});
  await a.getByRole("button",{name:"번짐",exact:true}).click();
  await a.locator(`[data-cell="${cell}"]`).click({position:{x:2,y:2}});
  await expect.poll(tile).toMatchObject({surface:"soft"});
  await a.getByRole("button",{name:"되돌리기",exact:true}).click();
  await expect.poll(tile).toEqual(original);
  await a.getByRole("button",{name:"다시 실행",exact:true}).click();
  await expect.poll(tile).toMatchObject({surface:"soft"});
  await a.reload();await ready(a);expect(aa.view().slot).toBe(0);
  await expect.poll(tile).toMatchObject({surface:"soft"});
  expect(bb.view().ownWorld.terrain!.tiles.filter(t=>!t.void)).toHaveLength(14);
  await a.screenshot({path:info.outputPath("continuous-grass.png")});
  await c.goto(`?meeting=separate-${Date.now()}`);await ready(c);
  await expect(c.locator(".presence-count")).toHaveAttribute("aria-description","접속 인원 (나 포함): 1");
  await expect(a.locator(".presence-count")).toHaveAttribute("aria-description","접속 인원 (나 포함): 2");
  await a.setViewportSize({width:390,height:844});
  await a.screenshot({path:info.outputPath("mobile.png"),fullPage:true});
  expect(await a.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  expect([...aa.errors,...bb.errors,...cc.errors]).toEqual([]);
});

test("old black footings stay removed through reload, undo, new neighbors and switching to solo",async({browser,baseURL})=>{
  const a=await newPlayer(browser,baseURL),b=await newPlayer(browser,baseURL),state=observe(a);
  const url=`?meeting=footing-history-${Date.now()}`;
  const legacy=createMeetingWorld(17);
  legacy.connectionFootings=Array.from({length:6},(_,i)=>({id:`old-${i}`,side:i<3?0:1,row:i%3,built:true,created:i}));
  await a.addInitScript(world=>localStorage.setItem("whistle.world.v2",JSON.stringify(world)),legacy);
  await a.setViewportSize({width:390,height:844});
  await a.goto(url);await ready(a);
  await expect(a.locator('[data-connection], [data-approach]')).toHaveCount(0);
  await expect.poll(async()=>(await savedWorld(a)).connectionFootings??[]).toEqual([]);
  await a.getByRole("button",{name:"장면 제목 입력",exact:true}).click();
  await a.getByRole("textbox",{name:"텍스트 입력",exact:true}).fill("발판 없이 남는 장면");
  await a.getByRole("button",{name:"저장",exact:true}).click();
  await b.goto(url);await ready(b);
  await expect(a.locator('[data-approach-online="true"]')).toHaveCount(1);
  const next=state.view().approaches.find(p=>p.online)!;
  await a.getByRole("button",{name:"바닥",exact:true}).click();await a.locator('[data-cell="0"]').click();
  await a.getByRole("button",{name:"되돌리기",exact:true}).click();
  await expect.poll(async()=>(await savedWorld(a)).connectionFootings?.map(p=>p.id)).toEqual([next.id]);
  for(let i=0;i<3;i++){
    await a.reload();await ready(a);
    await expect(a.locator('[data-connection]')).toHaveCount(0);
    await expect(a.locator('[data-approach-online="true"]')).toHaveCount(1);
    await expect.poll(async()=>(await savedWorld(a)).connectionFootings?.length).toBe(1);
  }
  await a.getByRole("button",{name:"멀티플레이",exact:true}).click();
  await expect(a.locator('[data-connection], [data-approach]')).toHaveCount(0);
  await expect.poll(async()=>(await savedWorld(a)).connectionFootings??[]).toEqual([]);
  await a.reload();await ready(a);
  await expect(a.locator('[data-connection]')).toHaveCount(0);
  await expect(a.locator('[data-approach-online="true"]')).toHaveCount(1);
  await b.close();const context=a.context();await a.close();
  const reopened=await context.newPage();await reopened.goto(url);await ready(reopened);
  await expect(reopened.locator('[data-connection], [data-approach]')).toHaveCount(0);
  await expect.poll(async()=>(await savedWorld(reopened)).connectionFootings??[]).toEqual([]);
  await expect(reopened.getByRole("button",{name:"배치: 발판 없이 남는 장면",exact:true})).toBeVisible();
  expect(state.errors).toEqual([]);
});

test("solo starts and restarts with detached terrain before anyone sends a symbol",async({page},info)=>{
  const room=observe(page);
  await page.goto(`?meeting=solo-${Date.now()}`);await ready(page);
  await expect(page.locator("[data-cell]")).toHaveCount(144);
  await expect(page.locator(".tile-empty")).toHaveCount(130);
  await expect(page.locator(".presence-count")).toHaveAttribute("aria-description","접속 인원 (나 포함): 1");
  expect(room.view().signals).toHaveLength(0);
  expect(room.view().world.terrain!.tiles.filter(t=>!t.void)).toHaveLength(14);
  const terrain=JSON.stringify(room.view().ownWorld.terrain);
  const seed=room.view().ownWorld.terrain!.seed;
  await page.reload();await ready(page);
  expect(JSON.stringify(room.view().ownWorld.terrain)).toBe(terrain);
  await page.getByRole("button",{name:"다시 시작",exact:true}).click();
  await page.getByRole("dialog").getByRole("button",{name:"다시 시작",exact:true}).click();
  await expect.poll(()=>room.view().ownWorld.terrain!.seed).not.toBe(seed);
  await expect(page.locator(".tile-empty")).toHaveCount(130);
  await page.screenshot({path:info.outputPath("solo-start-editor.png")});
  await play(page);
  await expect(page.locator('.play-shell canvas')).toHaveAttribute('data-player-x','19');
  await expect(page.locator('.play-shell canvas')).toHaveAttribute('data-player-z','10');
  await expect(page.locator('.play-shell canvas')).toHaveAttribute('data-motion','walk');
  await page.screenshot({path:info.outputPath("solo-start-play.png")});
  await page.setViewportSize({width:390,height:844});
  await page.waitForTimeout(250);
  await page.screenshot({path:info.outputPath("solo-start-play-mobile.png")});
  expect(room.errors).toEqual([]);
});


test("neighbors share editable lemon materials without forwarding copies or restoring deleted gifts",async({browser,baseURL},info)=>{
  const a=await newPlayer(browser,baseURL),b=await newPlayer(browser,baseURL),c=await newPlayer(browser,baseURL);
  const aa=observe(a),bb=observe(b),cc=observe(c),link=`?meeting=materials-${Date.now()}`;
  await a.goto(link);await ready(a);await b.goto(link);await ready(b);await c.goto(link);await ready(c);
  await writeTitle(a,"물고기");
  await waitForGift(b,"물고기");
  await expect(c.locator('.received-material')).toHaveCount(0);
  await expect(b.locator('.received-material')).toHaveCSS("background-color","rgb(243, 239, 145)");
  const gift=bb.view().materials[0].id;
  expect(bb.view().ownWorld.objects.some(o=>o.asset===gift)).toBe(false);
  await editMaterial(b,"물고기");
  await b.getByRole("textbox",{name:"텍스트 입력",exact:true}).fill("하늘 물고기");
  await b.getByRole("dialog").getByRole("button",{name:"저장",exact:true}).click();
  await useText(b,"하늘 물고기");
  await expect.poll(()=>bb.view().ownWorld.assets.find(v=>v.id===gift)?.text).toBe("하늘 물고기");
  await expect.poll(()=>bb.view().ownWorld.objects.filter(o=>o.asset===gift).length).toBe(1);
  expect(aa.view().ownWorld.assets.some(v=>v.text==="물고기")).toBe(true);
  expect(aa.view().materials).toHaveLength(0);
  expect(aa.view().connections).toHaveLength(0);
  await expect.poll(()=>bb.view().connections.length).toBe(1);
  expect(bb.view().connections[0].members).toEqual([bb.view().id,aa.view().id]);
  expect(cc.view().connections).toHaveLength(0);
  await writeTitle(b,"내 기호");
  await waitForGift(a,"내 기호");
  expect(aa.view().materials).toHaveLength(1);
  await b.reload();await ready(b);
  await expect(b.getByRole("button",{name:"배치: 하늘 물고기",exact:true})).toBeVisible();
  await editMaterial(b,"하늘 물고기");
  await expect(b.getByRole("button",{name:"텍스트 삭제",exact:true})).toBeEnabled({timeout:70_000});
  await b.getByRole("button",{name:"텍스트 삭제",exact:true}).click();
  await expect.poll(()=>bb.view().ownWorld.assets.some(v=>v.id===gift)).toBe(false);
  await b.reload();await ready(b);
  await expect(b.locator('.received-material')).toHaveCount(0);
  await expect(c.locator('.received-material')).toHaveCount(0);
  await a.close();
  await expect(c.locator('.presence-count')).toHaveAttribute("aria-description","접속 인원 (나 포함): 2");
  await waitForGift(c,"내 기호",130_000);
  await c.reload();await ready(c);
  await expect(c.locator('.received-material')).toHaveCount(1);
  await c.setViewportSize({width:390,height:844});
  await c.screenshot({path:info.outputPath("lemon-materials-mobile.png"),fullPage:true});
  expect(await c.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  expect([...aa.errors,...bb.errors,...cc.errors]).toEqual([]);
});

test("a fourth arrival preserves existing neighbors and only receives the adjacent creator's materials",async({browser,baseURL},info)=>{
  const pages=await Promise.all([0,1,2,3].map(()=>newPlayer(browser,baseURL))),states=pages.map(observe),link=`?meeting=four-${Date.now()}`;
  for(let i=0;i<3;i++){await pages[i].goto(link);await ready(pages[i]);}
  const original=states[0].view().approaches[0];
  await writeTitle(pages[0],"첫 번째");await writeTitle(pages[2],"세 번째");
  await pages[3].goto(link);await ready(pages[3]);
  await waitForGift(pages[3],"세 번째");
  await expect(pages[3].getByRole('button',{name:'배치: 첫 번째',exact:true})).toHaveCount(0);
  await expect.poll(()=>states[0].view().approaches[0].id).toBe(original.id);
  const ids=states.map(s=>s.view().id);
  for(let i=0;i<4;i++){
    expect(states[i].view().recipients).toEqual([ids[i % 2 === 0 ? i+1 : i-1]]);
    await expect(pages[i].locator('.presence-count')).toHaveAttribute('aria-description','접속 인원 (나 포함): 4');
  }
  await useText(pages[1],"첫 번째");await expect.poll(()=>states[1].view().connections.length).toBe(1);
  await pages[0].close();await expect(pages[1].locator('.presence-number')).toHaveText('3');
  await expect(pages[1].locator('[data-connection-online="true"]')).toHaveCount(0);
  await pages[1].screenshot({path:info.outputPath('two-neighbors-one-offline.png')});
  expect(states.flatMap(s=>s.errors)).toEqual([]);
});
