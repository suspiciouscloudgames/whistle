import * as THREE from "three";

const waterNoise = `
  float waterHash(vec2 p){
    vec3 q=fract(vec3(p.xyx)*.1031);
    q+=dot(q,q.yzx+33.33);
    return fract((q.x+q.y)*q.z);
  }
  vec3 waterNoise(vec2 p){
    vec2 cell=floor(p), f=fract(p);
    float a=waterHash(cell), b=waterHash(cell+vec2(1.,0.));
    float c=waterHash(cell+vec2(0.,1.)), d=waterHash(cell+vec2(1.,1.));
    vec2 u=f*f*f*(f*(f*6.-15.)+10.);
    vec2 du=30.*f*f*(f*(f-2.)+1.);
    float crossTerm=a-b-c+d;
    return vec3(a+(b-a)*u.x+(c-a)*u.y+crossTerm*u.x*u.y,
      du*vec2(b-a+crossTerm*u.y,c-a+crossTerm*u.x));
  }
`;

export function makeWaterSurface(
  geometry: THREE.BufferGeometry,
  level: number,
  clock: { value: number },
) {
  if (!geometry.getAttribute("surfaceCurrent")) geometry.setAttribute("surfaceCurrent", new THREE.Float32BufferAttribute(new Float32Array(geometry.getAttribute("position").count * 2), 2));
  const material = new THREE.ShaderMaterial({ transparent: false, depthWrite: true, fog: true });
  const water = new THREE.Mesh(geometry, material);
  water.name = "generated-water";
  water.userData.waterLevel = level;
  Object.assign(
    material.uniforms,
    THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    {
      waterTime: clock,
      waveStrength: { value: 1 }, rainPower: { value: 0 }, waterMotion: { value: 1 },
      skyTint: { value: new THREE.Color("#ffffff") },
      lightPower: { value: 1 },
      sunVector: { value: new THREE.Vector3(-1, 2, 1).normalize() },
      reflectionMap: { value: null },
      reflectionMatrix: { value: new THREE.Matrix4() },
      hasReflection: { value: 0 },
    },
  );
  material.vertexShader = `
    uniform float waterTime, waveStrength, waterMotion;
    attribute float waterDepth;
    attribute vec2 surfaceCurrent;
    varying vec2 localCurrent;
    varying float depth;
    uniform mat4 reflectionMatrix;
    varying vec4 reflectionPosition;
    varying vec3 waterWorldPosition;
    #include <common>
    #include <fog_pars_vertex>
    ${waterNoise}
    void main(){
      depth=waterDepth; localCurrent=surfaceCurrent*waterMotion;
      vec3 displaced=position;
      float t=waterTime*waterMotion;
      float swell=waterNoise(position.xz*.65+vec2(t*.06,t*.025)).x-.5;
      vec2 crossFlow=mat2(.8,-.6,.6,.8)*position.xz;
      float ripple=waterNoise(crossFlow*1.7-vec2(t*.045,t*.065)).x-.5;
      displaced.y+=(swell*.05+ripple*.018)*(waveStrength+length(localCurrent)*.35)*smoothstep(.05,.3,depth);
      waterWorldPosition=(modelMatrix*vec4(displaced,1.0)).xyz;
      reflectionPosition=reflectionMatrix*vec4(waterWorldPosition,1.0);
      vec4 mvPosition=modelViewMatrix*vec4(displaced,1.0);
      gl_Position = projectionMatrix*mvPosition;
      #include <fog_vertex>
    }`;
  material.fragmentShader = `
    varying float depth;
    uniform float waterTime, lightPower, waveStrength, rainPower, waterMotion;
    varying vec2 localCurrent;
    uniform vec3 skyTint, sunVector;
    uniform sampler2D reflectionMap;
    uniform float hasReflection;
    varying vec4 reflectionPosition;
    varying vec3 waterWorldPosition;
    #include <common>
    #include <fog_pars_fragment>
    ${waterNoise}
    void main(){
      float t=waterTime*waterMotion;
      vec2 p=waterWorldPosition.xz+localCurrent*t*.18;
      mat2 turn=mat2(.8,-.6,.6,.8), fineTurn=mat2(.28,.96,-.96,.28);
      vec3 swell=waterNoise(p*.65+vec2(t*.06,t*.025));
      vec3 ripple=waterNoise(turn*p*2.4-vec2(t*.075,t*.045)+swell.x*.7);
      vec3 detail=waterNoise(fineTurn*p*7.1+vec2(t*.11,-t*.09)+ripple.x*.35);
      vec2 slope=swell.yz*.055
        +vec2(dot(turn[0],ripple.yz),dot(turn[1],ripple.yz))*.032
        +vec2(dot(fineTurn[0],detail.yz),dot(fineTurn[1],detail.yz))*.012;
      slope*=waveStrength+length(localCurrent)*.65;
      if(rainPower>.001) for(int layer=0;layer<2;layer++){
        vec2 rainP=p*(2.3+float(layer)*1.4)+float(layer)*vec2(17.3,9.7);
        vec2 rainCell=floor(rainP);
        float seed=waterHash(rainCell+12.7);
        vec2 drop=fract(rainP)-(.3+.4*vec2(waterHash(rainCell),waterHash(rainCell+41.3)));
        float phase=fract(t*(.62+seed*.35)+seed), radius=length(drop);
        float ring=sin((radius-phase*.26)*95.)*exp(-pow((radius-phase*.26)*45.,2.))*pow(1.-phase,2.);
        slope+=drop/max(radius,.01)*ring*rainPower*.012;
      }
      vec3 n=normalize(vec3(-slope.x,1.0,-slope.y));
      vec3 v=normalize(cameraPosition-waterWorldPosition);
      float fresnel=.035+.965*pow(1.0-max(dot(n,v),0.0),5.0);
      vec3 reflectedDirection=reflect(-v,n);
      vec3 reflected=skyTint*mix(vec3(.9,.95,1.0),vec3(.72,.83,.94),clamp(reflectedDirection.y,0.0,1.0));
      if(hasReflection>.5 && reflectionPosition.w>0.0){
        vec2 reflectionUv=reflectionPosition.xy/reflectionPosition.w+slope*.012;
        vec3 mirror=texture2D(reflectionMap,reflectionUv).rgb;
        reflected=mix(reflected,mirror,.92);
      }
      float glint=pow(max(dot(n,normalize(v+sunVector)),0.0),96.0)*lightPower;
      float transmission=exp(-max(depth,0.0)*2.2);
      float reflectionInk = dot(reflected,vec3(.2126,.7152,.0722));
      float longWave=waterNoise(p*.48+vec2(t*.012,-t*.008)).x;
      vec2 flow=turn*p;
      float bend=waterNoise(flow*vec2(.7,1.2)).x;
      vec2 shadeUv=flow*vec2(.65,1.25)+vec2(bend*.4,longWave*.25);
      float shadeField=waterNoise(shadeUv).x*.55
        +waterNoise(shadeUv*2.03+vec2(7.2,13.1)).x*.3
        +waterNoise(shadeUv*4.11+vec2(19.3,4.7)).x*.15;
      float waterShade=smoothstep(.46,.72,shadeField);
      float breaks=waterNoise(flow*vec2(1.7,.65)+vec2(t*.008,0.0)).x;
      vec2 segmentUv=flow*vec2(2.6,4.3)+vec2(bend*1.3,longWave*.8)+vec2(t*.008,0.0);
      float segments=waterNoise(segmentUv).x;
      float widthVariation=waterNoise(flow*1.9+vec2(13.7,4.2)).x;
      float phase=flow.y*10.0+bend*7.0+longWave*3.0-t*.12;
      float crestFade=1.0-smoothstep(.7,2.5,fwidth(phase));
      float crest=pow(.5+.5*sin(phase),mix(10.0,20.0,widthVariation))
        *smoothstep(.28,.62,breaks)*smoothstep(.3,.65,segments)*crestFade;
      float finePhase=flow.y*19.0+bend*9.0+ripple.x*2.0-t*.09;
      float fineFade=1.0-smoothstep(.7,2.5,fwidth(finePhase));
      float fineCrest=pow(.5+.5*sin(finePhase),18.0)
        *smoothstep(.58,.8,breaks)
        *smoothstep(.35,.7,waterNoise(segmentUv*1.4+vec2(8.4,17.2)).x)*fineFade;
      float shore=1.0-smoothstep(.03,.6,depth);
      float foam=shore*crest*smoothstep(.5,.75,breaks);
      float daylight=clamp(lightPower*.5,0.0,1.0);
      float waveFacing=dot(slope,normalize(sunVector.xz));
      float waveRelief=clamp(waveFacing*.32,-.025,.025)*smoothstep(.05,.3,depth);
      float waterInk = mix(.006,.018,daylight)+longWave*.008
        +reflectionInk*(.58+fresnel*.2)+crest*.025+fineCrest*.012
        +glint*.1+foam*.025+transmission*.008+waveRelief*mix(.45,1.0,daylight);
      vec3 color=vec3(waterInk);
      gl_FragColor=vec4(color,1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
    }`;
  water.onBeforeRender = (renderer, scene) => {
    if (scene.background instanceof THREE.Color)
      material.uniforms.skyTint.value.copy(scene.background);
    else if (scene.background === null)
      renderer.getClearColor(material.uniforms.skyTint.value);
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
  };
  return water;
}
