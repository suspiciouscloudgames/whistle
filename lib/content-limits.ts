import type { Asset, World } from "./world.ts";

export const MAX_CONTENT_COUNT = 20;
export const MAX_LIBRARY_SIZE = 250;
export type ContentKind = "image" | "text" | "sound";
export function contentKind(asset?: Asset): ContentKind | null {
  if (asset?.sound) return "sound";
  if (asset?.text !== undefined) return "text";
  return asset?.image ? "image" : null;
}
export const contentLimitMessage = {
  image: "이미지는 최대 20개까지 사용할 수 있습니다.",
  text: "텍스트는 최대 20개까지 사용할 수 있습니다.",
  sound: "사운드는 최대 20개까지 사용할 수 있습니다.",
};
export function validateContentCounts(world: World, libraryLimit = MAX_CONTENT_COUNT) {
  const kinds = new Map(world.assets.map(asset => [asset.id, contentKind(asset)]));
  for (const kind of ["image", "text", "sound"] as const) {
    if (world.assets.filter(asset=>contentKind(asset)===kind).length > libraryLimit || world.objects.filter(object => kinds.get(object.asset) === kind).length > MAX_CONTENT_COUNT) {
      throw new Error(contentLimitMessage[kind]);
    }
  }
}

export function mergeReceivedAssets(world: World, incoming: Asset[]) {
  const assets = [...world.assets], ids = new Set(assets.map(asset=>asset.id)), accepted:Asset[] = [];
  const received=new Set(world.receivedMaterialIds??world.assets.filter(a=>a.received).map(a=>a.id));
  for (const asset of incoming) {
    if (ids.has(asset.id)||received.has(asset.id)) { accepted.push(asset);received.add(asset.id);continue; }
    if (!contentKind(asset) || assets.length >= MAX_LIBRARY_SIZE || received.size >= 10000) continue;
    assets.push(asset);ids.add(asset.id);received.add(asset.id);accepted.push(asset);
  }
  return {world:{...world,assets,...(received.size?{receivedMaterialIds:[...received]}:{})},accepted};
}
