import { savedWorld } from "./world-storage";
import { setPresentation, openPlaced } from "./presentation";
import { writeFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import { terrainFixtures } from "../terrain-fixtures";

test.setTimeout(120_000);
test.beforeEach(async({page})=>{
  await page.addInitScript(()=>Object.defineProperty(window,"devicePixelRatio",{value:.5}));
});

async function openScene(page: Page, environmentTargets = false) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.route(/\/components\/whistle\/Scene\.tsx(\?|$)/, async route => {
    const response = await route.fetch();
    const source = (await response.text()).replace("const scene = new THREE.Scene();", "const scene = new THREE.Scene(); globalThis.__testScene = scene;");
    await route.fulfill({ response, body: source });
  });
  const world = terrainFixtures().mixed;
  world.start = { x: 3, z: 7 };
  if (!environmentTargets) world.terrain!.tiles[3 * 12 + 4].surface = "rough";
  world.objects = [
    { id: "standing", asset: world.assets[0].id, x: 3, z: environmentTargets ? 4 : 3, rotation: 0, scale: 1 },
    { id: "attached", asset: world.assets[1].id, x: 7, z: 5, rotation: 0, scale: 3 },
    ...(environmentTargets ? [{ id: "stone-picture", asset: world.assets[2].id, x: 2, z: 6, rotation: 0, scale: 1 }] : []),
  ];
  await page.addInitScript(world => {
    if (localStorage.getItem("surface-test-ready")) return;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#ef7148";
    context.fillRect(8, 8, 112, 112);
    context.fillStyle = "#344ddd";
    context.fillRect(16, 16, 48, 48);
    world.assets[0].image = canvas.toDataURL();
    world.assets[1].image = canvas.toDataURL();
    world.assets[2].image = canvas.toDataURL();
    world.assets[1].placement = "surface";
    localStorage.setItem("whistle.world.v2", JSON.stringify(world));
    localStorage.setItem("whistle.language", "ko");
    localStorage.setItem("surface-test-ready", "1");
  }, world);
  await page.goto(".");
  await page.locator(".live-preview canvas").waitFor();
  await expect.poll(() => page.evaluate(() => !!(globalThis as any).__testScene?.getObjectByName("surface-image"))).toBe(true);
  return errors;
}

async function surfaceState(page: Page) {
  return page.evaluate(() => {
    const scene = (globalThis as any).__testScene;
    const picture = scene.getObjectByName("surface-image");
    const pos = picture.geometry.attributes.position;
    const ys = Array.from({ length: pos.count }, (_, i) => pos.getY(i) as number);
    const grass = scene.getObjectByName("grassland");
    return { count: pos.count, minY: Math.min(...ys), maxY: Math.max(...ys),
      position: picture.parent.position.toArray(), scale: picture.parent.scale.toArray(),
      trees: !!scene.getObjectByName("generated-trunks"), grass: !!scene.getObjectByName("grass-tufts"),
      ribbons: scene.getObjectByName("grass-tufts")?.count ?? 0,
      windTime: grass.userData.grassTime.value, windStrength: grass.userData.grassMotion.value };

  });
}

async function grassSurfaceState(page: Page) {
  return page.evaluate(() => {
    const scene = (globalThis as any).__testScene;
    if (!scene) return { textured: 0, total: 0, matrices: [] };
    const base = scene.getObjectByName("grass-tufts");
    const group = scene.getObjectByName("grassland");
    const meshes = group.children.filter((child: any) => child.name === "grass-tufts" || child.name === "grass-surface-image");
    const matrices = meshes.flatMap((mesh: any) => Array.from({ length: mesh.count }, (_, i) =>
      Array.from(mesh.instanceMatrix.array.slice(i * 16, i * 16 + 16)).join(","))).sort();
    const image = meshes.find((mesh: any) => mesh.name === "grass-surface-image");
    const circle = scene.children.find((child: any) => child.userData.asset === "circle");
    return { textured: image?.count ?? 0, total: meshes.reduce((sum: number, mesh: any) => sum + mesh.count, 0), matrices,
      texture: image?.material.map?.image?.src,
      sameGeometry: !image || Array.from(image.geometry.attributes.position.array).join(",") === Array.from(base.geometry.attributes.position.array).join(","),
      ground: !!circle?.getObjectByName("surface-image"),
      time: group.userData.grassTime.value, strength: group.userData.grassMotion.value };
  });
}

