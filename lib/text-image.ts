import { MAX_TEXT_LENGTH, type Asset } from "./world.ts";
import { optimizedImage } from "./image-export.ts";

const renderedText = new Map<string,string>();

export function contentImage(asset: Pick<Asset,"image" | "text" | "textColor">) {
  if (!asset.text?.trim()) return asset.image;
  const key=JSON.stringify([asset.text,asset.textColor]);
  const cached=renderedText.get(key);
  if (cached) return cached;
  const image=renderText(asset.text,asset.textColor,true);
  if (renderedText.size >= 64) renderedText.delete(renderedText.keys().next().value!);
  renderedText.set(key,image);
  return image;
}

export function textImage(value: string, color = "#111111"): string {
  return renderText(value,color);
}

function renderText(value: string, color = "#111111", pixelated = false): string {
  if (!value.trim()) throw Error("텍스트가 비어 있습니다.");
  if (value.length > MAX_TEXT_LENGTH) throw Error("텍스트가 10,000자를 초과했습니다.");
  const canvas = document.createElement("canvas");
  const size = value.length > 500 ? 1024 : 512;
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const available = size - 48;
  const paragraphs = value.split(/\r\n?|\n/);
  const fontStyle = (font: number) => `${pixelated ? 600 : 400} ${font}px "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;
  const wrap = (font: number) => {
    ctx.font = fontStyle(font);
    const lines: string[] = [];
    for (const paragraph of paragraphs) {
      let line = "";
      for (const character of paragraph) {
        if (line && ctx.measureText(line + character).width > available) {
          lines.push(line);
          line = "";
        }
        line += character;
      }
      lines.push(line);
    }
    return lines;
  };
  let low = 0, high = 64 * size / 512;
  for (let i = 0; i < 14; i++) {
    const font = (low + high) / 2;
    if (wrap(font).length * font * 1.4 <= available) low = font;
    else high = font;
  }
  const lines = wrap(low);
  if (pixelated) {
    const side = Math.min(2048, Math.max(128, 16 * Math.round(size / Math.max(1, low))));
    canvas.width = canvas.height = side;
    ctx.scale(side / size, side / size);
    ctx.font = fontStyle(low);
  }
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const spacing = low * 1.4;
  lines.forEach((line, i) => ctx.fillText(line, size / 2, size / 2 + (i - (lines.length - 1) / 2) * spacing));
  if (pixelated) {
    const ink = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 3; i < ink.data.length; i += 4) {
      ink.data[i] = Math.round(Math.min(255, ink.data[i] * 1.12) / 85) * 85;
    }
    ctx.putImageData(ink, 0, 0);
    return canvas.toDataURL("image/png");
  }
  const image = canvas.toDataURL("image/png");
  return image.length <= 380_000 ? image : optimizedImage(canvas, 280_000);
}
