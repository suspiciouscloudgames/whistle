import * as THREE from "three";

export const STONE_SHAPES = ["pebble", "weathered"] as const;

export function stoneGeometry(shape: number, compactOverview = false) {
  const geometry = new THREE.SphereGeometry(1, compactOverview ? 12 : 24, compactOverview ? 8 : 16);
  const positions = geometry.getAttribute("position");
  const faces = [
    new THREE.Vector3(.87, .3, .39).normalize(),
    new THREE.Vector3(-.36, .81, .46).normalize(),
    new THREE.Vector3(-.62, -.12, .77).normalize(),
  ];
  const point = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const f = 1 + Math.sin(x * 5 + z * 3) * .14;
    point.set(x * f, y, z * f);
    if (shape === 1) {
      // Broad worn faces blend back into the original rounded surface.
      for (const normal of faces) {
        const distance = point.dot(normal) - .84;
        const inset = (distance + Math.sqrt(distance * distance + .008)) * .5;
        point.addScaledVector(normal, -inset * .82);
      }
    }
    positions.setXYZ(i, point.x, point.y * .65, point.z);
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.userData.stoneShape = STONE_SHAPES[shape];
  return geometry;
}