test("surface attachment uses existing grass or bare ground without planting anything", async ({ page }, testInfo) => {
  const errors = await openScene(page);
  const before = await grassSurfaceState(page);
  await openPlaced(page, "standing");
  const dialog = page.getByRole("dialog");
  await setPresentation(page, "placement", "surface");
  await expect(dialog.getByRole("button", { name: "풀로 심기", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "바람에 흔들리기", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "저장", exact: true }).click();
  await expect.poll(async () => (await grassSurfaceState(page)).textured).toBeGreaterThan(0);
  const attached = await grassSurfaceState(page);
  expect(attached.total).toBe(before.total);
  expect(attached.matrices).toEqual(before.matrices);
  expect(attached.sameGeometry).toBe(true);
  expect(attached.ground).toBe(true);
  await expect.poll(async () => (await grassSurfaceState(page)).time).toBeGreaterThan(attached.time!);
  await expect.poll(async () => (await savedWorld(page)).assets[0].placement).toBe("surface");
  const saved = (await savedWorld(page)).assets[0];
  expect(attached.texture).toBe(saved.image);
  await page.getByRole("button", { name: "번짐", exact: true }).click();
  await page.locator('[data-cell="39"]').click({ position: { x: 2, y: 2 } });
  await expect.poll(async () => (await grassSurfaceState(page)).ground).toBe(true);
  await expect.poll(async () => (await grassSurfaceState(page)).textured).toBe(0);
  await page.getByRole("button", { name: "되돌리기", exact: true }).click();
  await expect.poll(async () => (await grassSurfaceState(page)).textured).toBe(attached.textured);
  await page.getByRole("button", { name: "플레이", exact: true }).click();
  await page.locator(".play-shell canvas").waitFor();
  await expect.poll(async () => (await grassSurfaceState(page)).textured).toBeGreaterThan(0);
  const playingGrass=await grassSurfaceState(page);
  expect(playingGrass.texture).toBe(saved.image);
  expect(playingGrass.sameGeometry).toBe(true);
  const coatingOpacity = () => page.evaluate(() => {
    const mesh = (globalThis as any).__testScene.getObjectByName("grass-surface-image");
    return mesh.material.userData.surfaceProjection.opacity.value as number;
  });
  const opacity = await coatingOpacity();
  await expect.poll(async () => Math.abs(await coatingOpacity() - opacity), { timeout: 12_000 }).toBeGreaterThan(.2);
  expect(await page.evaluate(() => (globalThis as any).__testScene.getObjectByName("grass-surface-image").material.opacity)).toBe(1);
  await page.screenshot({ path: testInfo.outputPath("grass-surface-play.png") });
  await page.getByRole("button", { name: "만들기로 돌아가기", exact: true }).click();
  await page.reload();
  await expect.poll(async () => (await grassSurfaceState(page)).textured).toBe(attached.textured);
  expect((await grassSurfaceState(page)).texture).toBe(saved.image);
  expect(errors).toEqual([]);
});

test("surface images follow slopes through terrain edits, undo, play and reload", async ({ page }, testInfo) => {
  const errors = await openScene(page);
  const before = await surfaceState(page);
  expect(before.count).toBeGreaterThan(0);
  expect(before.maxY - before.minY).toBeGreaterThan(.1);
  expect(before.position).toEqual([0, 0, 0]);
  expect(before.scale).toEqual([1, 1, 1]);
  expect(before.trees).toBe(true);
  expect(before.grass).toBe(true);
  expect(before.ribbons).toBeGreaterThan(0);
  await expect.poll(async () => (await surfaceState(page)).windTime).toBeGreaterThan(before.windTime);
  await page.screenshot({ path: testInfo.outputPath("abstract-editor.png") });
  await page.getByRole("button", { name: "높이기", exact: true }).click();
  await page.locator('[data-cell="67"]').click({ position: { x: 2, y: 2 } });
  await expect.poll(async () => (await surfaceState(page)).maxY).toBeGreaterThan(before.maxY);
  await page.getByRole("button", { name: "되돌리기", exact: true }).click();
  await expect.poll(async () => (await surfaceState(page)).maxY).toBeCloseTo(before.maxY);
  await page.getByRole("button", { name: "플레이", exact: true }).click();
  await page.locator(".play-shell canvas").waitFor();
  await expect.poll(async () => (await surfaceState(page)).count).toBeGreaterThan(0);
  expect((await surfaceState(page)).maxY).toBeCloseTo(before.maxY);
  expect((await surfaceState(page)).minY).toBeCloseTo(before.minY);
  expect((await surfaceState(page)).position).toEqual([0, 0, 0]);
  await page.screenshot({ path: testInfo.outputPath("abstract-play.png") });
  await page.getByRole("button", { name: "만들기로 돌아가기", exact: true }).click();
  await page.reload();
  await page.locator(".live-preview canvas").waitFor();
  await expect.poll(async () => (await surfaceState(page)).count).toBe(before.count);
  expect(errors).toEqual([]);
});

test("pixel terrain, textured trunks and stones retain their geometry and water reflects at low resolution", async ({ page }, testInfo) => {
  const errors = await openScene(page, true);
  const inspect = () => page.evaluate(() => {
    const scene = (globalThis as any).__testScene;
    const ground = scene.getObjectByName("continuous-ground");
    const trees: any[] = [], stones: any[] = [];
    scene.traverse((object: any) => {
      if (object.name === "generated-trunks") trees.push(object);
      if (["scattered-stones", "stones-surface-image"].includes(object.name)) stones.push(object);
    });
    const tree = trees.find(tree => tree.userData.cell === 51);
    const water = scene.getObjectByName("generated-water");
    return { treeCount: trees.length, treeVertices: tree.geometry.attributes.position.count,
      treeTexture: tree.material.map?.image?.src, projection: !!tree.material.userData.surfaceProjection,
      stones: stones.reduce((sum, mesh) => sum + mesh.count, 0), texturedStones: stones.filter(mesh => !!mesh.material.map).reduce((sum, mesh) => sum + mesh.count, 0),
      stoneShapes: [...new Set(stones.filter(mesh => mesh.count).map(mesh => mesh.geometry.userData.stoneShape))].sort(),
      stoneMaps: stones.filter(mesh => !!mesh.material.map).map(mesh => mesh.material.map.image?.src),
      pixelGround: !!ground.material.userData.pixelInk,
      groundMin: Math.min(...ground.geometry.attributes.color.array),
      reflection: water.material.uniforms.hasReflection.value,
      reflectionSize: water.material.uniforms.reflectionMap.value?.image.width,
      groundImages: scene.children.filter((child: any) => child.getObjectByName("surface-image")).length };
  });
  const before = await inspect();
  expect(before.pixelGround).toBe(true);
  expect(before.groundMin).toBeCloseTo(1, 5);
  expect(before.stones).toBeGreaterThan(60);
  expect(before.stoneShapes).toEqual(["pebble", "weathered"]);
  expect(before.treeCount).toBeGreaterThan(0);
  await expect.poll(async () => (await inspect()).reflection).toBe(1);
  expect((await inspect()).reflectionSize).toBe(256);
  await openPlaced(page, "standing");
  await setPresentation(page, "placement", "surface");
  await page.getByRole("dialog").getByRole("button", { name: "저장", exact: true }).click();
  await openPlaced(page, "stone-picture");
  await setPresentation(page, "placement", "surface");
  await page.getByRole("dialog").getByRole("button", { name: "저장", exact: true }).click();
  await expect.poll(async () => (await inspect()).texturedStones).toBeGreaterThan(0);
  await expect.poll(async () => (await inspect()).stoneMaps.every(src => !!src)).toBe(true);
  const applied = await inspect();
  expect(applied.treeTexture).toMatch(/^data:image/);
  expect(applied.projection).toBe(true);
  expect(applied.treeVertices).toBe(before.treeVertices);
  expect(applied.treeCount).toBe(before.treeCount);
  expect(applied.stones).toBe(before.stones);
  expect(applied.stoneShapes).toEqual(before.stoneShapes);
  expect(applied.stoneMaps).toContain(applied.treeTexture);
  expect(applied.groundImages).toBeGreaterThanOrEqual(2);
  await page.screenshot({ path: testInfo.outputPath("environment-surfaces.png") });
  await page.getByRole("button", { name: "플레이", exact: true }).click();
  await page.locator(".play-shell canvas").waitFor();
  await page.screenshot({ path: testInfo.outputPath("trunks-ground-play.png") });
  expect(errors).toEqual([]);
});

test("three placements without visibility controls remain usable on mobile with reduced motion", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = await openScene(page);
  await openPlaced(page, "standing");
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator(".asset-presentation-controls button")).toHaveCount(1);
  await expect(dialog.locator("[data-placement]")).toBeVisible();
  await expect(dialog.getByRole("group", { name: "움직임", exact: true })).toHaveCount(0);
  await setPresentation(page, "placement", "surface");
  await page.screenshot({ path: testInfo.outputPath("surface-options-mobile.png") });
  await dialog.getByRole("button", { name: "저장", exact: true }).click();
  await expect.poll(async () => (await grassSurfaceState(page)).textured).toBeGreaterThan(0);
  expect((await grassSurfaceState(page)).strength).toBe(0);
  await openPlaced(page, "standing");
  await setPresentation(page, "placement", "upright");
  await dialog.getByRole("button", { name: "저장", exact: true }).click();
  await expect.poll(async () => (await grassSurfaceState(page)).textured).toBe(0);
  await expect.poll(async () => (await savedWorld(page)).assets[0].placement).toBe("upright");
  await page.reload();
  await openPlaced(page, "standing");
  await expect(dialog.locator("[data-placement]")).toHaveAttribute("data-placement", "upright");
  expect(errors).toEqual([]);
});

