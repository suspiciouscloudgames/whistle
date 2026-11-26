import { MAX_TEXT_LENGTH, type Asset } from "./world.ts";
import { optimizedImage } from "./image-export.ts";

export type TextOrder = { data: Uint8Array<ArrayBuffer>; width: number; height: number; top: number; span: number; count: number };
type RenderedText = { image: string; order?: TextOrder };
const renderedText = new Map<string, RenderedText>();
const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : undefined;
const graphemes = (line: string) => segmenter ? Array.from(segmenter.segment(line), item => item.segment) : Array.from(line);

export function sceneText(value: string, color?: string) {
  const key = JSON.stringify([value, color]);
  const cached = renderedText.get(key);
  if (cached) return cached;
  const rendered = renderText(value, color, true);
  if (renderedText.size >= 64) renderedText.delete(renderedText.keys().next().value!);
  renderedText.set(key, rendered);
  return rendered;
}

export function contentImage(asset: Pick<Asset,"image" | "text" | "textColor">) {
  return asset.text?.trim() ? sceneText(asset.text, asset.textColor).image : asset.image;
}

export function textImage(value: string, color = "#111111"): string {
  return renderText(value, color).image;
}

function readingOrder(ctx: CanvasRenderingContext2D, lines: string[], size: number, spacing: number): TextOrder {
  const width = ctx.canvas.width, height = Math.min(lines.length, width);
  const rows = lines.map(graphemes);
  const count = rows.reduce((sum, row) => sum + row.filter(glyph => glyph.trim()).length, 0);
  const data = new Uint8Array(width * height * 2);
  let ordinal = 0;
  for (const [row, glyphs] of rows.entries()) {
    const offset = Math.floor(row * height / rows.length) * width;
    const left = (size - ctx.measureText(lines[row]).width) / 2;
    let prefix = "", x = 0, rank = 0;
    for (const glyph of glyphs) {
      prefix += glyph;
      const end = Math.min(width, Math.round((left + ctx.measureText(prefix).width) * width / size));
      rank = Math.round(65535 * Math.min(ordinal, count - 1) / Math.max(1, count - 1));
      for (; x < end; x++) {
        data[(offset + x) * 2] = rank >>> 8;
        data[(offset + x) * 2 + 1] = rank & 255;
      }
      if (glyph.trim()) ordinal++;
    }
    for (; x < width; x++) {
      data[(offset + x) * 2] = rank >>> 8;
      data[(offset + x) * 2 + 1] = rank & 255;
    }
  }
  const span = spacing * lines.length / size;
  return { data, width, height, top: (1 - span) / 2, span, count };
}

function renderText(value: string, color = "#111111", pixelated = false): RenderedText {
  if (!value.trim()) throw Error("텍스트가 비어 있습니다.");
  if (value.length > MAX_TEXT_LENGTH) throw Error("텍스트가 10,000자를 초과했습니다.");
  const canvas = document.createElement("canvas");
  const size = value.length > 500 ? 1024 : 512;
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const available = size - 48;
  const paragraphs = value.split(/\r\n?|\n/).map(graphemes);
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
    return { image: canvas.toDataURL("image/png"), order: readingOrder(ctx, lines, size, spacing) };
  }
  const image = canvas.toDataURL("image/png");
  return { image: image.length <= 380_000 ? image : optimizedImage(canvas, 280_000) };
}
