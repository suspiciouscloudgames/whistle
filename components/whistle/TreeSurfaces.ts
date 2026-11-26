import { loadContentTexture } from "./ContentTexture.ts";
import { addNeutralGrain } from "./NeutralGrain.ts";
import * as THREE from "three";
import { environmentAt, type Environment } from "../../lib/environment.ts";
import { treeAppearance } from "../../lib/vegetation.ts";
import type { Actor, Asset, World } from "../../lib/world.ts";
import { makeTrees } from "./Trees.ts";
import { projectSurfaceImage } from "./SurfaceProjection.ts";

export function makeTreeSurfaces(world: World, environment: Environment, clock: { value: number }) {
  const group = new THREE.Group();
  group.name = "tree-surfaces";
  const motion = { value: 1 };
  group.userData.treeMotion = motion;
  group.userData.treeTime = clock;
  const trees = environment.trees.map(tree => {
    const profile = treeAppearance(world.terrain?.seed ?? 0, tree.x, tree.z);
    const specimen = makeTrees(world, { ...environment, trees: [tree] }, clock);
    const wood = specimen.getObjectByName("generated-trunks") as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
    const geometry = wood.geometry;
    geometry.translate(-(tree.x * 2 - world.size + 1), -tree.height, -(tree.z * 2 - world.size + 1));
    geometry.computeBoundingBox();
    const position = geometry.getAttribute("position"), uv: number[] = [];
    for (let i = 0; i < position.count; i++)
      uv.push(Math.atan2(position.getX(i), position.getZ(i)) / (Math.PI * 2) + .5,
        position.getY(i) / geometry.boundingBox!.max.y);
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    wood.material.dispose();
    for (const child of [...specimen.children]) if (child !== wood) group.add(child);
    const material = new THREE.MeshStandardMaterial({ color: profile.bark.color, roughness: profile.bark.roughness, vertexColors: true });
    addNeutralGrain(material, "bark", profile.seed, profile.bark);
    projectSurfaceImage(material, new THREE.Vector3(0, geometry.boundingBox!.min.y, 0),
      geometry.boundingBox!.max.y - geometry.boundingBox!.min.y, 0, true);
    material.userData.surfaceProjection.baseColor.copy(material.color);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = "generated-trunks";
    mesh.position.set(tree.x * 2 - world.size + 1, tree.height, tree.z * 2 - world.size + 1);
    mesh.userData.cell = tree.z * world.size + tree.x;
    mesh.userData.interactionOccluder = true;
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    return { mesh, tree, bark: profile.bark, key: "", hasText: false, wind: environmentAt(environment, tree.x, tree.z) };
  });
  return {
    group,
    setSurfaceImages(actors: Actor[], assets: Asset[]) {
      const applied = new Set<string>();
      for (const entry of trees) {
        const actor = actors.find(a => !a.removed && a.x === entry.tree.x && a.z === entry.tree.z &&
          assets.some(asset => asset.id === a.asset && asset.image && (asset.placement === "surface" || asset.placement === "field")));
        const asset = actor && assets.find(asset => asset.id === actor.asset);
        entry.hasText = !!asset?.text?.trim();
        const projection = entry.mesh.material.userData.surfaceProjection;
        projection.angle.value = (actor?.rotation ?? 0) * Math.PI / 180;
        projection.size.value = (entry.mesh.geometry.boundingBox!.max.y - entry.mesh.geometry.boundingBox!.min.y) * (actor?.scale ?? 1);
        const key = asset?.image ?? "";
        if (actor && asset?.image) applied.add(actor.id);
        entry.mesh.userData.placementId = actor?.id;
        if (key === entry.key) continue;
        entry.key = key;
        const material = entry.mesh.material;
        material.map?.dispose();
        material.map = null;
        material.color.set(asset?.image ? "#ffffff" : entry.bark.color);
        if (asset?.image) {
          material.map = loadContentTexture(asset);
          material.map.wrapS = THREE.RepeatWrapping;
        }
        material.needsUpdate = true;
      }
      return applied;
    },
    update(time: number, reducedMotion: boolean) {
      motion.value = reducedMotion ? 0 : 1;
      for (const { mesh, wind, hasText } of trees) {
        const sway = reducedMotion || hasText ? 0 : Math.sin(time * .0012 + mesh.position.x * .8 + mesh.position.z * .6);
        mesh.rotation.z = -sway * (.001 + wind.windX * .004);
        mesh.rotation.x = sway * (.001 + wind.windZ * .004);
      }
    },
  };
}
