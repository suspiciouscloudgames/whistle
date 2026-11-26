import * as THREE from "three";
import { setTextOrder } from "./ContentReveal.ts";
import { sceneText } from "../../lib/text-image.ts";
import type { Asset } from "../../lib/world.ts";

const artwork = new Map<string, HTMLCanvasElement>();
const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

function pixelArtwork(image: HTMLImageElement) {
  const cached = artwork.get(image.src);
  if (cached) return cached;
  const scale = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const rgba = pixels.data;
  const light = new Float32Array(canvas.width * canvas.height);
  for (let p = 0; p < light.length; p++) {
    const i = p * 4;
    light[p] = .2126 * rgba[i] + .7152 * rgba[i + 1] + .0722 * rgba[i + 2];
  }
  for (let p = 0; p < light.length; p++) {
    const i = p * 4, x = p % canvas.width, y = Math.floor(p / canvas.width);
    if (rgba[i + 3] === 0) continue;
    const left = x ? p - 1 : p, above = y ? p - canvas.width : p;
    if (Math.abs(light[p] - light[left]) < 1 && Math.abs(light[p] - light[above]) < 1) continue;
    const threshold = (bayer[(y % 4) * 4 + x % 4] + .5) / 16;
    const tone = 8 * Math.floor(light[p] / 8 + threshold);
    const shift = (tone - light[p]) * .3;
    for (let c = 0; c < 3; c++) rgba[i + c] += shift;
  }
  ctx.putImageData(pixels, 0, 0);
  if (artwork.size >= 16) artwork.delete(artwork.keys().next().value!);
  artwork.set(image.src, canvas);
  return canvas;
}

export function loadContentTexture(asset: Asset, onAspect?: (aspect: number) => void) {
  const text = asset.text?.trim() ? sceneText(asset.text, asset.textColor) : undefined;
  const texture = new THREE.TextureLoader().load(text?.image ?? asset.image!, loaded => {
    const image = loaded.image as HTMLImageElement;
    if (!text) loaded.image = pixelArtwork(image);
    onAspect?.(image.naturalWidth / image.naturalHeight);
  });
  texture.colorSpace = THREE.SRGBColorSpace;
  if (text?.order) setTextOrder(texture, text.order);
  texture.magFilter = text ? THREE.NearestFilter : THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return texture;
}
