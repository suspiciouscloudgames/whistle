import { test,expect,type Page } from "@playwright/test";
import { terrainFixtures } from "../terrain-fixtures";
import { savedWorld } from "./world-storage";

async function ready(page:Page) {
  await page.bringToFront();
  await expect(page.getByRole("button",{name:"파일 저장",exact:true})).toHaveAttribute("aria-description","이 브라우저에 저장됨");
  await expect(page.locator(".live-preview canvas")).toHaveAttribute("data-ready","true",{timeout:30_000});
}

test("the normal page opens, edits, saves and plays without a multiplayer server",async({page})=>{
  await page.routeWebSocket(/\/whistle\/meeting\?/,socket=>socket.close());
  await page.goto(".");await ready(page);
  await expect(page.getByRole("button",{name:"같은 방 새 탭 열기"})).toHaveCount(0);
  await expect(page.getByRole("button",{name:"시작점",exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"바닥",exact:true}).click();
  await page.locator('[data-cell="0"]').click();
  await page.getByRole("button",{name:"높이기",exact:true}).click();
  await page.locator('[data-cell="0"]').click();
  await expect.poll(async()=> (await savedWorld(page)).terrain!.tiles[0].height).toBe(1);
  await page.reload();await ready(page);
  expect((await savedWorld(page)).terrain!.tiles[0].height).toBe(1);
  await page.getByRole("button",{name:"플레이",exact:true}).click();
  await expect(page.locator(".play-shell canvas")).toHaveAttribute("data-ready","true");
  await expect(page.locator(".play-shell canvas")).toHaveAttribute("data-player-x","19");
  await page.keyboard.down("KeyW");
  await expect.poll(async()=>Number(await page.locator(".play-shell canvas").getAttribute("data-player-z"))).toBeLessThan(9.95);
  await page.keyboard.up("KeyW");
  await page.keyboard.press("Escape");await ready(page);
});

test("the same document follows room addresses while separate tabs retain their own work",async({page,context})=>{
  await context.routeWebSocket(/\/whistle\/meeting\?/,socket=>socket.close());
  await page.goto(".");await ready(page);
  await page.getByRole("button",{name:"높이기",exact:true}).click();
  await page.locator('[data-cell="126"]').click();
  await expect.poll(async()=> (await savedWorld(page)).terrain!.tiles[126].height).toBe(1);
  await page.goto(`?meeting=first-${Date.now()}`);await ready(page);
  expect((await savedWorld(page)).terrain!.tiles[126].height).toBe(1);
  const second=await context.newPage();await second.goto(page.url());await ready(second);
  const world={...terrainFixtures().flat,title:"다른 탭의 세계"};
  await second.locator("input[type=file]").setInputFiles({name:"second.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(world))});
  await expect.poll(async()=> (await savedWorld(second)).title).toBe(world.title);
  await page.bringToFront();await page.reload();await ready(page);
  expect((await savedWorld(page)).terrain!.tiles[126].height).toBe(1);
  expect((await savedWorld(page)).title).not.toBe(world.title);
  await second.bringToFront();await second.reload();await ready(second);
  expect((await savedWorld(second)).title).toBe(world.title);
});

test("restart clears received materials and undo history and rejoins with a fresh connection",async({browser,baseURL})=>{
  test.setTimeout(105_000);
  const contexts=await Promise.all([1,2,3].map(()=>browser.newContext({baseURL,locale:"ko-KR"})));
  try {
    const [a,b,c]=await Promise.all(contexts.map(context=>context.newPage()));
    const url=`?meeting=restart-${Date.now()}`;
    for(const page of [a,b,c]){await page.goto(url);await ready(page);await expect(page.locator("main")).toHaveAttribute("data-meeting-status","online");}
    await a.bringToFront();
    await a.getByRole("button",{name:"장면 제목 입력",exact:true}).click();
    await a.getByRole("textbox",{name:"텍스트 입력",exact:true}).fill("이전 이웃의 재료");
    await a.getByRole("dialog").getByRole("button",{name:"저장",exact:true}).click();
    await b.bringToFront();
    const gift=b.getByRole("button",{name:"배치: 이전 이웃의 재료",exact:true});
    await expect(gift).toBeVisible({timeout:70_000});
    await gift.click();
    await b.locator('[data-cell="126"]').click({position:{x:2,y:2}});
    await expect(b.locator("[data-connection]")).toHaveCount(1);
    const before=await b.locator("main").getAttribute("data-meeting-id");
    const aPort=await a.locator("[data-approach]").getAttribute("data-approach");
    await b.getByRole("button",{name:"다시 시작",exact:true}).click();
    await b.getByRole("dialog").getByRole("button",{name:"다시 시작",exact:true}).click();
    await ready(b);
    await expect(b.locator("main")).toHaveAttribute("data-meeting-status","online");
    await expect(b.locator("main")).not.toHaveAttribute("data-meeting-id",before!);
    await expect(b.locator(".received-material")).toHaveCount(0);
    await expect(b.locator("[data-connection]")).toHaveCount(0);
    await expect(b.locator(".presence-number")).toHaveText("3");
    await expect(b.getByRole("button",{name:"되돌리기",exact:true})).toBeDisabled();
    await expect(b.getByRole("button",{name:"장면 제목 입력",exact:true})).toBeVisible();
    expect((await savedWorld(b)).objects).toHaveLength(1);
    await expect(a.locator(`[data-approach="${aPort}"][data-approach-online="true"]`)).toHaveCount(0);
    await expect(a.locator('[data-approach-online="true"]')).not.toHaveAttribute("data-approach",aPort!);
  } finally {await Promise.all(contexts.map(context=>context.close()));}
});
