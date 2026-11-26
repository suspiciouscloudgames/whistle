import * as THREE from "three";

export function projectSurfaceImage(material: THREE.Material, center: THREE.Vector3, size: number, rotation: number, tree = false) {
  const previous = material.onBeforeCompile;
  const key = material.customProgramCacheKey();
  const projection = { opacity: { value: 1 }, aspect: {value:1}, edgeFade: {value:tree?0:.18}, baseColor: tree ? new THREE.Color("#676767") : undefined, center: { value: center }, size: { value: size }, angle: { value: rotation * Math.PI / 180 } };
  material.userData.surfaceProjection = projection;
  material.customProgramCacheKey = () => key + `|surface-projection-${tree}`;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.skinOpacity = projection.opacity;
    if (projection.baseColor) shader.uniforms.skinBark = { value: projection.baseColor };
    shader.uniforms.skinCenter = projection.center;
    shader.uniforms.skinSize = projection.size;
    shader.uniforms.skinAngle = projection.angle;
    shader.uniforms.skinAspect=projection.aspect;
    shader.uniforms.skinEdgeFade=projection.edgeFade;
    shader.vertexShader = "varying vec3 skinPosition;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace("#include <project_vertex>", `#include <project_vertex>
      vec4 skinPoint = vec4(position, 1.);
      #ifdef USE_INSTANCING
        skinPoint = instanceMatrix * skinPoint;
      #endif
      skinPosition = ${tree ? "skinPoint.xyz" : "(modelMatrix * skinPoint).xyz"};
    `);
    shader.fragmentShader = "uniform vec3 skinBark; varying vec3 skinPosition; uniform vec3 skinCenter; uniform float skinSize, skinAngle, skinOpacity, skinAspect, skinEdgeFade;\n" + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `
      #ifdef USE_MAP
        vec3 skinOffset = skinPosition - skinCenter;
        ${tree ? "vec2 skinUv = vec2(atan(skinOffset.x,skinOffset.z)/6.2831853+.5+skinAngle/6.2831853, skinOffset.y/skinSize); skinUv.x = fract(skinUv.x);" : `
          float cs=cos(skinAngle), sn=sin(skinAngle);
          vec2 skinExtent=skinSize*vec2(min(1.0,skinAspect),1.0/max(1.0,skinAspect));
          vec2 skinUv = vec2(cs*skinOffset.x+sn*skinOffset.z, sn*skinOffset.x-cs*skinOffset.z)/skinExtent+.5;
        `}
        vec4 skinColor = texture2D(map, skinUv);
        ${tree ? "diffuseColor.rgb *= mix(skinBark,skinColor.rgb,skinColor.a * skinOpacity);" : `
          skinColor.a *= step(0.,skinUv.x)*step(skinUv.x,1.)*step(0.,skinUv.y)*step(skinUv.y,1.);
          if(skinEdgeFade>0.0){
            vec2 edge=smoothstep(vec2(0.0),vec2(skinEdgeFade),min(skinUv,1.0-skinUv));
            skinColor.a*=edge.x*edge.y;
          }
          vec3 surfaceRelief=diffuseColor.rgb;
          #if defined(USE_COLOR) || defined(USE_INSTANCING_COLOR)
            surfaceRelief/=max(vColor.rgb,vec3(.001));
          #endif
          diffuseColor.rgb=mix(diffuseColor.rgb,skinColor.rgb*surfaceRelief,skinColor.a*skinOpacity);
        `}
      #endif
    `);
  };
}
