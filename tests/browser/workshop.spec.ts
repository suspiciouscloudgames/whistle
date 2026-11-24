import { test, expect, type Page } from "@playwright/test";
import { savedWorld } from "./world-storage";
import { createMeetingWorld, type MeetingMessage, type MeetingTurn } from "../../lib/meeting";
import { createMeetingCodec } from "../../lib/meeting-wire";

const hint="배치는 내 차례에 할 수 있어요. 편집은 언제든 할 수 있어요.";
const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=","base64");
async function ready(page:Page) {
  await expect(page.locator("main")).toHaveAttribute("data-meeting-status","online");
  await expect(page.getByRole("button",{name:"장면 제목 입력",exact:true})).toBeVisible();
}
async function title(page:Page,text:string,prompts=1) {
  await page.getByRole("button",{name:"장면 제목 입력",exact:true}).click();
  await expect(page.getByRole("dialog",{name:"텍스트",exact:true})).toBeVisible();
  await page.getByRole("textbox",{name:"텍스트 입력",exact:true}).fill(text);
  await page.getByRole("button",{name:"저장",exact:true}).click();
  await expect(page.locator('[data-empty-symbol="true"]')).toHaveCount(prompts);
}
async function drag(page:Page,selector:string,index:number) {
  const from=await page.locator(selector).boundingBox(),to=await page.locator(`[data-cell="${index}"]`).boundingBox();
  await page.mouse.move(from!.x+from!.width/2,from!.y+from!.height/2);await page.mouse.down();
  await page.mouse.move(to!.x+to!.width/2,to!.y+to!.height/2,{steps:8});await page.mouse.up();
}

