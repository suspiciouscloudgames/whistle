import * as THREE from "three";
import { Reflector } from "three/addons/objects/Reflector.js";

export function makeWaterReflection() {
  const plane = new THREE.PlaneGeometry(1, 1);
  const mirror = new Reflector(plane, { textureWidth: 256, textureHeight: 256, multisample: 0, clipBias: .003 });
  mirror.rotation.x = -Math.PI / 2;
  const viewProjection = new THREE.Matrix4(), capturedViewProjection = new THREE.Matrix4();
  const reflectionMatrix = new THREE.Matrix4(), inverseMirror = new THREE.Matrix4();
  const frustum = new THREE.Frustum(), sphere = new THREE.Sphere();
  let lastTime = -Infinity, lastLevel: number | null = null;
  let lastTerrain: THREE.Group | null = null;
  let waters: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>[] = [];
  return {
    update(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera | THREE.OrthographicCamera, terrain: THREE.Group, time: number) {
      if (terrain !== lastTerrain) {
        waters = [];
        terrain.traverse(object => {
          if (object.name === "generated-water") waters.push(object as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>);
        });
        lastTerrain = terrain;
        lastLevel = null;
      }
      if (!waters.length) return;
      camera.updateMatrixWorld();
      viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(viewProjection);
      let selected: typeof waters[number] | undefined, nearest = Infinity;
      for (const water of waters) {
        water.updateWorldMatrix(true, false);
        water.material.uniforms.hasReflection.value = 0;
        if (!water.geometry.boundingSphere) water.geometry.computeBoundingSphere();
        sphere.copy(water.geometry.boundingSphere!).applyMatrix4(water.matrixWorld);
        const distance = sphere.center.distanceToSquared(camera.position);
        if (water.visible && camera.position.y > water.userData.waterLevel + .02 && frustum.intersectsSphere(sphere) && distance < nearest) {
          selected = water;
          nearest = distance;
        }
      }
      if (!selected) return;
      const level = selected.userData.waterLevel as number;
      if (lastLevel !== level || !capturedViewProjection.equals(viewProjection) || time - lastTime >= 120) {
        mirror.position.y = level;
        mirror.updateMatrixWorld(true);
        const hidden: THREE.Object3D[] = [];
        scene.traverse(object => {
          if (object.visible && ["generated-water", "grassland", "weather", "generated-fog", "symbol-light", "peer-movement-trail"].includes(object.name)) {
            object.visible = false;
            hidden.push(object);
          }
        });
        try {
          mirror.onBeforeRender(renderer, scene, camera, plane, mirror.material as THREE.Material, terrain);
        } finally {
          hidden.forEach(object => { object.visible = true; });
        }
        lastTime = time;
        lastLevel = level;
        capturedViewProjection.copy(viewProjection);
        const textureMatrix = (mirror.material as THREE.ShaderMaterial).uniforms.textureMatrix.value as THREE.Matrix4;
        reflectionMatrix.copy(textureMatrix).multiply(inverseMirror.copy(mirror.matrixWorld).invert());
      }
      for (const water of waters) if (Math.abs(water.userData.waterLevel - level) < .001) {
        water.material.uniforms.reflectionMap.value = mirror.getRenderTarget().texture;
        water.material.uniforms.reflectionMatrix.value.copy(reflectionMatrix);
        water.material.uniforms.hasReflection.value = 1;
      }
    },
    dispose() { mirror.dispose(); plane.dispose(); },
  };
}
