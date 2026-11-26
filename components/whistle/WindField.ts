import { loadContentTexture } from "./ContentTexture.ts";
import { addNeutralGrain } from "./NeutralGrain.ts";
import * as THREE from "three";
import type { Environment } from "../../lib/environment.ts";
import type { Structure } from "../../lib/terrain.ts";
import type { Actor, Asset, World } from "../../lib/world.ts";
import { makeGrass, addGrassWind } from "./Grass.ts";
import { projectSurfaceImage } from "./SurfaceProjection.ts";
import { softenEdges } from "./Atmosphere.ts";

export function makeWindField(world: World, structures: Structure[], environment: Environment, ground: THREE.BufferGeometry) {
  const time = { value: 0 };
  const group = makeGrass(world, structures, ground, time, environment);
  const strength = group.userData.grassMotion ?? { value: 1 };
  const wind = { time, strength };
  const grass = group.getObjectByName("grass-tufts") as THREE.InstancedMesh | undefined;
  if (!grass) return { group, wind, setSurfaceImages: (_actors: Actor[], _assets: Asset[]) => new Set<string>() };
  const originalMatrices = grass.instanceMatrix.array.slice();
  const originalColors = grass.instanceColor!.array.slice();
  const originalWind = grass.geometry.getAttribute("fieldWind").array.slice();
  const total = grass.count;
  const images: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[] = [];
  let previousKey = "", applied = new Set<string>();
  const setSurfaceImages = (actors: Actor[], assets: Asset[]) => {
    const targets = actors.flatMap(actor => {
      const asset = assets.find(asset => asset.id === actor.asset);
      if (actor.removed || !asset?.image || (asset.placement !== "surface" && asset.placement !== "field") ||
          !environment.cells[actor.z * world.size + actor.x]?.grass) return [];
      return [{ actor, asset }];
    });
    const key = JSON.stringify(targets.map(({ actor, asset }) => [actor.id, actor.x, actor.z, actor.scale, actor.rotation, asset.image, asset.text]));
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
      const fieldWind = mesh.geometry.getAttribute("fieldWind") as THREE.InstancedBufferAttribute;
      indices.forEach((source, index) => {
        mesh.instanceMatrix.array.set(originalMatrices.subarray(source * 16, source * 16 + 16), index * 16);
        fieldWind.setXY(index, originalWind[source * 2], originalWind[source * 2 + 1]);
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
      const material = new THREE.MeshStandardMaterial({
        map: texture, vertexColors:true, side: THREE.DoubleSide, roughness: 1, alphaTest: .05, alphaToCoverage: true,
      });
      if (!asset.text?.trim()) addGrassWind(material, time, strength);
      addNeutralGrain(material, "grass", world.terrain?.seed ?? 0);
      projectSurfaceImage(material, new THREE.Vector3(actor.x * 2 - world.size + 1, 0, actor.z * 2 - world.size + 1), 1.5 * actor.scale, actor.rotation);
      material.userData.surfaceProjection.edgeFade.value=asset.text?0:.18;
      const mesh = new THREE.InstancedMesh(grass.geometry.clone(), material, indices.length);
      mesh.name = "grass-surface-image";
      mesh.userData.placementId = actor.id;
      mesh.receiveShadow = true;
      softenEdges(mesh, world.size);
      mesh.setColorAt(0,new THREE.Color());
      assign(mesh, indices, true);
      group.add(mesh);
      images.push(mesh);
    });
    assign(grass, bare, true);
    return applied;
  };
  return { group, wind, setSurfaceImages };
}
