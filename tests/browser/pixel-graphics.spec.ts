import { test, expect, type Page } from "@playwright/test";
import { LinearFilter } from "three";
import { terrainFixtures } from "../terrain-fixtures";

test.setTimeout(90_000);
test.beforeEach(async({page})=>{
  await page.addInitScript(()=>{
    const get=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(this:HTMLCanvasElement,kind:string,options?:object){
      return get.call(this,kind,kind==="webgl"||kind==="webgl2"?{...options,preserveDrawingBuffer:true}:options);
    } as typeof get;
  });
});

async function pixels(page: Page) {
  await page.locator('.scene canvas').scrollIntoViewIfNeeded();
  await expect(page.locator('.scene canvas')).toHaveAttribute('data-ready','true',{timeout:30_000});
  return page.locator(".scene canvas").evaluate(canvas => new Promise<{ shades: number[]; lit: number; total: number; width: number; displayWidth: number }>(resolve => {
    requestAnimationFrame(() => {
      const source = canvas as HTMLCanvasElement;
      const copy = document.createElement("canvas");
      copy.width = source.width;
      copy.height = source.height;
      const context = copy.getContext("2d")!;
      context.drawImage(source, 0, 0);
      const data = context.getImageData(0, 0, copy.width, copy.height).data;
      const shades = new Set<number>();
      let lit = 0;
      for (let i = 0; i < data.length; i += 4) {
        shades.add(data[i] * 65536 + data[i + 1] * 256 + data[i + 2]);
        if (data[i] > 0) lit++;
      }
      resolve({ shades: [...shades].sort((a, b) => a - b), lit, total: data.length / 4,
        width: source.width, displayWidth: source.clientWidth });
    });
  }));
}