test("opaque water hides changing ground and surface decals regardless of their color", async ({ page }) => {
  await page.goto(".");
  const result = await page.evaluate(async () => {
    const root = "/whistle/";
    const THREE = await import(root + "node_modules/three/build/three.module.js");
    const { makeWaterSurface } = await import(root + "components/whistle/WaterSurface.ts");
    const scene = new THREE.Scene();
    const renderer = new THREE.WebGLRenderer();
    const target = new THREE.WebGLRenderTarget(32, 32);
    renderer.setRenderTarget(target);
    const camera = new THREE.PerspectiveCamera(45, 1, .1, 10);
    camera.position.set(0, 3, 0); camera.up.set(0, 0, -1); camera.lookAt(0, 0, 0);
    const geometry = new THREE.PlaneGeometry(4, 4).rotateX(-Math.PI / 2);
    const water = makeWaterSurface(geometry, 0, { value: 0 });
    geometry.setAttribute("waterDepth", new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count).fill(.6), 1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.7); sun.name = "whistle-sun"; sun.position.set(-1, 2, 1);
    const moon = new THREE.DirectionalLight(0xffffff, .22); moon.name = "whistle-moon"; moon.position.set(1, 2, -1);
    scene.background = water.material.uniforms.skyTint.value.clone().set("#ffffff");
    scene.add(sun, moon);
    const bedMaterial = new THREE.MeshBasicMaterial({ color: "red", transparent: true, depthWrite: false });
    const bed = new THREE.Mesh(geometry, bedMaterial);
    bed.position.y = -.3; bed.renderOrder = 1;
    scene.add(water, bed);
    const sample = (color: string, visible: boolean) => {
      bedMaterial.color.set(color); water.visible = visible;
      renderer.render(scene, camera);
      const pixels = new Uint8Array(4);
      renderer.readRenderTargetPixels(target, 16, 16, 1, 1, pixels);
      return Array.from(pixels);
    };
    const result = { night: [] as number[], wetRed: sample("red", true), wetBlue: sample("blue", true),
      dryRed: sample("red", false), dryBlue: sample("blue", false),
      depthWrite: water.material.depthWrite, transparent: water.material.transparent };
    sun.intensity = 0; scene.background.set("#11151c"); result.night = sample("red", true);
    geometry.dispose(); water.material.dispose(); bedMaterial.dispose(); target.dispose(); renderer.dispose();
    return result;
  });
  expect(result.wetRed).toEqual(result.wetBlue);
  expect(result.dryRed).not.toEqual(result.dryBlue);
  expect(result.wetRed[3]).toBe(255);
  expect(result.night.reduce((sum, v) => sum + v, 0)).toBeLessThan(result.wetRed.reduce((sum, v) => sum + v, 0));
  expect(result.depthWrite).toBe(true);
  expect(result.transparent).toBe(false);
});