test("title, neutral prompts, replenishment, direct editing, movement, reuse and reload",async({page},info)=>{
  await page.goto(`?meeting=workshop-solo-${Date.now()}`);await ready(page);
  await expect(page.getByRole("button",{name:/^(이미지|텍스트|사운드) 만들기$/})).toHaveCount(0);
  await expect(page.locator('[data-empty-symbol="true"]')).toHaveCount(1);
  await expect(page.locator('.empty-symbol .site-glyph')).toHaveCSS("color","rgb(119, 119, 119)");
  await title(page,"처음 만든 풍경");
  await expect(page.locator('[data-empty-symbol="false"] .site-glyph')).not.toHaveCSS("color","rgb(119, 119, 119)");
  await expect(page.getByRole("button",{name:"배치: 처음 만든 풍경",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"바닥",exact:true}).click();await page.locator('[data-cell="112"]').click();
  const imageSymbol=page.locator('[data-symbol-kind="image"][data-empty-symbol="true"]');
  const imageId=await imageSymbol.getAttribute("data-symbol-site");
  await drag(page,`[data-symbol-site="${imageId}"]`,112);
  await expect(page.locator(`[data-cell="112"] [data-symbol-site="${imageId}"]`)).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await imageSymbol.click();
  await expect(page.getByRole("dialog",{name:"이미지",exact:true})).toBeVisible();
  await page.getByRole("dialog").locator('input[type="file"]').setInputFiles({name:"image.png",mimeType:"image/png",buffer:png});
  await page.getByRole("button",{name:"저장",exact:true}).click();
  await expect(page.locator('[data-empty-symbol="true"]')).toHaveCount(1);
  await expect(page.locator('[data-symbol-kind="sound"][data-empty-symbol="true"]')).toHaveCount(1);
  await expect(page.getByRole("button",{name:"사운드 입력",exact:true})).toBeVisible();
  await page.locator(`[data-symbol-site="${imageId}"]`).click();
  await page.getByRole("button",{name:"저장",exact:true}).click();
  await expect(page.locator('[data-empty-symbol="true"]')).toHaveCount(1);
  await page.getByRole("button",{name:"배치: 처음 만든 풍경",exact:true}).click();
  await page.locator('[data-cell="126"]').click();
  await expect(page.locator('[data-empty-symbol="false"]')).toHaveCount(3);
  await expect(page.locator('[data-empty-symbol="true"]')).toHaveCount(1);
  await expect.poll(async()=>(await savedWorld(page)).objects.length).toBe(4);
  const before=await savedWorld(page);
  await page.reload();
  await expect(page.locator('[data-empty-symbol="true"]')).toHaveCount(1);
  expect((await savedWorld(page)).objects).toEqual(before.objects);
  await page.screenshot({path:info.outputPath("workshop-desktop.png"),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(page.locator('.workspace .turn-status')).toHaveCount(0);
  await page.screenshot({path:info.outputPath("workshop-mobile.png"),fullPage:true});
});

test("new symbols wait for spaced floors and survive undo, redo and reload without multiplying",async({page})=>{
  const world=createMeetingWorld(2);
  world.terrain!.tiles=world.terrain!.tiles.map(()=>({height:0,surface:"plain",void:true}));
  for(const point of [world.start,...world.objects])world.terrain!.tiles[point.z*world.size+point.x]={height:0,surface:"plain"};
  world.terrain!.tiles[0]={height:0,surface:"plain",hole:true};
  await page.addInitScript(world=>localStorage.setItem("whistle.world.v2",JSON.stringify(world)),world);
  await page.goto(`?meeting=workshop-spacing-${Date.now()}`);await ready(page);
  await title(page,"바닥이 있어야 다음 기호",0);
  await page.getByRole("button",{name:"바닥",exact:true}).click();
  await page.locator('[data-cell="114"]').click();
  await expect(page.locator('[data-empty-symbol="true"]')).toHaveCount(0);
  await page.locator('[data-cell="110"]').click();
  await expect(page.locator('[data-cell="110"] [data-symbol-kind="image"][data-empty-symbol="true"]')).toBeVisible();
  await page.getByRole("button",{name:"되돌리기",exact:true}).click();
  await expect(page.locator('[data-empty-symbol="true"]')).toHaveCount(0);
  await page.getByRole("button",{name:"다시 실행",exact:true}).click();
  await expect(page.locator('[data-cell="110"] [data-empty-symbol="true"]')).toBeVisible();
  await page.locator('[data-cell="0"]').click();
  await expect(page.locator('[data-empty-symbol="true"]')).toHaveCount(1);
  await expect.poll(async()=>(await savedWorld(page)).objects.length).toBe(2);
  const saved=await savedWorld(page);
  await page.reload();
  await expect(page.locator('[data-empty-symbol="true"]')).toHaveCount(1);
  expect((await savedWorld(page)).objects).toEqual(saved.objects);
});

test("one-minute turns lock placement, keep editors open and deliver before meeting",async({browser,baseURL},info)=>{
  test.setTimeout(115_000);
  const ca=await browser.newContext({baseURL}),cb=await browser.newContext({baseURL});
  const a=await ca.newPage(),b=await cb.newPage();
  const url=`?meeting=workshop-turn-${Date.now()}`;
  try {
    await a.goto(url);await ready(a);await title(a,"보내는 장면");
    await b.goto(url);await ready(b);
    await expect(a.locator('.workspace [data-turn]')).toHaveAttribute("data-turn","own");
    await expect(b.locator('.workspace [data-turn]')).toHaveAttribute("data-turn","other");
    await expect(a.locator('.workspace .turn-fill')).toHaveCSS("background-color","rgb(255, 255, 255)");
    await expect(b.locator('.workspace .turn-fill')).toHaveCSS("background-color","rgb(243, 239, 145)");
    await expect(b.locator('.workspace .turn-status')).not.toContainText(/\d/);
    await expect(b.getByRole("button",{name:"높이기",exact:true})).toHaveAttribute("aria-disabled","true");
    await b.locator('[data-cell="0"]').click();await expect(b.getByText(hint,{exact:true})).toBeVisible();
    expect((await savedWorld(b)).terrain!.tiles[0].void).toBe(true);
    await title(b,"기다리며 쓰는 제목");
    await expect(b.locator('.toast')).not.toContainText("데이터");
    await a.getByRole("button",{name:"바닥",exact:true}).click();await a.locator('[data-cell="0"]').click();
    await a.getByRole("button",{name:"장면 제목 편집",exact:true}).click();
    await a.getByRole("textbox",{name:"텍스트 입력",exact:true}).fill("차례가 바뀌어도 남은 초안");
    await expect(b.locator('.received-material')).toHaveCount(0);
    await expect(b.locator('.workspace [data-turn]')).toHaveAttribute("data-turn","own",{timeout:65_000});
    await expect(a.getByRole("dialog")).toBeVisible();
    await expect(a.getByRole("textbox",{name:"텍스트 입력",exact:true})).toHaveValue("차례가 바뀌어도 남은 초안");
    await expect(a.getByRole("button",{name:"배치 삭제",exact:true})).toBeDisabled();
    await expect(a.getByRole("button",{name:"저장",exact:true})).toBeEnabled();
    await expect(b.getByRole("button",{name:"배치: 보내는 장면",exact:true})).toBeVisible();
    await expect(b.locator('.received-material')).toHaveCount(1);
    await a.getByRole("button",{name:"저장",exact:true}).click();
    await expect.poll(async()=>(await savedWorld(a)).assets.some(asset=>asset.text==="차례가 바뀌어도 남은 초안")).toBe(true);
    await expect(a.locator('.workspace [data-turn]')).toHaveAttribute("data-turn","other");
    await a.locator('[data-cell="1"]').click();await expect(a.getByText(hint,{exact:true})).toBeVisible();
    await b.getByRole("button",{name:"바닥",exact:true}).click();await b.locator('[data-cell="0"]').click();
    await expect.poll(async()=>(await savedWorld(b)).terrain!.tiles[0].void).not.toBe(true);
    await a.screenshot({path:info.outputPath("other-turn.png"),fullPage:true});
    await b.screenshot({path:info.outputPath("own-turn.png"),fullPage:true});
    await cb.close();
    await expect(a.locator('.workspace [data-turn]')).toHaveCount(0);
  } finally {await ca.close();await cb.close();}
});

test("the countdown advances without repeatedly rendering the idle editor",async({browser,baseURL})=>{
  const ca=await browser.newContext({baseURL}),cb=await browser.newContext({baseURL});
  const a=await ca.newPage(),b=await cb.newPage();
  await a.route("**/app/page.tsx",async route=>{
    const response=await route.fetch();
    const body=(await response.text()).replace("const { t } = useLanguage();",
      "globalThis.__editorRenders=(globalThis.__editorRenders??0)+1; const { t } = useLanguage();");
    await route.fulfill({response,body});
  });
  try {
    const url=`?meeting=countdown-${Date.now()}`;
    await a.goto(url);await ready(a);await b.goto(url);await ready(b);
    await expect(b.locator('.workspace [data-turn]')).toHaveAttribute("data-turn","other");
    await a.waitForTimeout(1200);
    const before=await a.evaluate(()=>({renders:(globalThis as any).__editorRenders as number,
      scale:document.querySelector<HTMLElement>('.workspace .turn-fill')!.style.transform}));
    expect(before.renders).toBeGreaterThan(0);
    await expect.poll(()=>a.locator('.workspace .turn-fill').evaluate(el=>(el as HTMLElement).style.transform)).not.toBe(before.scale);
    await a.waitForTimeout(650);
    const after=await a.evaluate(()=>(globalThis as any).__editorRenders as number);
    expect(after-before.renders).toBeLessThanOrEqual(1);
  } finally {await ca.close();await cb.close();}
});

test("off-turn edits survive reload and switching between solo and multiplayer",async({browser,baseURL})=>{
  const ca=await browser.newContext({baseURL}),cb=await browser.newContext({baseURL});
  const a=await ca.newPage(),b=await cb.newPage();
  try {
    const url=`?meeting=workshop-resume-${Date.now()}`;
    await a.goto(url);await ready(a);await b.goto(url);await ready(b);
    await expect(b.locator('.workspace [data-turn]')).toHaveAttribute("data-turn","other");
    await title(b,"다시 이어 만드는 장면");
    await expect.poll(async()=>(await savedWorld(b)).title).toBe("다시 이어 만드는 장면");
    const saved=await savedWorld(b);
    await b.reload();
    await expect(b.locator("main")).toHaveAttribute("data-meeting-status","online");
    await expect(b.getByRole("button",{name:"장면 제목 편집",exact:true})).toBeVisible();
    await expect(b.locator('.workspace [data-turn]')).toHaveAttribute("data-turn","other");
    expect((await savedWorld(b)).objects).toEqual(saved.objects);
    const toggle=b.getByRole("button",{name:"멀티플레이",exact:true});
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed","false");
    await expect(b.locator('.workspace [data-turn]')).toHaveCount(0);
    await expect(a.locator('.workspace [data-turn]')).toHaveCount(0);
    await toggle.click();
    await expect(b.locator("main")).toHaveAttribute("data-meeting-status","online");
    await expect(b.locator('.workspace [data-turn]')).toHaveAttribute("data-turn","other");
    expect((await savedWorld(b)).assets).toEqual(saved.assets);
    expect((await savedWorld(b)).objects).toEqual(saved.objects);
    await expect(b.locator('.toast').filter({hasText:hint})).toHaveCount(0);
  } finally {await ca.close();await cb.close();}
});

test("the third player creates alone until a fourth arrives, shares only with that partner and can turn sharing off",async({browser,baseURL})=>{
  test.setTimeout(115_000);
  const contexts=await Promise.all([0,1,2,3].map(()=>browser.newContext({baseURL})));
  const pages=await Promise.all(contexts.map(async context=>{
    await context.addInitScript(()=>Object.defineProperty(window,"devicePixelRatio",{value:.5}));
    return context.newPage();
  }));
  const states=pages.map(page=>{
    const state:{turn?:MeetingTurn;sent:number;errors:string[]}={sent:0,errors:[]};
    page.on("pageerror",error=>state.errors.push(error.message));
    page.on("websocket",socket=>{
      if(!socket.url().includes("/whistle/meeting?"))return;
      const codec=createMeetingCodec();
      socket.on("framesent",()=>state.sent++);
      socket.on("framereceived",({payload})=>{
        const message=codec.decode<MeetingMessage>(payload.toString());
        if(message?.type==="error")state.errors.push(message.message);
        else if(message?.type==="state"||message?.type==="presence")state.turn=message.presence.turn;
      });
    });
    return state;
  });
  const [a,b,c,d]=pages,url=`?meeting=workshop-pairs-${Date.now()}`;
  try {
    for(const [i,page] of pages.slice(0,3).entries()){
      await page.goto(url);await ready(page);await title(page,`${i+1}번의 기호`);
    }
    await expect(c.locator('.workspace .turn-status')).toHaveCount(0);
    await expect(c.locator('[data-approach-online="true"]')).toHaveCount(0);
    await c.getByRole("button",{name:"플레이",exact:true}).click();
    await expect(c.locator('.play-shell canvas')).toHaveAttribute("data-ready","true");
    await c.getByRole("button",{name:"만들기로 돌아가기",exact:true}).click();
    await expect(c.locator('.received-material')).toHaveCount(0);
    for(const page of [a,b])await expect(page.getByRole("button",{name:"배치: 3번의 기호",exact:true})).toHaveCount(0);
    const deadline=states[0].turn!.endsAt;
    await d.goto(url);await ready(d);await title(d,"4번의 기호");
    expect([deadline,deadline+60_000]).toContain(states[0].turn!.endsAt);
    await expect(c.locator('.workspace [data-turn]')).toHaveAttribute("data-turn","own");
    await expect(d.locator('.workspace [data-turn]')).toHaveAttribute("data-turn","other");
    expect(states[2].turn!.partner).toBe(await d.locator('main').getAttribute('data-meeting-id'));
    await expect(d.getByRole("button",{name:"배치: 3번의 기호",exact:true})).toBeVisible({timeout:65_000});
    await expect(b.getByRole("button",{name:"배치: 1번의 기호",exact:true})).toBeVisible();
    await expect(c.locator('.received-material')).toHaveCount(0);
    await expect(d.locator('.received-material')).toHaveCount(1);
    await expect(b.locator('.received-material')).toHaveCount(1);
    await c.getByRole("button",{name:"멀티플레이",exact:true}).click();
    await expect(c.locator('main')).toHaveAttribute('data-meeting-status','offline');
    await expect(c.locator('.workspace .turn-status')).toHaveCount(0);
    await expect(d.locator('.workspace .turn-status')).toHaveCount(0);
    const sent=states[2].sent;
    await c.getByRole("button",{name:"이미지 입력",exact:true}).click();
    await c.getByRole("dialog").locator('input[type="file"]').setInputFiles({name:"solo.png",mimeType:"image/png",buffer:png});
    await c.getByRole("button",{name:"저장",exact:true}).click();
    await expect(c.getByRole("button",{name:"사운드 입력",exact:true})).toBeVisible();
    await expect.poll(async()=>(await savedWorld(c)).assets.filter(a=>a.image&&!a.text).length).toBe(1);
    expect(states[2].sent).toBe(sent);
    await expect(d.locator('.received-material')).toHaveCount(1);
    await c.setViewportSize({width:390,height:844});
    await expect(c.locator('.turn-status')).toHaveCount(0);
    expect(states.flatMap(state=>state.errors)).toEqual([]);
  } finally {await Promise.all(contexts.map(context=>context.close()));}
});
