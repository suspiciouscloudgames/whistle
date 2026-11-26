import * as THREE from "three";
import type { TextOrder } from "../../lib/text-image.ts";

const orders = new WeakMap<THREE.Texture, { map: THREE.DataTexture; top: number; span: number; count: number; duration: number }>();

export function setTextOrder(texture: THREE.Texture, layout: TextOrder) {
  const map = new THREE.DataTexture(layout.data, layout.width, layout.height, THREE.RGFormat);
  map.needsUpdate = true;
  const duration = .4 + Math.min(5, (layout.count - 1) * .16);
  orders.set(texture, { map, top: layout.top, span: layout.span, count: layout.count, duration });
  texture.addEventListener("dispose", () => map.dispose());
}

type Reveal = { progress: { value: number }; departure: { value: number }; duration: number };
const materials = new WeakMap<THREE.Material, Reveal>();

export function bindContentReveal(material: THREE.MeshBasicMaterial) {
  const existing = materials.get(material);
  if (existing) return existing;
  const order = material.map && orders.get(material.map);
  const binding = { progress: { value: 1 }, departure: { value: 0 }, duration: order?.duration ?? 1.6 };
  materials.set(material, binding);
  const previous = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.customProgramCacheKey = () => key + (order ? "|glyph-reveal" : "|image-fade");
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    if (order) {
      shader.uniforms.readProgress = binding.progress;
      shader.uniforms.readDeparture = binding.departure;
      shader.uniforms.readOrder = { value: order.map };
      shader.uniforms.readRows = { value: new THREE.Vector2(order.top, order.span) };
      shader.uniforms.readSoftness = { value: .4 / order.duration };
      shader.uniforms.readLastGlyph = { value: order.count - 1 };
      shader.fragmentShader = `
        uniform float readProgress, readDeparture, readSoftness, readLastGlyph;
        uniform sampler2D readOrder;
        uniform vec2 readRows;
        float glyphOpacity(vec2 uv) {
          if (readProgress <= 0.0) return 0.0;
          if (readProgress >= 1.0 && readDeparture <= 0.0) return 1.0;
          vec2 bytes = texture2D(readOrder, vec2(uv.x, (1.0 - uv.y - readRows.x) / readRows.y)).rg;
          float rank = dot(bytes, vec2(256.0, 1.0)) / 257.0;
          float revealed = smoothstep(0.0, readSoftness, readProgress - rank * (1.0 - readSoftness));
          float ordinal = floor(rank * readLastGlyph + .5);
          float duration = mix(.86, 1.0, fract(.17 + ordinal * .618034));
          float commonFade = 1.0 - smoothstep(0.0, 1.0, readDeparture);
          float glyphFade = 1.0 - smoothstep(0.0, duration, readDeparture);
          return revealed * glyphFade / max(commonFade, .0001);
        }
      ` + shader.fragmentShader;
    }
    shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `
      #ifdef USE_MAP
        vec2 readingUv = vMapUv;
        #ifdef FLIP_SIDED
          readingUv.x = 1.0 - readingUv.x;
        #elif defined(DOUBLE_SIDED)
          if (!gl_FrontFacing) readingUv.x = 1.0 - readingUv.x;
        #endif
        ${THREE.ShaderChunk.map_fragment.replace("vMapUv", "readingUv")}
        ${order ? "diffuseColor.a *= glyphOpacity(readingUv);" : ""}
      #endif
    `);
  };
  material.needsUpdate = true;
  return binding;
}