test("ground artwork keeps its aspect and color while all four edges fade smoothly", async ({page},testInfo)=>{
  await page.goto(".");
  const result=await page.evaluate(async world=>{
    const root="/whistle/";
    const THREE=await import(root+"node_modules/three/build/three.module.js");
    const {makeSurfaceImage}=await import(root+"components/whistle/SurfaceImage.ts");
    const {makePixelRenderer}=await import(root+"components/whistle/PixelGraphics.ts");
    const source=document.createElement("canvas");source.width=256;source.height=128;
    const paint=source.getContext("2d")!;
    paint.fillStyle="#e54b35";paint.fillRect(0,0,128,128);
    paint.fillStyle="#315ee6";paint.fillRect(128,0,128,128);
    const asset={...world.assets[0],image:source.toDataURL(),text:undefined};
    const placed={id:"feather-art",asset:asset.id,x:6,z:6,rotation:0,scale:2};
    const scene=new THREE.Scene();scene.background=new THREE.Color("#ffffff");
    scene.add(new THREE.AmbientLight(0xffffff,3));
    const terrain=new THREE.Group();
    const ground=new THREE.Mesh(new THREE.PlaneGeometry(24,24,64,64).rotateX(-Math.PI/2),new THREE.MeshStandardMaterial({color:"#929292"}));
    ground.name="continuous-ground";terrain.add(ground);scene.add(terrain);
    const pictureGroup=makeSurfaceImage(asset,placed,world,terrain);scene.add(pictureGroup);
    const picture=pictureGroup.children[0];
    await new Promise<void>((resolve,reject)=>{
      const start=performance.now();
      const ready=()=>{
        if(picture.material.map.image?.naturalWidth){resolve();return;}
        if(performance.now()-start>5000){reject(new Error("artwork did not load"));return;}
        requestAnimationFrame(ready);
      };ready();
    });
    picture.geometry.computeBoundingBox();
    const size=picture.geometry.boundingBox.getSize(new THREE.Vector3());
    const renderer=new THREE.WebGLRenderer();
    const pixel=makePixelRenderer(renderer,{value:1});pixel.resize(640,400);
    const camera=new THREE.OrthographicCamera(-2,2,1.25,-1.25,.1,10);
    camera.position.set(1,3,1);camera.up.set(0,0,-1);camera.lookAt(1,0,1);
    pixel.render(scene,camera);
    const copy=document.createElement("canvas");copy.width=640;copy.height=400;
    const context=copy.getContext("2d")!;context.drawImage(renderer.domElement,0,0);
    const frame=context.getImageData(0,0,640,400).data;
    const colored=(x:number,y:number)=>Math.abs(frame[(y*640+x)*4]-frame[(y*640+x)*4+2])>40;
    let center=0,outside=0,count=0;
    for(let y=120;y<280;y++)for(let x=0;x<16;x++){
      center+=Number(colored(190+x,y));outside+=Number(colored(60+x,y));count++;
    }
    const chroma=(x:number,y:number)=>Math.abs(frame[(y*640+x)*4]-frame[(y*640+x)*4+2]);
    const fades=[
      [82,88,96,112,144,190].map(x=>chroma(x,200)),
      [557,551,543,527,495,450].map(x=>chroma(x,200)),
      [82,85,88,94,104,128].map(y=>chroma(200,y)),
      [317,314,311,305,295,271].map(y=>chroma(200,y)),
    ];
    const centerPixel=Array.from(frame.slice((200*640+200)*4,(200*640+200)*4+3));
    const screenshot=copy.toDataURL();
    picture.geometry.dispose();picture.material.map.dispose();picture.material.dispose();
    scene.remove(pictureGroup);
    const positions=ground.geometry.getAttribute("position"),indices=ground.geometry.index;
    const retained=[];
    for(let i=0;i<indices.count;i+=3){
      const triangle=[indices.getX(i),indices.getX(i+1),indices.getX(i+2)];
      if(triangle.every(index=>positions.getX(index)<=1.50001))retained.push(...triangle);
    }
    ground.geometry.setIndex(retained);
    const clipped=makeSurfaceImage(asset,placed,world,terrain);scene.add(clipped);
    const clippedPicture=clipped.children[0];
    await new Promise<void>(resolve=>{
      const ready=()=>clippedPicture.material.map.image?.naturalWidth?resolve():requestAnimationFrame(ready);
      ready();
    });
    pixel.render(scene,camera);context.drawImage(renderer.domElement,0,0);
    const cutFrame=context.getImageData(0,0,640,400).data;
    const cutFade=[398,394,388,380,370,356].map(x=>Math.abs(cutFrame[(200*640+x)*4]-cutFrame[(200*640+x)*4+2]));
    const cutScreenshot=copy.toDataURL();
    clippedPicture.geometry.dispose();clippedPicture.material.map.dispose();clippedPicture.material.dispose();
    ground.geometry.dispose();ground.material.dispose();pixel.dispose();renderer.dispose();
    return {aspect:size.x/size.z,fades,cutFade,cutScreenshot,center:center/count,outside:outside/count,centerPixel,screenshot};
  },terrainFixtures().flat);
  expect(result.aspect).toBeCloseTo(2,3);
  expect(result.center).toBeGreaterThan(.98);
  for(const fade of result.fades){
    expect(fade[0]).toBeLessThan(8);
    expect(fade.at(-1)!).toBeGreaterThan(80);
    for(let i=1;i<fade.length;i++)expect(fade[i]).toBeGreaterThanOrEqual(fade[i-1]);
    expect(new Set(fade).size).toBeGreaterThan(4);
  }
  expect(result.cutFade[0]).toBeLessThan(8);
  expect(result.cutFade.at(-1)!).toBeGreaterThan(80);
  for(let i=1;i<result.cutFade.length;i++)expect(result.cutFade[i]).toBeGreaterThanOrEqual(result.cutFade[i-1]);
  await writeFile(testInfo.outputPath("ground-artwork-cut.png"),Buffer.from(result.cutScreenshot.split(",")[1],"base64"));
  expect(result.outside).toBe(0);
  expect(result.centerPixel[0]-result.centerPixel[2]).toBeGreaterThan(80);
  const screenshot=Buffer.from(result.screenshot.split(",")[1],"base64");
  await writeFile(testInfo.outputPath("ground-artwork.png"),screenshot);
  await testInfo.attach("ground-artwork",{body:screenshot,contentType:"image/png"});
});