test("forest and water keep a limited grayscale palette through resize, night and play", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  const world = terrainFixtures().mixed;
  world.timeOfDay = "noon";
  await page.addInitScript(world => {
    localStorage.setItem("whistle.world.v2", JSON.stringify(world));
    localStorage.setItem("whistle.language", "ko");
  }, world);
  await page.goto(".");
  await page.locator(".scene canvas").waitFor();
  const check = async () => {
    await expect.poll(async () => (await pixels(page)).shades.length).toBeGreaterThan(2);
    const frame = await pixels(page);
    expect(frame.shades.length).toBeLessThanOrEqual(256);
    expect(frame.shades.every(color => (color >> 16) === ((color >> 8) & 255) && (color >> 16) === (color & 255))).toBe(true);
    expect(frame.lit).toBeGreaterThan(0);
    const ratio=await page.evaluate(()=>Math.min(devicePixelRatio,1));
    expect(frame.width).toBeLessThanOrEqual(Math.floor(frame.displayWidth*ratio));
    expect(frame.width).toBeGreaterThanOrEqual(Math.floor(frame.displayWidth*Math.min(ratio,.5)));
  };
  await check();
  await page.locator(".live-preview").screenshot({ path: testInfo.outputPath("pixel-overview.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await check();
  await page.locator(".daylight-indicator").click();
  await page.getByRole("button", { name: "한밤중", exact: true }).click();
  await check();
  await page.getByRole("button", { name: "플레이", exact: true }).click();
  await page.locator(".play-shell canvas").waitFor();
  await check();
  await page.locator(".play-shell canvas").screenshot({ path: testInfo.outputPath("pixel-play.png") });
  expect(errors).toEqual([]);
});

test.describe("pixel lettering", () => {
  test.use({deviceScaleFactor: 2});
  test("stored Korean and Latin text stays in the selected ink on a stable pixel grid", async ({page},testInfo) => {
    const errors: string[]=[];
    page.on("pageerror",error=>errors.push(error.message));
    page.on("console",message=>{if(message.type()==="error")errors.push(message.text());});
    await page.route(/\/components\/whistle\/Scene\.tsx(\?|$)/,async route=>{
      const response=await route.fetch();
      const body=(await response.text()).replace("const scene = new THREE.Scene();","const scene = new THREE.Scene(); globalThis.__textScene = scene;");
      await route.fulfill({response,body});
    });
    const world=terrainFixtures().flat;
    world.timeOfDay="noon";
    world.assets[0].text="Whistle\n가느다란 글씨";
    world.assets[0].textColor="#d53030";
    world.assets[0].placement="floating";
    world.objects=[{id:"native-text",asset:world.assets[0].id,x:6,z:6,rotation:0,scale:3}];
    await page.addInitScript(world=>{
      const canvas=document.createElement("canvas");canvas.width=canvas.height=32;
      canvas.getContext("2d")!.fillRect(0,0,32,32);
      world.assets[0].image=canvas.toDataURL();
      localStorage.setItem("whistle.world.v2",JSON.stringify(world));
      localStorage.setItem("whistle.language","ko");
    },world);
    await page.goto("?quality=high");
    await expect.poll(async()=> (await pixels(page)).shades.some(color=>(color>>16)>100 && (color>>16)-(color&255)>40),
      { timeout:15_000, intervals:[100,200,250] }).toBe(true);
    const frame=await pixels(page);
    expect(frame.width).toBe(frame.displayWidth*2);
    await expect.poll(()=>page.evaluate(()=>{
      const material=(globalThis as any).__textScene?.getObjectByName("symbol-content")?.material;
      const image = material?.map?.image;
      if (!image?.naturalWidth) return [];
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = image.width;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(image,0,0);
      const rgba = ctx.getImageData(0,0,image.width,image.height).data;
      return [image.width, [...new Set(rgba.filter((_,i) => i % 4 === 3))].sort((a,b) => a-b)];
    })).toEqual([128,[0,85,170,255]]);
    const denseSize = await page.evaluate(async () => {
      const path = new URL("./lib/text-image.ts", document.baseURI).href;
      const { contentImage } = await import(path);
      const preview = new Image();
      preview.src = contentImage({ text: "글자와 풍경 ".repeat(130) });
      await preview.decode();
      return preview.width;
    });
    expect(denseSize).toBeGreaterThan(128);
    await page.locator(".scene canvas").screenshot({path:testInfo.outputPath("pixel-text.png")});
    expect(errors).toEqual([]);
  });
});

test("Korean glyphs appear in order and fade in place at slightly different rates while an image fades evenly", async ({page}) => {
  await page.goto(".");
  const result = await page.evaluate(async () => {
    const root = new URL("./", document.baseURI).href;
    const THREE = await import(root + "node_modules/three/build/three.module.js");
    const { loadContentTexture } = await import(root + "components/whistle/ContentTexture.ts");
    const { bindContentReveal } = await import(root + "components/whistle/ContentReveal.ts");
    const renderer = new THREE.WebGLRenderer({preserveDrawingBuffer:true});
    renderer.setSize(128,128);
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1,1,1,-1,.1,10);
    camera.position.z = 2;
    const source = document.createElement("canvas");
    source.width = source.height = 128;
    const ctx = source.getContext("2d")!;
    ctx.fillStyle = "white"; ctx.fillRect(0,0,128,128);
    async function inspect(asset: object) {
      const map = await new Promise<any>(resolve => {
        const texture = loadContentTexture(asset, () => resolve(texture));
      });
      const material = new THREE.MeshBasicMaterial({map,transparent:true,toneMapped:false,side:THREE.DoubleSide});
      const geometry = new THREE.PlaneGeometry(2, 2);
      const mesh = new THREE.Mesh(geometry,material);
      const {progress, departure} = bindContentReveal(material);
      scene.add(mesh);
      const read = (value: number, back = false, exit = 0) => {
        progress.value = value;
        departure.value = exit;
        material.opacity = ("text" in asset ? 1 : value) * (1 - THREE.MathUtils.smoothstep(exit, 0, 1));
        mesh.rotation.y = back ? Math.PI : 0;
        renderer.render(scene,camera); ctx.drawImage(renderer.domElement,0,0);
        const data = ctx.getImageData(0,0,128,128).data, sums = [0,0,0,0];
        for (let y=0;y<128;y++) for (let x=0;x<128;x++) sums[Number(y>=64)*2+Number(x>=64)] += data[(y*128+x)*4];
        return sums;
      };
      const full = read(1);
      const before = ctx.getImageData(0,0,128,128).data;
      const fading = read(1, false, .55).map((sum, i) => sum / full[i]);
      const after = ctx.getImageData(0,0,128,128).data;
      let movedPixels = 0;
      for (let i=0;i<after.length;i+=4) if (before[i] === 0 && after[i] > 0) movedPixels++;
      const samples = [read(0),read(.22),read(.55),read(.22,true)].map(values => values.map((n,i)=>n/full[i]));
      mesh.removeFromParent(); geometry.dispose(); material.dispose(); map.dispose();
      return { samples, fading, movedPixels };
    }
    const image = source.toDataURL();
    const text = await inspect({text:"가가\n가가",textColor:"#ffffff"});
    const artwork = await inspect({image});
    renderer.dispose();
    return {text,artwork};
  });
  const [hidden, early, middle, back] = result.text.samples;
  expect(hidden).toEqual([0,0,0,0]);
  expect(early[0]).toBeGreaterThan(.25);
  expect(early[1]).toBeLessThan(early[0] * .3);
  expect(early.slice(2)).toEqual([0,0]);
  expect(middle[0]).toBeGreaterThan(.95);
  expect(middle[1]).toBeGreaterThan(middle[2]+.2);
  expect(middle[2]).toBeGreaterThan(middle[3]+.1);
  expect(back[0]).toBeCloseTo(early[0],1);
  expect(result.text.movedPixels).toBe(0);
  const spread = Math.max(...result.text.fading) - Math.min(...result.text.fading);
  expect(spread).toBeGreaterThan(.025);
  expect(spread).toBeLessThan(.16);
  for (const sample of [...result.artwork.samples.slice(1), result.artwork.fading]) {
    expect(Math.max(...sample)-Math.min(...sample)).toBeLessThan(.01);
    expect(sample[0]).toBeGreaterThan(.05);
    expect(sample[0]).toBeLessThan(.9);
  }
  expect(result.artwork.samples[2][0]).toBeGreaterThan(result.artwork.samples[1][0]);
});

test("uploaded artwork keeps fine lines, transparency and color under a light filter", async ({page}) => {
  await page.goto(".");
  const result = await page.evaluate(async () => {
    const path = new URL("./components/whistle/ContentTexture.ts", document.baseURI).href;
    const { loadContentTexture } = await import(path);
    const source = document.createElement("canvas");
    source.width = 256; source.height = 111;
    const ctx = source.getContext("2d")!;
    const gradient = ctx.createLinearGradient(0, 0, 256, 0);
    gradient.addColorStop(0, "#421800"); gradient.addColorStop(1, "#f8b578");
    ctx.fillStyle = gradient;
    ctx.fillRect(20, 0, 236, 111);
    ctx.fillStyle = "rgba(80, 120, 160, .5)";
    ctx.fillRect(4, 0, 8, 111);
    ctx.fillStyle = "#fff";
    ctx.fillRect(20, 60, 236, 12);
    ctx.fillStyle = "#111";
    for (let x = 20; x < 256; x += 3) ctx.fillRect(x, 60, 1, 12);
    const input = ctx.getImageData(0, 0, source.width, source.height).data;
    const image = source.toDataURL();
    let aspect = 0;
    const load = () => new Promise<any>(resolve => {
      const texture = loadContentTexture({ image }, (ratio: number) => { aspect = ratio; resolve(texture); });
    });
    const first = await load(), second = await load();
    const canvas = first.image as HTMLCanvasElement;
    const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    const red = (x: number, y: number) => data[(y * canvas.width + x) * 4];
    let maxShift = 0;
    for (let i = 20 * 4; i < 256 * 4; i++) maxShift = Math.max(maxShift, Math.abs(data[i] - input[i]));
    const linesIntact = Array.from({length: 78}, (_, i) => 20 + 3 * i)
      .every(x => red(x + 1, 65) - red(x, 65) > 220);
    first.dispose(); second.dispose();
    return { width: canvas.width, height: canvas.height, aspect, clear: data[3], halfAlpha: data[6 * 4 + 3],
      linesIntact, maxShift, magFilter: first.magFilter,
      reused: canvas === second.image, original: source.toDataURL() === image };
  });
  expect(result).toMatchObject({width:256, height:111, aspect:256/111, clear:0, halfAlpha:128,
    linesIntact:true, magFilter:LinearFilter, reused:true, original:true});
  expect(result.maxShift).toBeGreaterThan(0);
  expect(result.maxShift).toBeLessThanOrEqual(3);
});

test("user artwork keeps its colors in upright and surface placements", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(error.message));
  const world = terrainFixtures().flat;
  world.timeOfDay = "noon";
  world.objects = [{ id: "color-art", asset: world.assets[0].id, x: 6, z: 6, rotation: 0, scale: 3 }];
  await page.addInitScript(world => {
    const image = document.createElement("canvas");
    image.width = image.height = 64;
    const context = image.getContext("2d")!;
    context.fillStyle = "#ed362b";
    context.fillRect(0, 0, 32, 64);
    context.fillStyle = "#254de8";
    context.fillRect(32, 0, 32, 64);
    world.assets[0].image = image.toDataURL();
    localStorage.setItem("whistle.world.v2", JSON.stringify(world));
    localStorage.setItem("whistle.language", "ko");
  }, world);
  await page.goto(".");
  await page.locator(".scene canvas").waitFor();
  const checkColors = async () => {
    await expect.poll(async () => {
      const frame = await pixels(page);
      const red = frame.shades.some(color => (color >> 16) > 120 && (color >> 16) - (color & 255) > 40);
      const blue = frame.shades.some(color => (color & 255) > 120 && (color & 255) - (color >> 16) > 40);
      return red && blue;
    }).toBe(true);
  };
  await page.locator(".scene canvas").screenshot({ path: testInfo.outputPath("user-colors.png") });
  await checkColors();
  await page.locator('[data-symbol-site="color-art"]').click();
  const placement = page.getByRole("dialog").locator("[data-placement]");
  for (let i = 0; i < 3 && await placement.getAttribute("data-placement") !== "surface"; i++) await placement.click();
  await page.getByRole("dialog").getByRole("button", { name: "저장", exact: true }).click();
  await checkColors();
  expect(errors).toEqual([]);
});

