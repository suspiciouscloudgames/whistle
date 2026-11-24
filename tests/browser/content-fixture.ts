import type { World } from "../../lib/world";
import type { ContentKind } from "../../lib/content-limits";

export function withEmptyContent(world: World, kind: ContentKind) {
  const id = "content-fixture";
  world.workshop = {id, serial: 1, next: 0, pending: []};
  world.assets.push({id, name: kind === "sound" ? "1" : kind, shape: "sphere", color: "#777777", solid: false, prompt: {kind}});
  world.objects.push({id: `${id}-site`, asset: id, x: 5, z: 9, rotation: 0, scale: 1});
  return world;
}
