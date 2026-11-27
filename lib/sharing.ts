export function downloadWorld(file: Blob, title: string) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title || "Whistle"}.whistle.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