test("cloud sky retains gray cloud masses in daylight and at night", async ({page}, testInfo) => {
  const world=terrainFixtures().mixed;
  world.weather="cloud";
  world.timeOfDay="noon";
  await page.setViewportSize({width:1280,height:900});
  await page.addInitScript(world=>{
    localStorage.setItem("whistle.world.v2",JSON.stringify(world));
    localStorage.setItem("whistle.language","ko");
  },world);
  await page.goto(`?meeting=cloud-sky-${Date.now()}`);
  await expect(page.getByRole("button", { name: "파일 저장", exact: true })).toHaveAttribute("aria-description", "이 브라우저에 저장됨");
  const canvas = page.locator(".play-shell canvas");
  const skyBands = () => canvas.evaluate(sourceElement => {
    const source=sourceElement as HTMLCanvasElement;
    const copy=document.createElement("canvas");
    copy.width=source.width;copy.height=Math.floor(source.height*.18);
    const context=copy.getContext("2d")!;
    context.drawImage(source,0,0);
    const data=context.getImageData(0,0,copy.width,copy.height).data;
    const bands=[0,0,0,0];
    for(let i=0;i<data.length;i+=4){
      const v=data[i];
      if(v<15)bands[0]++;
      else if(v<100)bands[1]++;
      else if(v<235)bands[2]++;
      else bands[3]++;
    }
    return bands.map(count=>count/(data.length/4));
  });
  await page.getByRole("button",{name:"플레이",exact:true}).click();
  await expect(canvas).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
  await expect.poll(async()=> (await skyBands())[2]).toBeGreaterThan(.1);
  await expect.poll(async()=> (await skyBands())[3]).toBeGreaterThan(.1);
  await canvas.screenshot({path:testInfo.outputPath("cloud-day.png")});
  await page.getByRole("button",{name:"만들기로 돌아가기",exact:true}).click();
  await page.locator(".daylight-indicator").click();
  await page.getByRole("button",{name:"한밤중",exact:true}).click();
  await page.getByRole("button",{name:"플레이",exact:true}).click();
  await expect(canvas).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
  await expect.poll(async()=> (await skyBands())[0]).toBeGreaterThan(.1);
  await expect.poll(async()=> (await skyBands())[1]).toBeGreaterThan(.1);
  await canvas.screenshot({path:testInfo.outputPath("cloud-night.png")});
});

