import * as THREE from "three";
import { Reflector } from "three/addons/objects/Reflector.js";

let reflecting = false;
/** One small, throttled reflection per visible pool; ripples still animate every frame. */
export function makeWaterSurface(
  geometry: THREE.BufferGeometry,
  level: number,
  clock: { value: number },
  reflect: boolean,
) {
  geometry.translate(0, -level, 0);
  geometry.rotateX(Math.PI / 2);
  const water = new Reflector(geometry, {
    textureWidth: reflect ? 256 : 1,
    textureHeight: reflect ? 256 : 1,
    multisample: 0,
    clipBias: 0.003,
  });
  water.rotation.x = -Math.PI / 2;
  water.position.y = level;
  water.name = "generated-water";
  const material = water.material as THREE.ShaderMaterial;
  material.transparent = true;
  material.depthWrite = false;
  material.fog = true;
  Object.assign(
    material.uniforms,
    THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    {
      waterTime: clock,
      skyTint: { value: new THREE.Color("#ffffff") },
      lightPower: { value: 1 },
      sunVector: { value: new THREE.Vector3(-1, 2, 1).normalize() },
      hasReflection: { value: 0 },
    },
  );
  material.vertexShader = `
    uniform mat4 textureMatrix;
    attribute float waterDepth;
    varying vec4 reflectedUV;
    varying vec3 waterWorldPosition;
    varying float depth;
    #include <common>
    #include <fog_pars_vertex>
    void main(){
      reflectedUV=textureMatrix*vec4(position,1.0);
      waterWorldPosition=(modelMatrix*vec4(position,1.0)).xyz;
      depth=waterDepth;
      vec4 mvPosition=modelViewMatrix*vec4(position,1.0);
      gl_Position = projectionMatrix*mvPosition;
      #include <fog_vertex>
    }`;
  material.fragmentShader = `
    uniform sampler2D tDiffuse;
    uniform float waterTime, lightPower, hasReflection;
    uniform vec3 skyTint, sunVector;
    varying vec4 reflectedUV;
    varying vec3 waterWorldPosition;
    varying float depth;
    #include <common>
    #include <fog_pars_fragment>
    void main(){
      vec2 p=waterWorldPosition.xz;
      float t=waterTime;
      float a=dot(p,vec2(2.1,1.3))+t*.65;
      float b=dot(p,vec2(-3.4,4.7))-t*.8;
      float c=dot(p,vec2(11.8,7.3))+sin(a)*.65+t*1.1;
      float d=dot(p,vec2(-17.1,12.2))-t*1.35;
      vec2 slope=vec2(2.1,1.3)*cos(a)*.025+vec2(-3.4,4.7)*cos(b)*.012
        +vec2(11.8,7.3)*cos(c)*.0035+vec2(-17.1,12.2)*cos(d)*.0015;
      vec3 n=normalize(vec3(-slope.x,1.0,-slope.y));
      vec3 v=normalize(cameraPosition-waterWorldPosition);
      float fresnel=.035+.965*pow(1.0-max(dot(n,v),0.0),5.0);
      vec2 uv=reflectedUV.xy/reflectedUV.w+slope*.012;
      vec3 reflected=mix(skyTint,texture2D(tDiffuse,clamp(uv,vec2(.001),vec2(.999))).rgb,hasReflection);
      float glint=pow(max(dot(n,normalize(v+sunVector)),0.0),64.0)*lightPower;
      vec3 bed=mix(vec3(.14,.28,.26),vec3(.025,.10,.115),clamp(depth*2.0,0.0,1.0))*(.25+lightPower*.55);
      vec3 color=mix(bed,reflected,clamp(.22+fresnel*.72,.0,.94))+vec3(glint*.15);
      float shore=smoothstep(.0,.035,depth);
      gl_FragColor=vec4(color,shore*clamp(.38+fresnel*.5+depth*.65,.0,.96));
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
    }`;
  const capture = water.onBeforeRender;
  let lastCapture = -Infinity;
  water.onBeforeRender = (renderer, scene, camera, geo, mat, objectGroup) => {
    if (reflecting) return;
    if (scene.background instanceof THREE.Color)
      material.uniforms.skyTint.value.copy(scene.background);
    const sun = scene.getObjectByName("whistle-sun") as
      | THREE.DirectionalLight
      | undefined;
    const moon = scene.getObjectByName("whistle-moon") as
      | THREE.DirectionalLight
      | undefined;
    const light = sun && sun.intensity > 0.05 ? sun : moon;
    if (light) {
      material.uniforms.sunVector.value.copy(light.position).normalize();
      material.uniforms.lightPower.value = light.intensity;
    }
    if (!reflect || !(camera instanceof THREE.PerspectiveCamera)) {
      material.uniforms.hasReflection.value = 0;
      return;
    }
    const now = performance.now();
    if (now - lastCapture < 150) return;
    lastCapture = now;
    const hidden: THREE.Object3D[] = [];
    scene.traverse((o) => {
      if (o.name === "generated-water" && o.visible) {
        hidden.push(o);
        o.visible = false;
      }
    });
    reflecting = true;
    try {
      capture.call(water, renderer, scene, camera, geo, mat, objectGroup);
      material.uniforms.hasReflection.value = 1;
    } finally {
      reflecting = false;
      for (const o of hidden) o.visible = true;
    }
  };
  water.userData.dispose = () => {
    water.getRenderTarget().dispose();
  };
  return water;
}
