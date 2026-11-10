/** Render text locally as transparent media while retaining its editable source. */
export function textImage(value: string): string {
  const text = value.trim();
  if (!text) throw Error("텍스트를 입력하세요.");
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  let lines: string[] = [];
  let font = 64;
  for (; font > 1; font--) {
    ctx.font = `${font}px sans-serif`;
    lines = [];
    for (const paragraph of text.split("\n")) {
      let line = "";
      for (const character of paragraph) {
        if (line && ctx.measureText(line + character).width > 464) {
          lines.push(line);
          line = "";
        }
        line += character;
      }
      lines.push(line);
    }
    if (lines.length * font * 1.4 <= 464) break;
  }
  font = Math.min(font, 464 / (lines.length * 1.4));
  ctx.font = `${font}px sans-serif`;
  ctx.fillStyle = "#111111";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const spacing = font * 1.4;
  lines.forEach((line, i) => ctx.fillText(line, 256, 256 + (i - (lines.length - 1) / 2) * spacing));
  return canvas.toDataURL("image/png");
}