test("water keeps reflected contrast without dense dots or hard tonal bands", async ({page},testInfo) => {
  await page.goto(".");
  const result=await page.evaluate(async()=>{
    const root="/whistle/";
    const THREE=await import(root+"node_modules/three/build/three.module.js");
    const {makeWaterSurface}=await import(root+"components/whistle/WaterSurface.ts");
    const {makePixelRenderer}=await import(root+"components/whistle/PixelGraphics.ts");
    const renderer=new THREE.WebGLRenderer();
    const pixel=makePixelRenderer(renderer,{value:1});pixel.resize(256,256);
    const scene=new THREE.Scene();
    scene.background=new THREE.Color(0xffffff);
    const camera=new THREE.OrthographicCamera(-2,2,2,-2,.1,10);
    camera.position.set(0,3,0);camera.up.set(0,0,-1);camera.lookAt(0,0,0);
    const geometry=new THREE.PlaneGeometry(4,4).rotateX(-Math.PI/2);
    geometry.setAttribute("waterDepth",new THREE.Float32BufferAttribute([.6,.6,.6,.6],1));
    const water=makeWaterSurface(geometry,0,{value:0});scene.add(water);
    const data=new Uint8Array(64*64*4);
    for(let y=0;y<64;y++)for(let x=0;x<64;x++){
      const i=(y*64+x)*4;data[i]=data[i+1]=data[i+2]=x<32?12:166;data[i+3]=255;
    }
    const reflected=new THREE.DataTexture(data,64,64);reflected.needsUpdate=true;
    const uniforms=water.material.uniforms;
    uniforms.reflectionMap.value=reflected;uniforms.hasReflection.value=1;
    uniforms.reflectionMatrix.value.set(.25,0,0,.5, 0,0,.25,.5, 0,1,0,0, 0,0,0,1);
    pixel.render(scene,camera);
    const copy=document.createElement("canvas");copy.width=copy.height=256;
    const context=copy.getContext("2d")!;context.drawImage(renderer.domElement,0,0);
    const frame=context.getImageData(0,0,256,256).data;
    const stripMean=(x:number,y:number,width:number,height:number)=>{
      let sum=0;
      for(let row=y;row<y+height;row++)for(let col=x;col<x+width;col++)sum+=frame[(row*256+col)*4];
      return sum/(width*height);
    };
    const borderDifference=Math.max(
      Math.abs(stripMean(0,64,2,128)-stripMean(16,64,2,128)),
      Math.abs(stripMean(254,64,2,128)-stripMean(238,64,2,128)),
      Math.abs(stripMean(32,0,64,2)-stripMean(32,16,64,2)),
      Math.abs(stripMean(32,254,64,2)-stripMean(32,238,64,2)),
    );
    let dark=0,light=0,jumps=0,count=0;
    for(let y=32;y<224;y++)for(let x=32;x<96;x++){
      const a=(y*256+x)*4,b=(y*256+x+128)*4;
      dark+=frame[a];light+=frame[b];
      if(Math.abs(frame[a]-frame[a+4])>8)jumps++;
      count++;
    }
    for(let y=0;y<64;y++)for(let x=0;x<64;x++){
      const i=(y*64+x)*4;data[i]=data[i+1]=data[i+2]=Math.round(x/63*80);
    }
    reflected.minFilter=reflected.magFilter=THREE.LinearFilter;reflected.needsUpdate=true;
    pixel.render(scene,camera);context.drawImage(renderer.domElement,0,0);
    const gradient=context.getImageData(0,0,256,256).data;
    const columns:number[]=[];
    for(let x=32;x<224;x++){
      let sum=0;for(let y=48;y<208;y++)sum+=gradient[(y*256+x)*4];
      columns.push(sum/160);
    }
    const gradientJump=Math.max(...columns.slice(1).map((value,i)=>Math.abs(value-columns[i])));
    const gradientRange=Math.max(...columns)-Math.min(...columns);
    const screenshot=copy.toDataURL();
    reflected.dispose();geometry.dispose();water.material.dispose();pixel.dispose();renderer.dispose();
    return {contrast:(light-dark)/count,roughness:jumps/count,borderDifference,gradientJump,gradientRange,screenshot};
  });
  expect(result.contrast).toBeGreaterThan(65);
  expect(result.borderDifference).toBeLessThan(10);
  expect(result.roughness).toBeLessThan(.18);
  expect(result.gradientJump).toBeLessThan(4);
  expect(result.gradientRange).toBeGreaterThan(35);
  await testInfo.attach("water-tone-gradient",{body:Buffer.from(result.screenshot.split(",")[1],"base64"),contentType:"image/png"});
});

