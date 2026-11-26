import * as THREE from "three";
import type { Asset } from "../../lib/world.ts";

const SPARKS = 56;
const DURATION = 780;

function particleColors(asset: Asset, texture?: THREE.Texture): THREE.Color[] {
  if (asset.text?.trim()) return [new THREE.Color(asset.textColor ?? "#111111")];
  const image = texture?.image as HTMLCanvasElement | HTMLImageElement | undefined;
  if (image?.width && image.height) {
    const sample = document.createElement("canvas");
    sample.width = sample.height = 12;
    const ctx = sample.getContext("2d")!;
    ctx.drawImage(image, 0, 0, 12, 12);
    const rgba = ctx.getImageData(0, 0, 12, 12).data;
    const colors = [];
    for (let i = 0; i < rgba.length; i += 4) {
      if (rgba[i + 3] > 20) colors.push(new THREE.Color().setRGB(rgba[i] / 255, rgba[i+1] / 255, rgba[i+2] / 255, THREE.SRGBColorSpace));
    }
    if (colors.length) return colors;
  }
  return [new THREE.Color("#b8ab97")];
}

function makeBurst(asset: Asset, texture: THREE.Texture | undefined, surface: boolean) {
  const palette = particleColors(asset, texture);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([-.5,-.5,0, .5,-.5,0, .5,.5,0, -.5,.5,0], 3));
  const motion: number[] = [], shape: number[] = [], colors: number[] = [];
  for (let i = 0; i < SPARKS; i++) {
    const angle = Math.random() * Math.PI * 2;
    const up = surface ? .08 + Math.random() * .92 : Math.random() * 2 - 1;
    const radius = Math.sqrt(1 - up * up);
    const speed = .38 + Math.random() * .82;
    motion.push(Math.cos(angle) * radius * speed, up * speed, Math.sin(angle) * radius * speed);
    const width = .024 + Math.random() * .042;
    const lifetime = .36 + Math.random() * .42;
    shape.push(width, lifetime, Math.random() * 6.28);
    const color = palette[Math.floor(Math.random() * palette.length)];
    colors.push(color.r, color.g, color.b);
  }
  geometry.instanceCount = SPARKS;
  geometry.setAttribute("kick", new THREE.InstancedBufferAttribute(new Float32Array(motion), 3));
  geometry.setAttribute("shape", new THREE.InstancedBufferAttribute(new Float32Array(shape), 3));
  geometry.setAttribute("tint", new THREE.InstancedBufferAttribute(new Float32Array(colors), 3));
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, toneMapped: false, uniforms: { age: { value: 0 } },
    vertexShader: `
      uniform float age;
      attribute vec3 kick, tint, shape;
      varying vec2 vUv;
      varying vec3 vTint;
      varying float vAlpha;
      void main() {
        vUv = position.xy * 2.0;
        vTint = tint;
        float life = clamp(age / shape.y, 0.0, 1.0);
        float spread = 1.0 - exp(-8.0 * age);
        vec3 offset = kick * (.055 + spread);
        offset.y += .20 * age - .75 * age * age;
        vec4 center = modelViewMatrix * vec4(offset, 1.0);
        float width = shape.x * (1.0 - .6 * life) * length(modelMatrix[0].xyz);
        vec3 direction = mat3(modelViewMatrix) * kick;
        float angle = atan(direction.y, direction.x) + life * sin(shape.z);
        vec2 flake = position.xy * vec2(1.0 + .85 * (1.0 - smoothstep(0.0, .25, age)), .82);
        center.xy += mat2(cos(angle), sin(angle), -sin(angle), cos(angle)) * flake * width;
        vAlpha = 1.0 - smoothstep(.48, 1.0, life);
        gl_Position = projectionMatrix * center;
      }`,
    fragmentShader: `
      varying vec2 vUv;
      varying vec3 vTint;
      varying float vAlpha;
      void main() {
        float edge = abs(vUv.x) + abs(vUv.y);
        float alpha = (1.0 - smoothstep(.82, 1.0, edge)) * vAlpha;
        if (alpha < .012) discard;
        float core = 1.0 - smoothstep(.25, .55, edge);
        vec3 color = mix(.75 * vTint, vec3(1.0, .94, .80), .13 + .60 * core);
        gl_FragColor = vec4(color, alpha);
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "passage-particles";
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  return mesh;
}

export function makePassageParticles() {
  const group = new THREE.Group();
  const active = new Map<ReturnType<typeof makeBurst>, number>();
  return { group,
    start(asset: Asset, texture: THREE.Texture | undefined, origin: THREE.Vector3, scale: number, surface: boolean, time: number) {
      const burst = makeBurst(asset, texture, surface);
      burst.position.copy(origin);
      burst.scale.setScalar(Math.sqrt(scale));
      active.set(burst, time);
      group.add(burst);
    },
    update(time: number) {
      for (const [burst, start] of active) {
        const elapsed = time - start;
        if (elapsed >= DURATION) {
          burst.removeFromParent();
          burst.geometry.dispose();
          burst.material.dispose();
          active.delete(burst);
        } else {
          burst.material.uniforms.age.value = elapsed / 1000;
        }
      }
    },
  };
}
