import { createHash } from "node:crypto";
import * as THREE from "three";
import { starterWorld, type World } from "../lib/world.ts";
import { flatTerrain } from "../lib/terrain.ts";

export function terrainFixtures(): Record<string, World> {
  const flat = starterWorld();
  flat.objects = [];
  flat.terrain = flatTerrain(flat.size);
  const mixed = structuredClone(flat);
  mixed.terrain!.seed = 4831;
  for (let z = 1; z <= 4; z++) for (let x = 1; x <= 4; x++) mixed.terrain!.tiles[z * 12 + x].surface = "soft";
  for (let z = 2; z <= 3; z++) for (let x = 7; x <= 9; x++) mixed.terrain!.tiles[z * 12 + x].surface = "slick";
  for (let x = 1; x <= 4; x++) mixed.terrain!.tiles[6 * 12 + x].surface = "rough";
  for (let z = 5; z <= 7; z++) for (let x = 7; x <= 9; x++) mixed.terrain!.tiles[z * 12 + x].height = 2;
  mixed.terrain!.tiles[3 * 12 + 10].hole = true;
  const structures = structuredClone(mixed);
  structures.terrain!.tiles[10 * 12 + 3].hole = true;
  structures.objects = [[2, 10], [4, 10], [6, 8], [8, 8], [6, 10], [8, 10]].map(([x, z], i) => ({
    id: String(i), asset: "circle", x, z, rotation: 0, scale: 1,
  }));
  const large = structuredClone(flat);
  large.size = 24;
  large.terrain = flatTerrain(24);
  large.terrain.seed = 271;
  for (let z = 4; z < 9; z++) for (let x = 4; x < 9; x++) large.terrain.tiles[z * 24 + x].surface = "soft";
  return { flat, mixed, structures, large };
}

export function terrainDigest(group: THREE.Group) {
  const hash = createHash("sha256");
  const add = (value: unknown) => hash.update(JSON.stringify(value));
  const bytes = (value: ArrayBufferView) => hash.update(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  let meshes = 0, vertices = 0;
  group.traverse((object) => {
    add([object.type, object.name, object.position.toArray(), object.rotation.toArray(), object.scale.toArray()]);
    if (!(object instanceof THREE.Mesh)) return;
    meshes++;
    vertices += object.geometry.getAttribute("position")?.count ?? 0;
    add([object.castShadow, object.receiveShadow, object.renderOrder]);
    for (const name of Object.keys(object.geometry.attributes).sort()) {
      const attribute = object.geometry.getAttribute(name) as THREE.BufferAttribute;
      add([name, attribute.itemSize, attribute.normalized]);
      bytes(attribute.array);
    }
    if (object.geometry.index) bytes(object.geometry.index.array);
    if (object instanceof THREE.InstancedMesh) {
      add(object.count);
      bytes(object.instanceMatrix.array);
      if (object.instanceColor) bytes(object.instanceColor.array);
    }
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      const m = material as THREE.MeshStandardMaterial & THREE.ShaderMaterial;
      add([m.type, m.color?.getHex(), m.roughness, m.metalness, m.opacity, m.transparent, m.side, m.depthWrite,
        m.vertexShader, m.fragmentShader]);
      for (const texture of [m.map, m.bumpMap]) {
        const data = texture?.image?.data;
        if (data) bytes(data);
      }
    }
  });
  return { hash: hash.digest("hex"), meshes, vertices };
}

export function disposeTerrain(group: THREE.Group) {
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    if (object instanceof THREE.InstancedMesh) object.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      const m = material as THREE.MeshStandardMaterial;
      m.map?.dispose();
      m.bumpMap?.dispose();
      m.dispose();
    }
  });
}