test("sky and distant ground keep the same horizon tone during automatic sunset", async ({ page }, testInfo) => {
  const world = terrainFixtures().flat;
  world.timeOfDay = "auto";
  world.weather = "cloud";
  await page.clock.install({ time: new Date(2026, 10, 19, 12) });
  await page.setViewportSize({ width: 960, height: 720 });
  await page.route(/\/components\/whistle\/Scene\.tsx(\?|$)/, async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace(
      "pixelRenderer.render(scene, camera);",
      'if(mode === "play") { camera.position.set(0,1.35,0); camera.lookAt(0,1.35,-1); camera.updateMatrixWorld(); scene.getObjectByName("dithered-sky").position.copy(camera.position); } pixelRenderer.render(scene, camera);',
    ) });
  });
  await page.addInitScript(world => {
    localStorage.setItem("whistle.world.v2", JSON.stringify(world));
    localStorage.setItem("whistle.language", "ko");
  }, world);
  await page.goto(".");
  await page.getByRole("button", { name: "플레이", exact: true }).click();
  await expect(page.locator('.play-shell canvas')).toHaveAttribute('data-ready','true',{timeout:30_000});
  for (const [hour, minute] of [[17, 30], [18, 0], [18, 30], [23, 0]]) {
    await page.clock.setSystemTime(new Date(2026, 10, 19, hour, minute));
    await page.clock.runFor(2500);
    const tones = await page.locator(".play-shell canvas").evaluate(canvas => new Promise<number[]>(resolve => requestAnimationFrame(() => {
      const source = canvas as HTMLCanvasElement;
      const copy = document.createElement("canvas");
      copy.width = source.width; copy.height = source.height;
      const context = copy.getContext("2d")!;
      context.drawImage(source, 0, 0);
      resolve([.48, .52].map(y => {
        const pixels = context.getImageData(Math.floor(copy.width*.25), Math.floor(copy.height*y), Math.floor(copy.width*.5), 1).data;
        let sum = 0;
        for (let i = 0; i < pixels.length; i += 4) sum += pixels[i];
        return sum / (pixels.length/4);
      }));
    })));
    expect(tones[0], "the canvas contains a rendered frame").toBeGreaterThan(3);
    expect(Math.abs(tones[0]-tones[1]), `horizon at ${hour}:${minute}: ${tones}`).toBeLessThan(4);
    if (hour === 18 && minute === 0) await page.locator(".play-shell canvas").screenshot({ path: testInfo.outputPath("sunset-horizon.png") });
  }
});
