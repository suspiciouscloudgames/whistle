import { test, expect } from "@playwright/test";

for (const samples of [0, 4]) {
  test(`pixel rendering keeps colors and transparency in one scene pass with ${samples} samples`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.route("**/pixel-renderer-test", route => route.fulfill({ contentType: "text/html", body: "<html></html>" }));
    await page.goto("pixel-renderer-test");
    const result = await page.evaluate(async samples => {
      const root = "/whistle/";
      const THREE = await import(root + "node_modules/three/build/three.module.js");
      const { makePixelRenderer } = await import(root + "components/whistle/PixelGraphics.ts");
      const renderer = new THREE.WebGLRenderer();
      renderer.setClearColor("#123456", .4);
      renderer.info.autoReset = false;
      const pixel = makePixelRenderer(renderer, { value: 1 }, samples);
      const scene = new THREE.Scene();
      scene.background = new THREE.Color("#224477");
      const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, .1, 10);
      camera.position.z = 3;
      const geometry = new THREE.PlaneGeometry(1.4, 2);
      const terrain = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: "#ff0000" }));
      terrain.position.x = -.85;
      const artwork = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: "#ff0000", transparent: true, opacity: .5 }));
      artwork.name = "symbol-content";
      artwork.position.x = .85;
      scene.add(terrain, artwork);
      const gl = renderer.getContext();
      const frames = [];
      for (const size of [128, 192]) {
        pixel.resize(size, size);
        renderer.info.reset();
        pixel.render(scene, camera);
        const calls = renderer.info.render.calls;
        const copy = document.createElement("canvas");
        copy.width = copy.height = size;
        const context = copy.getContext("2d")!;
        context.drawImage(renderer.domElement, 0, 0);
        const sample = (x: number) => Array.from(context.getImageData(Math.floor(size * x), size / 2, 1, 1).data).slice(0, 3);
        frames.push({ calls, terrain: sample(.28), artwork: sample(.72), background: sample(.02), error: gl.getError() });
      }
      artwork.visible = false;
      terrain.visible = false;
      pixel.render(scene, camera);
      const copy = document.createElement("canvas"); copy.width = copy.height = 192;
      const context = copy.getContext("2d")!;
      context.drawImage(renderer.domElement, 0, 0);
      const cleared = Array.from(context.getImageData(138, 96, 1, 1).data).slice(0, 3);
      artwork.visible = true;
      const reflection = new THREE.WebGLRenderTarget(32, 32);
      renderer.setRenderTarget(reflection);
      renderer.render(scene, camera);
      const reflectionError = gl.getError();
      const state = { clear: renderer.getClearColor(new THREE.Color()).getHexString(), alpha: renderer.getClearAlpha(), autoClear: renderer.autoClear, background: scene.background.getHexString() };
      reflection.dispose(); geometry.dispose(); terrain.material.dispose(); artwork.material.dispose(); pixel.dispose(); renderer.dispose();
      return { frames, cleared, reflectionError, state };
    }, samples);
    for (const frame of result.frames) {
      expect(frame.calls).toBe(3);
      expect(frame.error).toBe(0);
      expect(new Set(frame.terrain).size).toBe(1);
      expect(new Set(frame.background).size).toBe(1);
      expect(frame.artwork[0]).toBeGreaterThan(frame.artwork[2] + 80);
      expect(frame.artwork[2]).toBeGreaterThan(20);
    }
    expect(result.frames[1].artwork).toEqual(result.frames[0].artwork);
    expect(result.cleared).toEqual(result.frames[1].background);
    expect(result.reflectionError).toBe(0);
    expect(result.state).toEqual({ clear: "123456", alpha: .4, autoClear: true, background: "224477" });
    expect(errors).toEqual([]);
  });
}