test("colored stone artwork retains surface dots and the original material outside its footprint",async({page},testInfo)=>{
  const errors:string[]=[];
  page.on("console",message=>{if(message.type()==="error")errors.push(message.text());});
  await page.goto(".");
  const result=await page.evaluate(async()=>{
    const root="/whistle/";
    const THREE=await import(root+"node_modules/three/build/three.module.js");
    const {stoneGeometry}=await import(root+"components/whistle/StoneGeometry.ts");
    const {projectSurfaceImage}=await import(root+"components/whistle/SurfaceProjection.ts");
    const {makePixelRenderer}=await import(root+"components/whistle/PixelGraphics.ts");
    const source=document.createElement("canvas");source.width=source.height=32;
    const paint=source.getContext("2d")!;paint.fillStyle="#489f6a";paint.fillRect(0,0,32,32);
    const texture=new THREE.CanvasTexture(source);texture.colorSpace=THREE.SRGBColorSpace;
    const material=new THREE.MeshStandardMaterial({map:texture,roughness:1});
    projectSurfaceImage(material,new THREE.Vector3(),1.3,0);
    const rock=new THREE.InstancedMesh(stoneGeometry(0),material,1);
    rock.setMatrixAt(0,new THREE.Matrix4());rock.setColorAt(0,new THREE.Color("#777777"));
    rock.name="stones-surface-image";
    const scene=new THREE.Scene();scene.background=new THREE.Color("#ffffff");scene.add(rock,new THREE.AmbientLight(0xffffff,2));
    const camera=new THREE.OrthographicCamera(-1.25,1.25,1.25,-1.25,.1,10);
    camera.position.set(0,3,0);camera.up.set(0,0,-1);camera.lookAt(0,0,0);
    const renderer=new THREE.WebGLRenderer();const pixel=makePixelRenderer(renderer,{value:1});pixel.resize(512,512);
    pixel.render(scene,camera);
    const copy=document.createElement("canvas");copy.width=copy.height=512;
    const context=copy.getContext("2d")!;context.drawImage(renderer.domElement,0,0);
    const frame=context.getImageData(0,0,512,512).data;
    let dots=0,colored=0,count=0;
    for(let y=215;y<295;y++)for(let x=215;x<295;x++){
      const i=(y*512+x)*4;
      dots+=Number(Math.abs(frame[i+1]-frame[i+5])>12);
      colored+=Number(frame[i+1]>frame[i]+25 && frame[i+1]>frame[i+2]+15);count++;
    }
    const outside=Array.from(frame.slice((256*512+420)*4,(256*512+420)*4+3));
    const screenshot=copy.toDataURL();
    rock.geometry.dispose();material.dispose();texture.dispose();pixel.dispose();renderer.dispose();
    return {dots:dots/count,colored:colored/count,outside,screenshot};
  });
  expect(errors).toEqual([]);
  expect(result.colored).toBeGreaterThan(.98);
  expect(result.dots).toBeGreaterThan(.05);
  expect(Math.max(...result.outside)-Math.min(...result.outside)).toBeLessThan(3);
  expect(result.outside[0]).toBeGreaterThan(50);
  expect(result.outside[0]).toBeLessThan(220);
  const screenshot=Buffer.from(result.screenshot.split(",")[1],"base64");
  await writeFile(testInfo.outputPath("colored-stone.png"),screenshot);
  await testInfo.attach("colored-stone",{body:screenshot,contentType:"image/png"});
});
