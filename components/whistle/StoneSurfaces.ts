import { loadContentTexture } from "./ContentTexture.ts";
import * as THREE from "three";
import { tileAt } from "../../lib/terrain.ts";
import type { Actor, Asset, World } from "../../lib/world.ts";
import { projectSurfaceImage } from "./SurfaceProjection.ts";
import { softenEdges } from "./Atmosphere.ts";

function makeStoneSurfaceBatch(world: World, stones: THREE.InstancedMesh) {
  const group = new THREE.Group();
  group.name = "stone-surfaces";
  const originalMatrices = stones.instanceMatrix.array.slice();
  const originalColors = stones.instanceColor!.array.slice();
  const originalVariants = stones.geometry.getAttribute("stoneVariant").array.slice();
  const total = stones.count;
  const images: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[] = [];
  let previousKey = "", applied = new Set<string>();
  const setSurfaceImages = (actors: Actor[], assets: Asset[]) => {
    const targets = actors.flatMap(actor => {
      const asset = assets.find(asset => asset.id === actor.asset);
      if (actor.removed || !asset?.image || (asset.placement !== "surface" && asset.placement !== "field") ||
          tileAt(world, actor.x, actor.z)?.surface !== "rough") return [];
      return [{ actor, asset }];
    });
    const key = JSON.stringify(targets.map(({ actor, asset }) => [actor.id, actor.x, actor.z, actor.scale, actor.rotation, asset.image]));
    if (key === previousKey) return applied;
    previousKey = key;
    applied = new Set();
    for (const mesh of images) {
      mesh.removeFromParent();
      mesh.dispose();
      mesh.geometry.dispose();
      mesh.material.map?.dispose();
      mesh.material.dispose();
    }
    images.length = 0;
    const batches = targets.map(() => [] as number[]), bare: number[] = [];
    for (let i = 0; i < total; i++) {
      const x = originalMatrices[i * 16 + 12], z = originalMatrices[i * 16 + 14];
      let selected = -1;
      targets.forEach(({ actor }, index) => {
        const angle = -actor.rotation * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
        const dx = x - (actor.x * 2 - world.size + 1), dz = z - (actor.z * 2 - world.size + 1);
        if (Math.abs(c * dx - s * dz) <= .75 * actor.scale && Math.abs(s * dx + c * dz) <= .75 * actor.scale)
          selected = index;
      });
      if (selected < 0) bare.push(i);
      else batches[selected].push(i);
    }
    const assign = (mesh: THREE.InstancedMesh, indices: number[], color: boolean) => {
      mesh.count = indices.length;
      const fieldWind = mesh.geometry.getAttribute("stoneVariant") as THREE.InstancedBufferAttribute;
      indices.forEach((source, index) => {
        mesh.instanceMatrix.array.set(originalMatrices.subarray(source * 16, source * 16 + 16), index * 16);
        fieldWind.setXYZ(index, originalVariants[source * 3], originalVariants[source * 3 + 1], originalVariants[source * 3 + 2]);
        if (color) mesh.instanceColor!.array.set(originalColors.subarray(source * 3, source * 3 + 3), index * 3);
      });
      fieldWind.needsUpdate = mesh.instanceMatrix.needsUpdate = true;
      if (color) mesh.instanceColor!.needsUpdate = true;
      mesh.computeBoundingSphere();
      if (mesh.boundingSphere) mesh.boundingSphere.radius += 1;
    };
    batches.forEach((indices, index) => {
      if (!indices.length) return;
      const { actor, asset } = targets[index];
      applied.add(actor.id);
      const texture = loadContentTexture(asset, aspect => {
        material.userData.surfaceProjection.aspect.value = aspect;
      });
      const base = stones.material as THREE.MeshStandardMaterial;
      const material = base.clone();
      material.onBeforeCompile = base.onBeforeCompile;
      material.customProgramCacheKey = base.customProgramCacheKey.bind(base);
      material.map = texture;
      projectSurfaceImage(material, new THREE.Vector3(actor.x * 2 - world.size + 1, 0, actor.z * 2 - world.size + 1),
        1.5 * actor.scale, actor.rotation);
      material.userData.sourceText=!!asset.text;
      material.userData.surfaceProjection.edgeFade.value=asset.text?0:.18;
      const mesh = new THREE.InstancedMesh(stones.geometry.clone(), material, indices.length);
      mesh.name = "stones-surface-image";
      mesh.userData.placementId = actor.id;
      mesh.castShadow = mesh.receiveShadow = true;
      softenEdges(mesh, world.size);
      mesh.setColorAt(0,new THREE.Color());
      assign(mesh, indices, true);
      group.add(mesh);
      images.push(mesh);
    });
    assign(stones, bare, true);
    return applied;
  };
  return { group, setSurfaceImages };
}

export function makeStoneSurfaces(world: World, stones: THREE.InstancedMesh[]) {
  const group = new THREE.Group();
  group.name = "stone-surfaces";
  const batches = stones.map(stone => makeStoneSurfaceBatch(world, stone));
  batches.forEach(batch => group.add(batch.group));
  return {
    group,
    setSurfaceImages(actors: Actor[], assets: Asset[]) {
      return new Set(batches.flatMap(batch => [...batch.setSurfaceImages(actors, assets)]));
    },
  };
}
