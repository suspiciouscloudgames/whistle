import * as THREE from "three";


export function softenEdges(root: THREE.Object3D, size: number) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.material) return;
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    for (const material of materials) {
      if (material.userData.softBoundary) continue;
      material.userData.softBoundary = true;
      const previous = material.onBeforeCompile;
      const previousProgramKey = material.customProgramCacheKey();
      material.customProgramCacheKey = () =>
        previousProgramKey + "|whistle-soft-boundary-v2";
      material.onBeforeCompile = (shader, renderer) => {
        previous.call(material, shader, renderer);
        shader.uniforms.whistleBoundary = { value: size };
        shader.vertexShader =
          "varying vec3 whistleWorldPosition;\n" + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace(
          "#include <project_vertex>",
          `#include <project_vertex>
          vec4 whistlePosition = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            whistlePosition = instanceMatrix * whistlePosition;
          #endif
          whistleWorldPosition = (modelMatrix * whistlePosition).xyz;
        `,
        );
        if (!shader.vertexShader.includes("whistleWorldPosition ="))
          shader.vertexShader = shader.vertexShader.replace(
            "gl_Position =",
            "whistleWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;\n gl_Position =",
          );
        shader.fragmentShader =
          "varying vec3 whistleWorldPosition; uniform float whistleBoundary;\n" +
          shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <fog_fragment>",
          `#include <fog_fragment>
          float boundaryMist = smoothstep(whistleBoundary * .78, whistleBoundary * 1.35, length(whistleWorldPosition.xz));
          #ifdef USE_FOG
            gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, boundaryMist);
          #else
            gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0), boundaryMist);
          #endif
        `,
        );
      };
      material.needsUpdate = true;
    }
  });
}
